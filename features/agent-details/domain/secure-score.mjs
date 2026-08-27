/**
 * Agent secure score — the number in the donut, and why it is that number.
 *
 * Ported from the Security-UX `agentScore.ts` pillar logic so this page and the
 * Agents grid cannot disagree about the same agent. Pure: same inputs, same
 * verdict, no I/O, no clock.
 *
 * Every agent earns an equal share of 100 points for each posture pillar that
 * APPLIES to it and that it satisfies.
 *
 * ### Applicability is the part that is easy to get wrong
 *
 * A pillar can be inapplicable. Conditional Access can only reach an agent that
 * carries a CA-targetable Entra identity; an M365 Copilot declarative package
 * runs in the invoking user's own context and has no service principal for a
 * policy to target. Such an agent is scored out of its *remaining* pillars
 * rather than penalized for a goal it can never meet.
 *
 * That is why the tri-state `boolean | null` on the wire is preserved all the
 * way here instead of being collapsed to a boolean at the edge. `null` means
 * "never evaluated" and `false` means "evaluated and not protected", and the
 * difference decides both the denominator and whether the posture panel is
 * allowed to state a finding.
 *
 * @typedef {import("./types.js").InventoryAgent} InventoryAgent
 * @typedef {import("./types.js").PillarVerdict} PillarVerdict
 * @typedef {import("./types.js").ScoreBand} ScoreBand
 * @typedef {import("./types.js").ScorePillar} ScorePillar
 * @typedef {import("./types.js").SecureScore} SecureScore
 * @typedef {import("./types.js").Tone} Tone
 */

/** The maximum score. */
export const MAX_SCORE = 100;

/** At or above this the posture is "strong". */
export const STRONG_THRESHOLD = 80;

/** At or above this the posture is "fair"; below it, "weak". */
export const FAIR_THRESHOLD = 40;

/**
 * The scored pillars, in a stable discover → govern → secure order.
 *
 * @type {ScorePillar[]}
 */
export const PILLARS = [
	"verifiedIdentity",
	"owned",
	"policyGoverned",
	"lowRisk",
	"activityMonitored",
	"defenderProtected",
	"dlpProtected",
];

/** Risk bands that satisfy the low-risk pillar. Medium and above fail it. */
const LOW_RISK = new Set(["none", "low"]);

/**
 * The facts a pillar is evaluated against.
 *
 * A narrow shape rather than the whole row, because it is also what a caller
 * reconstructs when it has facts from somewhere other than the catalog — and a
 * narrow contract is what lets two surfaces score the same agent identically.
 *
 * @typedef {object} PillarFacts
 * @property {boolean | null} [coveredByPolicy] Conditional Access coverage. `null` means no directory identity at all.
 * @property {boolean | null} [caGoverned]      Conditional Access governance verdict.
 * @property {string | null}  [owner]           Accountable owner, or null/blank when unowned.
 * @property {string}         [riskLevel]       Normalized risk band.
 * @property {string | null}  [lastActivity]    Last-activity timestamp, or null when never reported.
 * @property {boolean | null} [defenderProtected]
 * @property {boolean | null} [dlpProtected]
 */

/**
 * Whether a pillar applies to an agent at all.
 *
 * The three scope-gated pillars apply only when their verdict is an actual
 * boolean. Anything else — `null`, `undefined`, a missing field — is out of
 * scope, and an out-of-scope pillar is excluded from the denominator rather
 * than counted as an unmet one.
 *
 * @param {PillarFacts} facts
 * @param {ScorePillar} pillar
 * @returns {boolean}
 */
export function pillarApplies(facts, pillar) {
	if (pillar === "policyGoverned") return typeof facts.caGoverned === "boolean";
	if (pillar === "defenderProtected") return typeof facts.defenderProtected === "boolean";
	if (pillar === "dlpProtected") return typeof facts.dlpProtected === "boolean";
	return true;
}

/**
 * Whether the facts satisfy a pillar. The single source of truth.
 *
 * @param {PillarFacts} facts
 * @param {ScorePillar} pillar
 * @returns {boolean}
 */
export function meetsPillar(facts, pillar) {
	switch (pillar) {
		case "verifiedIdentity":
			// Only an agent with a directory identity carries a true/false
			// coverage verdict, so a non-null value *is* the proof of identity.
			// This is why `null` must never be collapsed to `false` upstream:
			// doing so hands this pillar to an agent that has no identity at all.
			return facts.coveredByPolicy !== null && facts.coveredByPolicy !== undefined;
		case "owned":
			return (facts.owner ?? "").trim() !== "";
		case "policyGoverned":
			return facts.caGoverned === true;
		case "lowRisk":
			return LOW_RISK.has(String(facts.riskLevel ?? "none"));
		case "activityMonitored":
			return Boolean(facts.lastActivity);
		case "defenderProtected":
			return facts.defenderProtected === true;
		case "dlpProtected":
			return facts.dlpProtected === true;
		default:
			return false;
	}
}

/**
 * What each pillar checked, in one line.
 *
 * Three wordings per pillar rather than two, because "not evaluated" is a
 * different claim from "not protected" and a model that is handed the second
 * for the first will confidently report a finding nobody measured.
 *
 * @type {Record<ScorePillar, { met: string, unmet: string, na: string }>}
 */
const PILLAR_COPY = {
	verifiedIdentity: {
		met: "The agent has a verified Entra directory identity.",
		unmet: "The agent has no verified Entra directory identity.",
		na: "Directory identity was not evaluated.",
	},
	owned: {
		met: "The agent has an accountable owner.",
		unmet: "No accountable owner is recorded for this agent.",
		na: "Ownership was not evaluated.",
	},
	policyGoverned: {
		met: "Conditional Access governs this agent.",
		unmet: "No Conditional Access policy covers this agent.",
		// Worded as the absence of a measurement rather than as a reason,
		// because `applies: false` here has two causes the caller cannot
		// distinguish — the agent is out of scope, or nothing evaluated it. On
		// the inventory wire it is always the second. Naming a specific reason
		// would be asserting one of the two.
		na: "Conditional Access coverage was not evaluated for this agent.",
	},
	lowRisk: {
		met: "Entra reports no elevated identity risk.",
		unmet: "Entra reports elevated identity risk.",
		na: "Identity risk was not evaluated.",
	},
	activityMonitored: {
		met: "The agent reports a last-activity signal.",
		unmet: "No activity signal is collected for this agent, so use cannot be monitored.",
		na: "Activity monitoring was not evaluated.",
	},
	defenderProtected: {
		met: "Microsoft Defender protects this agent at runtime.",
		unmet: "Microsoft Defender runtime protection is not enabled for this agent.",
		na: "Microsoft Defender runtime protection was not evaluated for this agent.",
	},
	dlpProtected: {
		met: "Microsoft Purview DLP covers this agent.",
		unmet: "Microsoft Purview DLP does not cover this agent.",
		na: "Purview DLP scope was not evaluated for this agent.",
	},
};

/**
 * The qualitative band a numeric score falls into.
 * @param {number} score
 * @returns {ScoreBand}
 */
export function scoreBand(score) {
	if (score >= STRONG_THRESHOLD) return "strong";
	if (score >= FAIR_THRESHOLD) return "fair";
	return "weak";
}

/**
 * The tone the ring and its caption are drawn in.
 *
 * A strong secure score is LOW risk, so the ring reads green — which is why the
 * caption inverts the band into a risk word. Tone and word always agree because
 * both come from this one mapping.
 *
 * @type {Record<ScoreBand, Tone>}
 */
export const BAND_TONE = { strong: "success", fair: "warning", weak: "danger" };

/** The risk word the caption shows for a band. @type {Record<ScoreBand, string>} */
export const BAND_RISK_LABEL = { strong: "Low", fair: "Medium", weak: "High" };

/**
 * Score an agent, and say why.
 *
 * @param {PillarFacts} facts
 * @returns {SecureScore}
 */
export function secureScore(facts) {
	/** @type {PillarVerdict[]} */
	const verdicts = PILLARS.map((pillar) => {
		const applies = pillarApplies(facts, pillar);
		const met = applies && meetsPillar(facts, pillar);
		const copy = PILLAR_COPY[pillar];
		return { pillar, applies, met, summary: applies ? (met ? copy.met : copy.unmet) : copy.na };
	});

	const applicable = verdicts.filter((v) => v.applies);
	// An agent no pillar applies to scores an honest zero rather than dividing
	// by nothing. In practice unreachable — four pillars always apply — but a
	// silent NaN in a security score is not a failure mode worth risking.
	const score =
		applicable.length === 0
			? 0
			: Math.round((applicable.filter((v) => v.met).length / applicable.length) * MAX_SCORE);

	const band = scoreBand(score);
	return { score, band, tone: BAND_TONE[band], verdicts };
}

/**
 * Read the pillar facts off a catalog row.
 *
 * The row already models protection as `boolean | null`, which is exactly the
 * tri-state the scorer wants, so nothing is converted and nothing can be lost
 * in a conversion.
 *
 * ### What this wire does and does not carry
 *
 * `identity.coverageTarget` states which identity object Conditional Access
 * coverage was evaluated **against** — `servicePrincipal`, `user`, or `none`.
 * That is evidence of a directory identity, and nothing more: it is not the
 * verdict. So it answers `verifiedIdentity` and it must NOT be read as
 * `caGoverned`.
 *
 * The catalog carries no CA verdict at all, so `caGoverned` is `null` here —
 * never evaluated — which drops PolicyGoverned out of the denominator instead
 * of handing the agent a pillar nobody measured. Deriving `true` from a
 * targetable identity was the first version of this function and it is exactly
 * the fabrication this feature exists to prevent: it would have inflated every
 * identity-bearing agent's score and told an analyst that Conditional Access
 * protects an agent no policy may cover.
 *
 * @param {InventoryAgent} agent
 * @returns {PillarFacts}
 */
export function factsFromRow(agent) {
	const target = agent.identity?.coverageTarget;
	return {
		// A targetable identity object exists, so the agent resolved in the
		// directory. `null` when it did not — which the scorer reads as "no
		// verified identity", not as "evaluated and unprotected".
		coveredByPolicy: target === undefined || target === "none" ? null : true,
		// Not on this wire. See above.
		caGoverned: null,
		owner: agent.owner ?? null,
		riskLevel: agent.riskLevel,
		lastActivity: agent.lastActivity ?? null,
		defenderProtected: agent.protection?.defender ?? null,
		dlpProtected: agent.protection?.dlp ?? null,
	};
}
