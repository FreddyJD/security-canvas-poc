import { DETECTION_CATALOG, PILLAR_WEIGHT, RISK_LEVEL_WEIGHT, describeDetection } from "./risk-catalog.js";
import type {
	AgentRiskAssessment,
	AgentRiskDetection,
	CodeExposure,
	DataExposure,
	Pillar,
	RiskFactor,
	RiskyAgent,
} from "./types.js";

/**
 * Normalize a detection, collapsing Graph's deprecated fields onto the
 * supported ones. `agentId`/`agentDisplayName` are slated for removal after
 * 2027-04-28; doing this once here means no other module has to care.
 */
export function normalizeDetection(d: AgentRiskDetection): AgentRiskDetection {
	return {
		...d,
		identityId: d.identityId ?? d.agentId,
		displayName: d.displayName ?? d.agentDisplayName,
	};
}

/** Convert an Entra verdict + detections into weighted factors. */
function entraFactors(agent: RiskyAgent, detections: AgentRiskDetection[]): RiskFactor[] {
	const factors: RiskFactor[] = [];

	for (const raw of detections) {
		const d = normalizeDetection(raw);
		const meta = describeDetection(d.riskEventType);
		// A detection's own level scales its catalog weight: the same event type
		// at `low` should not count as much as at `high`.
		const levelScale = RISK_LEVEL_WEIGHT[d.riskLevel ?? "medium"] ?? 0.5;
		factors.push({
			pillar: "entra",
			code: `entra.${d.riskEventType ?? "unknown"}`,
			summary: `${meta.title}: ${meta.meaning}`,
			weight: meta.weight * Math.max(levelScale, 0.25),
			evidence: pruneUndefined({
				detectionId: d.id,
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
			evidence: pruneUndefined({ riskDetail: agent.riskDetail, riskLastModifiedDateTime: agent.riskLastModifiedDateTime }),
		});
	}

	return factors;
}

/** Purview exposure → blast-radius factors. */
function purviewFactors(exposure?: DataExposure): RiskFactor[] {
	if (!exposure) return [];
	const factors: RiskFactor[] = [];

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

/** GitHub exposure → blast-radius factors. */
function githubFactors(exposure?: CodeExposure): RiskFactor[] {
	if (!exposure) return [];
	const factors: RiskFactor[] = [];

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

export function computeComposite(factors: RiskFactor[]): number {
	if (factors.length === 0) return 0;
	let inverse = 1;
	for (const f of factors) {
		const weighted = clamp01(f.weight) * (PILLAR_WEIGHT[f.pillar] ?? 0.5);
		inverse *= 1 - Math.min(weighted, MAX_FACTOR_WEIGHT);
	}
	return Math.round((1 - inverse) * MAX_SCORE);
}

export function severityFor(score: number, riskState?: string): AgentRiskAssessment["severity"] {
	// An explicit human confirmation outranks any computed score.
	if (riskState === "confirmedCompromised") return "critical";
	if (score >= 80) return "critical";
	if (score >= 60) return "high";
	if (score >= 35) return "medium";
	if (score > 0) return "low";
	return "info";
}

/** Derive concrete, de-duplicated next steps from the contributing factors. */
export function recommendedActions(
	agent: RiskyAgent,
	factors: RiskFactor[],
	severity: AgentRiskAssessment["severity"],
): string[] {
	const actions = new Set<string>();

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

/** Build the full cross-pillar assessment for one agent. */
export function assessAgent(input: {
	agent: RiskyAgent;
	detections?: AgentRiskDetection[];
	dataExposure?: DataExposure;
	codeExposure?: CodeExposure;
	degraded?: Partial<Record<Pillar, string>>;
}): AgentRiskAssessment {
	const { agent, detections = [], dataExposure, codeExposure, degraded } = input;

	const factors = [
		...entraFactors(agent, detections),
		...purviewFactors(dataExposure),
		...githubFactors(codeExposure),
	].sort((a, b) => b.weight - a.weight);

	const compositeScore = computeComposite(factors);
	const severity = severityFor(compositeScore, agent.riskState);

	return pruneUndefined({
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
	}) as AgentRiskAssessment;
}

function clamp01(n: number): number {
	if (Number.isNaN(n)) return 0;
	return Math.max(0, Math.min(1, n));
}

/** Drop undefined keys so payloads sent to the model stay compact. */
function pruneUndefined<T extends Record<string, unknown>>(obj: T): T {
	const out = {} as T;
	for (const [k, v] of Object.entries(obj)) {
		if (v !== undefined) (out as Record<string, unknown>)[k] = v;
	}
	return out;
}
