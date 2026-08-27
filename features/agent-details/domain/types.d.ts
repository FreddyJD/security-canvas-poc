/**
 * Domain types for the agent-details feature.
 *
 * Declarations only — no runtime code ships from this file, so every layer can
 * reference it without adding a byte to what the canvas serves. Runtime modules
 * pull these in through JSDoc `@typedef {import(...)}`, which `tsc --checkJs`
 * enforces exactly like a `.ts` annotation.
 *
 * ### Where the wire shapes came from
 *
 * Ported from the Security-UX `PocUnifiedux/AgentDetails` page, but re-pointed
 * at the API this repo can actually reach. That page reads AgentSentry's
 * enriched `AgentInventoryItem` plus a merged dependency graph assembled from
 * four providers; neither exists here. What does exist is ADR-077, which
 * already serves the same facts from ZTAI's `InventoryController`:
 *
 *   GET /rp/zerotrustai/inventory/agents            -> AgentCatalog   (the row)
 *   GET /rp/zerotrustai/inventory/agents/{id}       -> AgentDetail    (the depth)
 *   GET /rp/zerotrustai/inventory/agents/{id}/exposure -> AgentExposure
 *
 * So the identity list, the risk donut and the posture panel are built from the
 * catalog row — the same row the Agents table already holds, which is why this
 * page paints the instant it opens — and the access card and the graph are
 * built from the detail document, which is the only cold read.
 *
 * Wire casing is camelCase (ASP.NET Core's default; these DTOs carry no
 * explicit [JsonPropertyName]).
 */

import type { InventoryAgent } from "../../agent-inventory/domain/types.js";
import type { Tone } from "../../agent-inventory/domain/types.js";

export type { InventoryAgent, Tone };

// ---------------------------------------------------------------------------
// Wire shapes — GET inventory/agents/{id} and /exposure, exactly as served.
// ---------------------------------------------------------------------------

/** One resource named inside a blast-radius category. */
export interface AgentDetailResource {
	name: string;
	/** Exposure-graph criticality, or `null` when the graph never rated it. */
	criticalityLevel?: number | null;
	tags?: string[];
	/** `null` means "not evaluated", which is not the same claim as `false`. */
	exposedToInternet?: boolean | null;
}

/** One blast-radius grouping: a resource type, its count, and examples. */
export interface AgentDetailBlastCategory {
	/** Display label, e.g. "Storage", "group", "serviceprincipal". */
	label: string;
	count: number;
	/** Representative members. May be shorter than `count`. */
	resources?: AgentDetailResource[];
}

/** What the agent can reach, counted per resource type. */
export interface AgentDetailBlastRadius {
	total: number;
	byCategory?: AgentDetailBlastCategory[];
}

/** One upstream node that can reach the agent. */
export interface AgentDetailReachability {
	sourceId: string;
	sourceName?: string | null;
	sourceLabel?: string | null;
	sourceCategories?: string[] | null;
	edgeLabel?: string | null;
}

/** The descriptive properties the identity list states. */
export interface AgentDetailInfo {
	platform?: string | null;
	version?: string | null;
	status?: string | null;
	riskIndicators?: string[];
	/** The agent's Entra object id, when its identity resolved. */
	entraAgentId?: string | null;
	owner?: string | null;
	owners?: string[];
	createdBy?: string | null;
	authenticationType?: string | null;
	authenticationTrigger?: string | null;
	environmentId?: string | null;
}

/** The per-agent detail document. */
export interface AgentDetail {
	metadata?: Record<string, unknown>;
	agentId: string;
	blastRadius?: AgentDetailBlastRadius;
	reachability?: AgentDetailReachability[];
	agentDetails?: AgentDetailInfo;
	summary?: { text?: string | null } | null;
}

/**
 * The body of `agents/{id}/exposure`.
 *
 * `resolved: false` means the agent mapped to no exposure-graph node — NOT that
 * it reaches nothing. The distinction is the whole reason this route answers
 * 200 rather than 404, and collapsing it would report an unmeasured agent as a
 * safe one.
 */
export interface AgentExposure {
	resolved: boolean;
	blastRadius?: { label: string; count: number }[];
}

// ---------------------------------------------------------------------------
// Secure score — the reading in the donut.
// ---------------------------------------------------------------------------

/** The qualitative band a 0..100 secure score falls into. */
export type ScoreBand = "strong" | "fair" | "weak";

/** A posture pillar the score is composed from. */
export type ScorePillar =
	| "verifiedIdentity"
	| "owned"
	| "policyGoverned"
	| "lowRisk"
	| "activityMonitored"
	| "defenderProtected"
	| "dlpProtected";

/**
 * One pillar's verdict for one agent.
 *
 * Three states, not two. `applies: false` means the pillar could never be met
 * by this agent — a declarative package has no service principal for a
 * Conditional Access policy to target — and such an agent is scored out of its
 * *remaining* pillars rather than penalized for a goal it cannot reach.
 */
export interface PillarVerdict {
	pillar: ScorePillar;
	applies: boolean;
	met: boolean;
	/** One line stating what this pillar checked and what it found. */
	summary: string;
}

/** The full score reading. */
export interface SecureScore {
	/** 0..100: the share of the applicable pillars this agent satisfies. */
	score: number;
	band: ScoreBand;
	tone: Tone;
	/** Every pillar, in canonical order — including the inapplicable ones. */
	verdicts: PillarVerdict[];
}

// ---------------------------------------------------------------------------
// The view model — what the screen and the model both read.
// ---------------------------------------------------------------------------

/** The governance verdict drawn as the header pill. */
export interface Governance {
	kind: "governed" | "ungoverned";
	tone: Tone;
}

/** Which fact an identity row states. The component maps it to a label. */
export type IdentityKey =
	| "status"
	| "owner"
	| "sponsors"
	| "agentId"
	| "identityType"
	| "publisher"
	| "platform"
	| "lastUsed"
	| "authentication";

/** How a row's value is drawn. */
export type IdentityRender = "text" | "avatar" | "facepile" | "monoCopyable";

/**
 * One labelled fact in the identity list.
 *
 * `known` is a flag of its own rather than "is `value` set", because two rows
 * do not carry their answer in `value` at all: `sponsors` carries a facepile,
 * and `authentication`'s text is chrome the component owns. Deriving known-ness
 * from `value` would report those two as unknown whenever they were answered.
 */
export interface IdentityRow {
	key: IdentityKey;
	render: IdentityRender;
	known: boolean;
	/** The real value. Absent when the fact is unknown. */
	value?: string;
	/** When set, a small status mark in this tone precedes the value. */
	status?: Tone;
	/** Names drawn as an overlapping facepile. */
	facepile?: string[];
}

/** The security-posture panel beside the gauge — structured flags only. */
export interface Posture {
	status: "secure" | "review";
	tone: Tone;
	/** Each flag is `true` (on), `false` (evaluated, off), or absent (never evaluated). */
	coverage?: boolean;
	caGoverned?: boolean;
	defenderProtected?: boolean;
	dlpProtected?: boolean;
}

/** One connected resource the agent has access to. */
export interface AccessResource {
	name: string;
	/** The category it was counted under, e.g. "Storage". */
	category?: string;
	/** Set when the exposure graph rated the resource. */
	severity?: 1 | 2 | 3;
}

/** The agent's real access, listed by name. */
export interface Access {
	/** Distinct delegated permission names. Often empty — see `render-text`. */
	permissions: string[];
	resources: AccessResource[];
	/** Total reach as counted by the service, which can exceed the named rows. */
	resourceTotal: number;
	/** False when no detail document could be read; draw the empty state. */
	hasProfile: boolean;
}

// ---------------------------------------------------------------------------
// The relationship graph — the shape the map draws.
// ---------------------------------------------------------------------------

/** How far out a node sits: the subject, what reaches it, what it reaches. */
export type Ring = "root" | "inner" | "outer" | "child";

/** Which half of the map a node is placed on. */
export type Side = "left" | "right" | "top" | "bottom";

/** One thing on the map. */
export interface GraphNode {
	id: string;
	label: string;
	ring: Ring;
	/** Free string, used for the hue and the glyph. Never interpreted by the map. */
	kind?: string;
	/** 0 is unremarkable, 3 is the most severe. */
	severity?: 0 | 1 | 2 | 3;
	/** A short line shown on the node's card and its keyboard entry. */
	detail?: string;
	side?: Side;
	/** What sits inside this node, revealed as the camera approaches. */
	children?: GraphNode[];
}

/** A relationship between two nodes, drawn as a line. */
export interface GraphEdge {
	fromId: string;
	toId: string;
	label?: string;
	/** Draws the line as the accent rather than the neutral link ink. */
	emphasis?: boolean;
}

/** The graph, before any positions exist. */
export interface RelationshipGraph {
	rootId: string;
	nodes: GraphNode[];
	edges: GraphEdge[];
}

/** A node resolved to a position and radius, in world units. */
export interface PositionedNode extends GraphNode {
	x: number;
	y: number;
	radius: number;
	/** The node this one was revealed from, if any. */
	parentId?: string;
	/** 0 for the root's own rings, 1 for a child, and so on. */
	depth: number;
	childTotal: number;
}

/** An edge resolved to endpoints, already trimmed to the node rims. */
export interface PositionedEdge extends GraphEdge {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

/** The positioned graph, ready to be painted. */
export interface GraphLayout {
	nodes: PositionedNode[];
	edges: PositionedEdge[];
}

/** A camera over the world: `scale` px-per-world-unit at world center (x, y). */
export interface Camera {
	x: number;
	y: number;
	scale: number;
}

/** The box a map is drawn into, in CSS pixels. */
export interface Viewport {
	width: number;
	height: number;
}

/** A world-space bounding box. */
export interface Bounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

// ---------------------------------------------------------------------------
// The composed page.
// ---------------------------------------------------------------------------

/** Everything the agent-details screen draws from. */
export interface AgentDetailsVM {
	agentId: string;
	name: string;
	publisher: string;
	/** Absent when no governance verdict is known — see `buildGovernance`. */
	governance?: Governance;
	/** Whether the agent's identity resolved in Entra. */
	verified: boolean;
	identityRows: IdentityRow[];
	risk: SecureScore;
	posture: Posture;
	access: Access;
	accessGraph: RelationshipGraph;
}

// ---------------------------------------------------------------------------
// Ports — what the use cases depend on, so they never name a concrete class.
// ---------------------------------------------------------------------------

/**
 * The data contract the use cases require.
 *
 * Declared here rather than derived from the class that implements it. That
 * inversion is what keeps the use cases free of HTTP: `AgentDetailsRepository`
 * is one implementation, a cached snapshot or a test fixture is another, and
 * neither the use cases nor their tests change.
 */
export interface AgentDetailsSource {
	/** The catalog row, or null when this tenant's catalog does not list it. */
	getAgentRow(agentId: string): Promise<InventoryAgent | null>;
	/** The detail document, or null when none could be read. */
	getAgentDetail(agentId: string): Promise<AgentDetail | null>;
	/** The exposure rollup, or null when it could not be read. */
	getAgentExposure(agentId: string): Promise<AgentExposure | null>;
}

/** Connection lifecycle of the details panel. */
export type DetailsStatus = "idle" | "loading" | "needs-auth" | "not-found" | "error" | "connected";

/**
 * Serialized in full over SSE on every change. Must stay JSON-safe.
 *
 * `vm` and `graphLoading` are deliberately separate: the row alone builds the
 * header, the identity list, the donut and the posture panel, so those paint on
 * arrival while the detail document is still in flight. Blocking the whole page
 * on the cold read would hide facts already in hand.
 */
export interface DetailsState {
	status: DetailsStatus;
	note: string;
	hint: string;
	agentId: string | null;
	vm: AgentDetailsVM | null;
	/** True only while the cold detail read is outstanding. */
	graphLoading: boolean;
	lastRefresh: string | null;
}
