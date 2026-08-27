import { DETECTION_CATALOG, PILLAR_WEIGHT, RISK_LEVEL_WEIGHT, describeDetection } from "./risk-catalog.mjs";

/**
 * The scoring engine. Pure: same inputs, same verdict, no I/O, no clock.
 *
 * This is the single most important file to keep host-agnostic — the canvas
 * and the MCP server both import it directly, so they cannot disagree about
 * severity. It was previously duplicated into a generated `vendor/` copy;
 * being dependency-free is what makes that copy unnecessary.
 *
 * @typedef {import("./types.js").AgentRiskAssessment} AgentRiskAssessment
 * @typedef {import("./types.js").AgentRiskDetection} AgentRiskDetection
 * @typedef {import("./types.js").CodeExposure} CodeExposure
 * @typedef {import("./types.js").DataExposure} DataExposure
 * @typedef {import("./types.js").Pillar} Pillar
 * @typedef {import("./types.js").RiskFactor} RiskFactor
 * @typedef {import("./types.js").RiskLevel} RiskLevel
 * @typedef {import("./types.js").RiskyAgent} RiskyAgent
 * @typedef {import("./types.js").Severity} Severity
 */

/**
 * Normalize a detection, collapsing Graph's deprecated fields onto the
 * supported ones. `agentId`/`agentDisplayName` are slated for removal after
 * 2027-04-28; doing this once here means no other module has to care.
 *
 * @param {AgentRiskDetection} d
 * @returns {AgentRiskDetection}
 */
export function normalizeDetection(d) {
	return {
		...d,
		identityId: d.identityId ?? d.agentId,
		displayName: d.displayName ?? d.agentDisplayName,
	};
}

/**
 * Convert an Entra verdict + detections into weighted factors.
 *
 * @param {RiskyAgent} agent
 * @param {AgentRiskDetection[]} detections
 * @returns {RiskFactor[]}
 */
function entraFactors(agent, detections) {
	/** @type {RiskFactor[]} */
	const factors = [];

	// Collapse repeated detections of the same type.
	//
	// Live tenants emit the same riskEventType many times for one agent (15+
	// identical `unifiedAgentRisk` rows observed). Scoring each independently
	// drove a MEDIUM-risk agent to a CRITICAL 99 purely through repetition,
	// which is score inflation, not evidence. Recurrence is meaningful but
	// sub-linear, so it adds a bounded bonus instead of compounding.
	/** @type {Map<string, AgentRiskDetection[]>} */
	const groups = new Map();
	for (const raw of detections) {
		const d = normalizeDetection(raw);
		const key = d.riskEventType ?? "unknown";
		const list = groups.get(key);
		if (list) list.push(d);
		else groups.set(key, [d]);
	}

	for (const [eventType, group] of groups) {
		// Represent the group by its most severe instance.
		const d = group.reduce((worst, cur) =>
			(RISK_LEVEL_WEIGHT[cur.riskLevel ?? "medium"] ?? 0) > (RISK_LEVEL_WEIGHT[worst.riskLevel ?? "medium"] ?? 0)
				? cur
				: worst,
		);
		const meta = describeDetection(eventType);
		// A detection's own level scales its catalog weight: the same event type
		// at `low` should not count as much as at `high`.
		const levelScale = RISK_LEVEL_WEIGHT[d.riskLevel ?? "medium"] ?? 0.5;
		// Recurrence bonus: saturates at +15%, reached around 10 occurrences.
		const recurrence = 1 + Math.min(Math.log10(group.length) * 0.15, 0.15);

		factors.push({
			pillar: "entra",
			code: `entra.${eventType}`,
			summary:
				group.length > 1
					? `${meta.title} (x${group.length}): ${meta.meaning}`
					: `${meta.title}: ${meta.meaning}`,
			weight: meta.weight * Math.max(levelScale, 0.25) * recurrence,
			evidence: pruneUndefined({
				detectionId: d.id,
				occurrences: group.length > 1 ? group.length : undefined,
				detectedDateTime: d.detectedDateTime,
				activityDateTime: d.activityDateTime,
				riskEvidence: d.riskEvidence,
				detectionTimingType: d.detectionTimingType,
				source: d.source,
			}),
		});
	}

	// Even with zero detections, a standing Entra risk level is itself a signal
	// (detections age out of the 90-day window while risk state persists).
	//
	// Scaled below the raw level weight: a standing `high` with no surviving
	// evidence is strong but should not be treated as equal to a live,
	// corroborated high-severity detection.
	if (factors.length === 0 && agent.riskLevel !== "none") {
		factors.push({
			pillar: "entra",
			code: "entra.standingRiskLevel",
			summary: `Entra reports ${agent.riskLevel} risk with no detections in the retention window.`,
			weight: (RISK_LEVEL_WEIGHT[agent.riskLevel] ?? 0.3) * 0.8,
			evidence: pruneUndefined({
				riskDetail: agent.riskDetail,
				riskLastModifiedDateTime: agent.riskLastModifiedDateTime,
			}),
		});
	}

	return factors;
}

/**
 * Purview exposure → blast-radius factors.
 *
 * @param {DataExposure} [exposure]
 * @returns {RiskFactor[]}
 */
function purviewFactors(exposure) {
	if (!exposure) return [];
	/** @type {RiskFactor[]} */
	const factors = [];

	if (exposure.highestLabel) {
		const label = exposure.highestLabel.toLowerCase();
		const severe = /confidential|restricted|secret|highly/.test(label);
		factors.push({
			pillar: "purview",
			code: "purview.sensitiveDataAccess",
			summary: `Agent accessed data labeled "${exposure.highestLabel}".`,
			weight: severe ? 0.85 : 0.4,
			evidence: pruneUndefined({ labelIds: exposure.labelIds }),
		});
	}

	if (exposure.dlpMatches && exposure.dlpMatches > 0) {
		factors.push({
			pillar: "purview",
			code: "purview.dlpMatches",
			summary: `Agent triggered ${exposure.dlpMatches} DLP policy match(es).`,
			// Saturates at 5 matches: 1 vs 5 is meaningful, 50 vs 500 is not.
			weight: Math.min(0.3 + exposure.dlpMatches * 0.1, 0.9),
			evidence: { dlpMatches: exposure.dlpMatches },
		});
	}

	return factors;
}

/**
 * GitHub exposure → blast-radius factors.
 *
 * @param {CodeExposure} [exposure]
 * @returns {RiskFactor[]}
 */
function githubFactors(exposure) {
	if (!exposure) return [];
	/** @type {RiskFactor[]} */
	const factors = [];

	const prodCount = exposure.productionRepos?.length ?? 0;
	if (prodCount > 0) {
		factors.push({
			pillar: "github",
			code: "github.productionWriteAccess",
			summary: `Agent has write access to ${prodCount} production repository/repositories.`,
			weight: 0.8,
			evidence: { productionRepos: exposure.productionRepos },
		});
	}

	const writeCount = exposure.writeRepos?.length ?? 0;
	if (writeCount > 0 && prodCount === 0) {
		factors.push({
			pillar: "github",
			code: "github.writeAccess",
			summary: `Agent has write access to ${writeCount} repository/repositories.`,
			weight: Math.min(0.2 + writeCount * 0.05, 0.6),
			evidence: { writeRepos: exposure.writeRepos },
		});
	}

	if (exposure.canApprovePullRequests) {
		factors.push({
			pillar: "github",
			code: "github.pullRequestApproval",
			summary: "Agent can approve pull requests, so it can self-merge changes.",
			weight: 0.7,
		});
	}

	return factors;
}

/**
 * Combine weighted factors into a 0..100 composite.
 *
 * Uses a saturating combination (probabilistic OR) rather than a sum:
 *   combined = 1 - Π(1 - wᵢ)
 *
 * Summing would let five trivial findings outrank one confirmed compromise,
 * and would clip at the cap constantly. This keeps every additional factor
 * meaningful while never exceeding 1, and preserves ordering by severity.
 *
 * Two guards keep the result *strictly* ordered, which naive probabilistic-OR
 * does not give you:
 *
 *  - Each factor's effective weight is capped at MAX_FACTOR_WEIGHT (< 1). A
 *    single weight-1.0 factor would otherwise drive the product to exactly 0,
 *    pinning the score at 100 and making all further evidence invisible.
 *  - The result is scaled to MAX_SCORE (99) and only an explicit
 *    `confirmedCompromised` state reaches 100. A computed score should never
 *    claim more certainty than a human confirmation.
 *
 * Consequence: more evidence always raises the score, so triage ordering
 * survives even among many severe agents.
 */
const MAX_FACTOR_WEIGHT = 0.92;
const MAX_SCORE = 99;

/**
 * @param {RiskFactor[]} factors
 * @returns {number}
 */
export function computeComposite(factors) {
	if (factors.length === 0) return 0;
	let inverse = 1;
	for (const f of factors) {
		const weighted = clamp01(f.weight) * (PILLAR_WEIGHT[f.pillar] ?? 0.5);
		inverse *= 1 - Math.min(weighted, MAX_FACTOR_WEIGHT);
	}
	return Math.round((1 - inverse) * MAX_SCORE);
}

/**
 * @param {number} score
 * @param {string} [riskState]
 * @returns {Severity}
 */
export function severityFor(score, riskState) {
	// An explicit human confirmation outranks any computed score.
	if (riskState === "confirmedCompromised") return "critical";
	// A human already adjudicated these. Re-flagging them would train analysts
	// to ignore the queue, which is how real incidents get missed.
	if (riskState === "confirmedSafe" || riskState === "dismissed") return "info";
	if (score >= 80) return "critical";
	if (score >= 60) return "high";
	if (score >= 35) return "medium";
	if (score > 0) return "low";
	return "info";
}

/**
 * True when a human has already adjudicated this agent's risk.
 * @param {string} [riskState]
 */
function isResolved(riskState) {
	return riskState === "confirmedSafe" || riskState === "dismissed";
}

/**
 * Derive concrete, de-duplicated next steps from the contributing factors.
 *
 * @param {RiskyAgent} agent
 * @param {RiskFactor[]} factors
 * @param {Severity} severity
 * @returns {string[]}
 */
export function recommendedActions(agent, factors, severity) {
	/** @type {Set<string>} */
	const actions = new Set();

	if (agent.riskState === "confirmedSafe") {
		return ["An administrator marked this agent safe. No action required."];
	}
	if (agent.riskState === "dismissed") {
		return ["Risk was dismissed by an administrator. Entra will keep flagging similar activity."];
	}

	if (agent.riskState === "confirmedCompromised") {
		actions.add("Agent is confirmed compromised — disable it and rotate all blueprint credentials now.");
	}
	if (severity === "critical" || severity === "high") {
		actions.add("Disable the agent until the investigation concludes.");
	}

	for (const f of factors) {
		if (f.pillar !== "entra") continue;
		const eventType = f.code.replace(/^entra\./, "");
		const meta = DETECTION_CATALOG[eventType];
		if (meta) actions.add(meta.action);
	}

	if (factors.some((f) => f.code === "github.productionWriteAccess")) {
		actions.add("Revoke the agent's write access to production repositories pending review.");
	}
	if (factors.some((f) => f.pillar === "purview")) {
		actions.add("Review which labeled documents the agent accessed and confirm the access was expected.");
	}
	if (agent.isProcessing) {
		actions.add("Entra is still recomputing this agent's risk — re-check before taking irreversible action.");
	}
	if (actions.size === 0) {
		actions.add("No action required. Continue monitoring.");
	}

	return [...actions];
}

/**
 * Ceiling on how far the composite may exceed Entra's own verdict when the
 * only evidence is identity-side.
 *
 * Entra's riskLevel is an ML rollup that already accounts for its detections.
 * Re-deriving a score from those same detections and landing higher is double
 * counting: two `medium` aggregate signals combined to CRITICAL 81 on an agent
 * Entra rated `medium`. Escalation must be earned by evidence Entra cannot
 * see — Purview exposure or GitHub reach — not by recomputing its own inputs.
 *
 * @type {Record<RiskLevel, number>}
 */
const ENTRA_CEILING = {
	high: 100,
	medium: 59, // caps at "medium" band; cannot reach high (60) on identity alone
	low: 34, // caps at "low" band
	hidden: 34,
	none: 20,
	unknownFutureValue: 59,
};

/**
 * Build the full cross-pillar assessment for one agent.
 *
 * @param {object} input
 * @param {RiskyAgent} input.agent
 * @param {AgentRiskDetection[]} [input.detections]
 * @param {DataExposure} [input.dataExposure]
 * @param {CodeExposure} [input.codeExposure]
 * @param {Partial<Record<Pillar, string>>} [input.degraded]
 * @returns {AgentRiskAssessment}
 */
export function assessAgent(input) {
	const { agent, detections = [], dataExposure, codeExposure, degraded } = input;

	const factors = [
		...entraFactors(agent, detections),
		...purviewFactors(dataExposure),
		...githubFactors(codeExposure),
	].sort((a, b) => b.weight - a.weight);

	let compositeScore;
	if (isResolved(agent.riskState)) {
		compositeScore = 0;
	} else {
		compositeScore = computeComposite(factors);
		// Only cap when every factor is identity-side. Cross-pillar evidence is
		// exactly the thing Entra cannot see, so it may legitimately escalate.
		const hasBlastRadius = factors.some((f) => f.pillar !== "entra");
		if (!hasBlastRadius) {
			compositeScore = Math.min(compositeScore, ENTRA_CEILING[agent.riskLevel] ?? 59);
		}
	}

	const severity = severityFor(compositeScore, agent.riskState);

	return /** @type {AgentRiskAssessment} */ (
		pruneUndefined({
			agentId: agent.id,
			displayName: agent.agentDisplayName ?? "(unnamed agent)",
			identityType: agent.identityType,
			blueprintId: agent.blueprintId,
			entraRiskLevel: agent.riskLevel,
			riskState: agent.riskState,
			compositeScore,
			severity,
			factors,
			dataExposure,
			codeExposure,
			recommendedActions: recommendedActions(agent, factors, severity),
			isProcessing: agent.isProcessing,
			degraded,
		})
	);
}

/**
 * Triage ordering, shared by every surface.
 *
 * Composite scores legitimately tie at the top (see computeComposite), so ties
 * are broken deterministically: confirmed compromises first, then more
 * corroborating evidence, then agent id. Without this, equally-scored agents
 * would shuffle between identical calls and the analyst could not trust the
 * list order.
 *
 * Living here rather than in a tool file is deliberate — the canvas queue and
 * the MCP table must present the same order, or the two surfaces contradict
 * each other about which agent to look at first.
 *
 * @param {AgentRiskAssessment} a
 * @param {AgentRiskAssessment} b
 * @returns {number}
 */
export function compareBySeverity(a, b) {
	if (b.compositeScore !== a.compositeScore) return b.compositeScore - a.compositeScore;

	const confirmed = (/** @type {AgentRiskAssessment} */ x) => (x.riskState === "confirmedCompromised" ? 1 : 0);
	if (confirmed(b) !== confirmed(a)) return confirmed(b) - confirmed(a);

	if (b.factors.length !== a.factors.length) return b.factors.length - a.factors.length;
	return String(a.agentId).localeCompare(String(b.agentId));
}

/**
 * Attach catalog knowledge to raw detections.
 *
 * @param {AgentRiskDetection[]} detections
 * @returns {import("./types.js").EnrichedDetection[]}
 */
export function enrichDetections(detections) {
	return detections.map((raw) => {
		const d = normalizeDetection(raw);
		const meta = describeDetection(d.riskEventType);
		return {
			id: d.id,
			riskEventType: d.riskEventType,
			title: meta.title,
			meaning: meta.meaning,
			impact: meta.impact,
			recommendedAction: meta.action,
			riskLevel: d.riskLevel,
			detectedDateTime: d.detectedDateTime,
			riskEvidence: d.riskEvidence,
		};
	});
}

/** @param {number} n */
function clamp01(n) {
	if (Number.isNaN(n)) return 0;
	return Math.max(0, Math.min(1, n));
}

/**
 * Drop undefined keys so payloads sent to the model stay compact.
 * @template {Record<string, unknown>} T
 * @param {T} obj
 * @returns {T}
 */
function pruneUndefined(obj) {
	const out = /** @type {T} */ ({});
	for (const [k, v] of Object.entries(obj)) {
		if (v !== undefined) /** @type {Record<string, unknown>} */ (out)[k] = v;
	}
	return out;
}
