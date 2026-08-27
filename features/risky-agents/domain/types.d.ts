/**
 * Domain types for the risky-agents feature.
 *
 * Declarations only — this file emits no runtime code, so it can be shared by
 * every layer without adding a single byte to what ships to the canvas.
 * Runtime modules reference these through JSDoc `@typedef {import(...)}`,
 * which `tsc --checkJs` enforces exactly like a `.ts` annotation.
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
 * `Prefer: include-unknown-enum-members` — see platform/graph.mjs.
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

/** Bucketed composite score, for filtering and display. */
export type Severity = "critical" | "high" | "medium" | "low" | "info";

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

/** A detection enriched with catalog knowledge, ready to render or explain. */
export interface EnrichedDetection {
	id: string;
	riskEventType?: string;
	title: string;
	meaning: string;
	impact: string;
	recommendedAction: string;
	riskLevel?: RiskLevel;
	detectedDateTime?: string;
	riskEvidence?: string;
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
	severity: Severity;
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
	/** Attached by use cases that fetch detections; absent otherwise. */
	detectionDetail?: EnrichedDetection[];
}

// ---------------------------------------------------------------------------
// Ports — what the use cases depend on, so they never name a concrete class.
// ---------------------------------------------------------------------------

/**
 * The data contract the use cases require.
 *
 * Declared here, in the domain, rather than derived from the class that
 * implements it. That inversion is what lets the use cases stay ignorant of
 * Graph: `AgentRepository` is one implementation, a cached snapshot or a test
 * fixture is another, and neither the use cases nor their tests change.
 */
export interface AgentSource {
	listAssessments(opts?: {
		riskLevels?: string[];
		riskStates?: string[];
		limit?: number;
		includeDetections?: boolean;
	}): Promise<AgentRiskAssessment[]>;

	getAssessment(
		agentId: string,
		opts?: {
			detectionLimit?: number;
			dataExposure?: DataExposure;
			codeExposure?: CodeExposure;
		},
	): Promise<AgentRiskAssessment>;

	listRecentDetections(sinceIso: string, limit?: number): Promise<AgentRiskDetection[]>;

	updateRiskState(agentIds: string[], action: RiskStateAction): Promise<void>;
}

/** The risk-state transitions Entra ID Protection accepts. */
export type RiskStateAction = "dismiss" | "confirmCompromised" | "confirmSafe";

// ---------------------------------------------------------------------------
// Canvas state — the contract between the Node side and the browser side.
// ---------------------------------------------------------------------------

/** Connection lifecycle of the canvas. */
export type CanvasStatus = "loading" | "needs-config" | "needs-auth" | "signing-in" | "error" | "connected";

/** Which screen the canvas is showing, and what it is showing it for. */
export interface Route {
	view: string;
	params: Record<string, unknown>;
}

/** Serialized in full over SSE on every change. Must stay JSON-safe. */
export interface CanvasState {
	status: CanvasStatus;
	note: string;
	hint: string;
	route: Route;
	assessments: AgentRiskAssessment[];
	selectedId: string | null;
	lastRefresh: string | null;
}
