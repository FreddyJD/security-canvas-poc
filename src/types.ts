/**
 * Domain types mirroring the Microsoft Graph beta ID Protection surface for
 * agent identities, plus the cross-pillar types this server adds on top.
 *
 * Graph schema source (verified 2026-08):
 *   /beta/identityProtection/riskyAgents          -> RiskyAgent
 *   /beta/identityProtection/agentRiskDetections  -> AgentRiskDetection
 */

/** Entra ID Protection risk levels. `hidden` means "scored but not surfaced". */
export type RiskLevel = "low" | "medium" | "high" | "hidden" | "none" | "unknownFutureValue";

/** Lifecycle state of a risk finding. */
export type RiskState =
	| "none"
	| "confirmedSafe"
	| "dismissed"
	| "atRisk"
	| "confirmedCompromised"
	| "unknownFutureValue";

/**
 * Agent identity flavours.
 * `agentIdentityBlueprintPrincipal` requires the request header
 * `Prefer: include-unknown-enum-members` — see graph-client.ts.
 */
export type AgentIdentityType =
	| "agentIdentity"
	| "agentUser"
	| "agentIdentityBlueprintPrincipal"
	| "user"
	| "unknownFutureValue";

/** A risky agent as returned by Entra ID Protection. */
export interface RiskyAgent {
	id: string;
	agentDisplayName?: string;
	/** Blueprint the agent was instantiated from. Nullable per Graph. */
	blueprintId?: string | null;
	identityType: AgentIdentityType;
	isDeleted?: boolean;
	isEnabled?: boolean;
	/** True while Entra is still recomputing risk; treat data as in-flight. */
	isProcessing?: boolean;
	riskLastModifiedDateTime?: string;
	riskLevel: RiskLevel;
	riskState: RiskState;
	riskDetail?: string;
}

/** An individual detection contributing to an agent's risk. */
export interface AgentRiskDetection {
	id: string;
	activityDateTime?: string;
	detectedDateTime?: string;
	lastModifiedDateTime?: string;
	detectionTimingType?: "notDefined" | "realtime" | "nearRealtime" | "offline" | "unknownFutureValue";
	/** Preferred over the deprecated `agentDisplayName`. */
	displayName?: string;
	/** Preferred over the deprecated `agentId`. */
	identityId?: string;
	identityType?: AgentIdentityType;
	blueprintId?: string | null;
	riskEventType?: string;
	riskEvidence?: string;
	riskLevel?: RiskLevel;
	riskState?: RiskState;
	riskDetail?: string;
	additionalInfo?: string;
	source?: string | null;

	/**
	 * Deprecated by Graph, removal after 2027-04-28. Normalized away by
	 * `normalizeDetection()` so the rest of the codebase never reads them.
	 */
	agentId?: string;
	agentDisplayName?: string;
}

/** Minimal OData collection envelope. */
export interface GraphCollection<T> {
	value: T[];
	"@odata.nextLink"?: string;
}

// ---------------------------------------------------------------------------
// Cross-pillar correlation types — the part Graph does not provide.
// ---------------------------------------------------------------------------

/** Which security pillar an observation came from. */
export type Pillar = "entra" | "purview" | "defender" | "github";

/**
 * One reason an agent scored the way it did. Designed to be read by a model:
 * short, attributed, and carrying a stable weight.
 */
export interface RiskFactor {
	pillar: Pillar;
	/** Stable machine key, e.g. "entra.signInSpike". */
	code: string;
	/** One-line human explanation. */
	summary: string;
	/** 0..1 contribution before pillar weighting. */
	weight: number;
	/** Raw supporting values — ids, counts, timestamps. */
	evidence?: Record<string, unknown>;
}

/** Sensitivity of data an agent can reach (Purview). */
export interface DataExposure {
	/** Highest-sensitivity label the agent touched, if any. */
	highestLabel?: string;
	labelIds?: string[];
	/** Count of DLP policy matches attributed to this agent. */
	dlpMatches?: number;
}

/** Code/CI reach of an agent (GitHub). */
export interface CodeExposure {
	/** Repos the agent identity can write to. */
	writeRepos?: string[];
	/** Repos considered production-critical by config. */
	productionRepos?: string[];
	canApprovePullRequests?: boolean;
}

/**
 * The correlated verdict. This is the primary payload returned to the model —
 * a judgement plus its justification, not a data dump.
 */
export interface AgentRiskAssessment {
	agentId: string;
	displayName: string;
	identityType: AgentIdentityType;
	blueprintId?: string | null;
	/** Risk level as reported by Entra. */
	entraRiskLevel: RiskLevel;
	riskState: RiskState;
	/** 0..100 composite across all pillars. */
	compositeScore: number;
	/** Bucketed composite, for filtering and display. */
	severity: "critical" | "high" | "medium" | "low" | "info";
	/** Ordered most-significant-first. */
	factors: RiskFactor[];
	dataExposure?: DataExposure;
	codeExposure?: CodeExposure;
	/** Human-readable next steps. */
	recommendedActions: string[];
	/** True when the agent is mid-recomputation in Entra. */
	isProcessing?: boolean;
	/** Set when a pillar could not be reached, so the model can caveat. */
	degraded?: Partial<Record<Pillar, string>>;
}
