/**
 * Domain types for the agent inventory feature.
 *
 * Mirrors the ADR-077 catalog served by ZTAI-Service's `InventoryController`:
 *   GET /rp/zerotrustai/inventory/agents?api-version=2026-08-01  -> AgentCatalog
 *   GET /rp/zerotrustai/inventory/agents/summary                 -> InventorySummary
 *
 * Wire casing is camelCase (ASP.NET Core's default policy; the service sets no
 * explicit naming policy and carries no [JsonPropertyName] on these DTOs).
 * Declarations only — no runtime code ships from this file.
 */

/** Risk level as served. Lower-case tokens; `none` is a real value, not absence. */
export type InventoryRiskLevel = "none" | "low" | "medium" | "high";

/** Whether the agent is a Microsoft or a third-party package. */
export type AgentAppType = "firstParty" | "thirdParty";

/** Which identity object the agent's coverage was evaluated against. */
export type CoverageTarget = "servicePrincipal" | "user" | "none";

/**
 * Protection state per control.
 *
 * Tri-state on purpose: `null` means the control was never evaluated, which is
 * a different claim from `false` ("evaluated, and not protected"). Collapsing
 * the two would report unmeasured agents as unprotected.
 */
export interface AgentProtection {
	defender: boolean | null;
	dlp: boolean | null;
}

/** Whether a blast-radius document exists for this agent. */
export interface AgentBlastRadiusAvailability {
	available: boolean;
}

/** The identity the agent resolved onto. */
export interface AgentIdentity {
	servicePrincipalId: string | null;
	userId: string | null;
	coverageTarget: CoverageTarget;
}

/** One row of the agent catalog, exactly as served. */
export interface InventoryAgent {
	/** Join key for `agents/{id}` and `agents/{id}/exposure`. */
	agentId: string;
	title: string;
	publisher: string;
	/** Display label, e.g. "M365 Copilot", "Copilot Studio", "Endpoint", "Other". */
	platform: string;
	appType: AgentAppType;
	/** Row-origin discriminator: "registered" | "registry". Free-form. */
	source: string;
	status: string;
	/** `null` when no owner resolved — one of the four flag members. */
	owner: string | null;
	riskLevel: InventoryRiskLevel;
	/** `null` when the agent resolved onto no exposure-graph node at all. */
	publiclyExposed: boolean | null;
	/** True when the agent has no usable last-activity timestamp. */
	unmonitored: boolean;
	/** ISO 8601, or `null` when unavailable. */
	lastActivity: string | null;
	protection: AgentProtection;
	blastRadius: AgentBlastRadiusAvailability;
	identity: AgentIdentity;
}

/** Freshness and provenance of a stored inventory document. */
export interface InventoryMetadata {
	tenantId: string;
	collectedAt: string;
	generation: string;
	/** "3.0" for the current projector. */
	schemaVersion: string;
}

/** The catalog envelope. */
export interface AgentCatalog {
	metadata: InventoryMetadata;
	agents: InventoryAgent[];
}

/** Counts of agents whose protection control evaluated each way. */
export interface ProtectionCounts {
	protected: number;
	unprotected: number;
	notEvaluated: number;
}

/** The tenant-wide aggregate. The only source of the true estate total. */
export interface InventorySummary {
	metadata: InventoryMetadata;
	agents: {
		/** Every agent in the estate — NOT just the flagged catalog. */
		total: number;
		/** How many are flagged (risky, unowned, publicly exposed, or unmonitored). */
		atRisk: number;
		riskSignals: {
			unowned: number;
			publiclyExposed: number;
			unmonitored: number;
		};
		/** Keyed by "none" | "low" | "medium" | "high". */
		byRiskLevel: Record<string, number>;
		/** Keyed by the platform label verbatim; blank becomes "Unknown". */
		byPlatform: Record<string, number>;
		/** Keyed by "registered" | "registry"; blank becomes "Unknown". */
		bySource: Record<string, number>;
	};
	protection: {
		defender: ProtectionCounts;
		dlp: ProtectionCounts;
	};
}

// ---------------------------------------------------------------------------
// Presentation types — derived, never served.
// ---------------------------------------------------------------------------

/** The tone a mark (dot, meter segment) takes. */
export type Tone = "neutral" | "brand" | "danger" | "warning" | "success";

/** Which headline slice a metric card reports and applies. */
export type AgentSlice = "all" | "managed" | "highRisk" | "unowned";

/** One headline count above the table. */
export interface AgentMetric {
	id: AgentSlice;
	label: string;
	value: number;
	total: number;
	breakdownLabel: string;
}

/** The active narrowing over the catalog. */
export interface InventoryFilters {
	search: string;
	/** Platform labels to keep. Empty means no platform narrowing. */
	platforms: string[];
	/** Risk levels to keep. Empty means no risk narrowing. */
	risks: InventoryRiskLevel[];
	/** The metric card currently pressed. */
	slice: AgentSlice;
}

/** Which column the table is ordered by, and which way. */
export interface InventorySort {
	column: string;
	descending: boolean;
}

/** Everything the inventory screen renders from. Must stay JSON-safe. */
export interface InventoryState {
	status: "loading" | "needs-auth" | "error" | "connected";
	note: string;
	hint: string;
	agents: InventoryAgent[];
	/** Present only when the summary call succeeded. */
	summary: InventorySummary | null;
	filters: InventoryFilters;
	sort: InventorySort;
	page: number;
	pageSize: number;
	lastRefresh: string | null;
}

/** What the repository needs to provide. The port the use cases depend on. */
export interface InventorySource {
	listAgents(opts?: { risk?: boolean; flagged?: boolean; maxCount?: number }): Promise<AgentCatalog>;
	getSummary(): Promise<InventorySummary | null>;
}
