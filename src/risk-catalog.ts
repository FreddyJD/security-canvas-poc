import type { Pillar, RiskLevel } from "./types.js";

/**
 * Knowledge base for Entra ID Protection agent detections.
 *
 * Entra returns `riskEventType` as an opaque string. On its own that is close
 * to useless to a language model — "signInSpike" carries no remediation
 * guidance. This table turns each detection into something explainable:
 * what it means, why it matters, and what to do about it.
 *
 * Detection list verified against Microsoft Learn (2026-08):
 * https://learn.microsoft.com/entra/id-protection/concept-risky-agents
 */
export interface DetectionMeta {
	/** Human title. */
	title: string;
	/** What the signal actually means. */
	meaning: string;
	/** Why a responder should care. */
	impact: string;
	/** Base contribution to the composite score, 0..1. */
	weight: number;
	/** Concrete remediation step. */
	action: string;
}

export const DETECTION_CATALOG: Record<string, DetectionMeta> = {
	// ---------------------------------------------------------------
	// Observed in live tenant data (2026-08) but NOT in the public docs.
	// These are the types Entra actually emits today; the documented
	// per-behaviour types below appear to be the forward-looking taxonomy.
	// ---------------------------------------------------------------
	unifiedAgentRisk: {
		title: "Unified agent risk",
		meaning:
			"Entra's aggregate agent risk signal. Rolls up several behavioural detections into one verdict rather than naming a single cause.",
		impact:
			"Indicates the agent deviated from its normal pattern. Because it is an aggregate, consult riskEvidence for the specific behaviour.",
		weight: 0.6,
		action: "Read the detection's riskEvidence, then compare the activity against the agent's intended purpose.",
	},
	aiCompoundAccountRisk: {
		title: "Compound AI account risk",
		meaning:
			"Risk arising from the combination of an agent identity and the user account that owns or operates it.",
		impact:
			"Compromise of either side can drive the other. Blast radius spans both the agent's permissions and the owner's.",
		weight: 0.7,
		action: "Investigate the owning user's sign-in risk alongside the agent's; remediate both or neither.",
	},

	adminConfirmedAgentCompromised: {
		title: "Admin confirmed compromised",
		meaning: "A human administrator explicitly marked this agent as compromised.",
		impact: "Highest-confidence signal available. Treat as an active incident.",
		weight: 1.0,
		action: "Disable the agent and rotate every credential on its blueprint.",
	},
	earlyLifeMaliciousActivity: {
		title: "Early-life malicious activity",
		meaning: "A newly created agent began acting maliciously almost immediately.",
		impact:
			"Strongly suggests the agent was created by an attacker rather than compromised later. Check who created it.",
		weight: 0.9,
		action: "Audit the creation event and the identity that provisioned the agent, then disable.",
	},
	threatIntelligenceAccount: {
		title: "Threat intelligence match",
		meaning: "Activity matches known attack patterns from Microsoft threat intelligence.",
		impact: "Correlates to observed real-world attacker behaviour.",
		weight: 0.85,
		action: "Cross-reference with Defender incidents and hunt for lateral movement.",
	},
	suspiciousCredentialUsage: {
		title: "Suspicious credential usage",
		meaning: "New credentials were added to the agent's blueprint and then used.",
		impact:
			"Classic persistence mechanism — an attacker adds their own secret so they retain access after a password reset.",
		weight: 0.8,
		action: "Review blueprint credentials, remove unrecognized ones, and rotate the rest.",
	},
	entraDirectoryReconnaissance: {
		title: "Directory reconnaissance",
		meaning: "The agent enumerated directory objects such as users, groups, or roles.",
		impact: "Typical pre-attack mapping. Rarely legitimate for a task-scoped agent.",
		weight: 0.7,
		action: "Compare against the agent's intended purpose; restrict directory read permissions.",
	},
	unfamiliarResourceAccess: {
		title: "Unfamiliar resource access",
		meaning: "The agent accessed resources outside its established baseline.",
		impact: "Suggests scope creep or an attacker probing what the identity can reach.",
		weight: 0.65,
		action: "Review recently accessed resources and tighten the agent's permission scope.",
	},
	failedAccessAttempt: {
		title: "Failed access attempts",
		meaning: "The agent's token was replayed against resources it is not authorized for.",
		impact: "Indicates probing. Failures today often map to a successful path tomorrow.",
		weight: 0.55,
		action: "Identify the targeted resources and confirm the token was not exfiltrated.",
	},
	signInSpike: {
		title: "Sign-in volume spike",
		meaning: "Sign-in volume rose sharply above this agent's own baseline.",
		impact: "May be automation or a toolkit driving the identity. Can also be a benign workload change.",
		weight: 0.45,
		action: "Correlate the spike with a known deployment or schedule change before escalating.",
	},
};

/** Unknown detection types still need a sane, non-zero weight. */
export const UNKNOWN_DETECTION: DetectionMeta = {
	title: "Unrecognized detection",
	meaning: "Entra reported a detection type this server does not yet model.",
	impact: "Unknown. The detection catalog may be out of date with Entra.",
	weight: 0.5,
	action: "Inspect the raw riskEventType and riskEvidence in the Entra portal.",
};

export function describeDetection(riskEventType: string | undefined): DetectionMeta {
	if (!riskEventType) return UNKNOWN_DETECTION;
	return DETECTION_CATALOG[riskEventType] ?? UNKNOWN_DETECTION;
}

/** Numeric weight for an Entra risk level, used as a multiplier. */
export const RISK_LEVEL_WEIGHT: Record<RiskLevel, number> = {
	high: 1.0,
	medium: 0.6,
	low: 0.3,
	// `hidden` means Entra scored it but suppressed display (e.g. Learning Mode).
	// Deliberately non-zero: suppressed is not the same as safe.
	hidden: 0.2,
	none: 0.0,
	unknownFutureValue: 0.3,
};

/**
 * Relative influence of each pillar on the composite score.
 *
 * Entra dominates because it is the only pillar producing a calibrated,
 * ML-derived risk verdict. The others contribute *blast radius* — they
 * describe how much damage the identity could do, not how likely it is
 * to be malicious.
 */
export const PILLAR_WEIGHT: Record<Pillar, number> = {
	entra: 1.0,
	purview: 0.7,
	github: 0.6,
	defender: 0.8,
};
