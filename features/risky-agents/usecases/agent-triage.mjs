/**
 * Use cases — the layer between the data and every surface that shows it.
 *
 * This is the "middle layer" that usually rots. The rule that keeps it honest:
 * a use case may touch the repository and the store, and it must return plain
 * data. It never renders HTML, never builds an MCP content envelope, never
 * touches `req`/`res`. Anything host-shaped belongs in tools/ or components/.
 *
 * Everything that can go wrong on the way to a screen is resolved here — auth
 * gaps, empty tenants, throttling, expired sessions — and turned into a state
 * the UI can render without branching on HTTP status codes. That is why both
 * the canvas and the MCP tools can be thin: they call these and present the
 * result.
 *
 * @typedef {import("../domain/types.js").AgentSource} AgentSource
 * @typedef {import("../domain/types.js").RiskStateAction} RiskStateAction
 * @typedef {import("./store.mjs").CanvasStore} CanvasStore
 * @typedef {import("../domain/types.js").AgentRiskAssessment} AgentRiskAssessment
 *
 * The repository is typed as the `AgentSource` port, not as the class that
 * implements it. Depending on the interface is what keeps this layer free of
 * Graph and makes it testable with a four-method stub.
 * @typedef {{ store: CanvasStore, repository: AgentSource }} TriageContext
 */
import { getConfig } from "../../../platform/config.mjs";
import { getToken, signIn } from "../../../platform/auth.mjs";
import { GraphError } from "../../../platform/graph.mjs";

/**
 * Load the tenant's triage queue into the store.
 *
 * Resolves every failure mode into a `status` the UI renders directly:
 *
 *   needs-config  no client id configured
 *   needs-auth    configured, but no usable token (or the session expired)
 *   error         Graph refused, with a hint the analyst can act on
 *   connected     real tenant data
 *
 * There is deliberately no sample or demo mode. A security console that can
 * show invented agents is worse than one that shows nothing: an analyst who
 * mistakes placeholder rows for their tenant draws exactly the wrong
 * conclusion, and the failure is silent.
 *
 * @param {TriageContext} ctx
 * @param {{ limit?: number }} [opts]
 */
export async function refreshQueue({ store, repository }, opts = {}) {
	const { clientId } = getConfig();
	if (!clientId) {
		return store.set({ status: "needs-config", note: "", hint: "", assessments: [], selectedId: null });
	}

	if (!(await getToken())) {
		return store.set({
			status: "needs-auth",
			note: "Sign in to load risky agents from your tenant.",
			hint: "",
			assessments: [],
			selectedId: null,
		});
	}

	try {
		const assessments = await repository.listAssessments({ limit: opts.limit ?? 25, includeDetections: true });

		// Keep the current selection if it survived the refresh; otherwise focus
		// the top of the queue so the detail pane is never blank next to a list.
		const selectedId = assessments.some((a) => a.agentId === store.get().selectedId)
			? store.get().selectedId
			: (assessments[0]?.agentId ?? null);

		store.set({
			status: "connected",
			note: assessments.length === 0 ? "Connected. No agents currently match the risk filters." : "",
			hint: "",
			assessments,
			selectedId,
			lastRefresh: new Date().toISOString(),
		});
	} catch (err) {
		store.set({ ...failureState(err), assessments: [], selectedId: null });
	}
}

/**
 * Interactive sign-in, then load. Optimistic status first so the panel shows
 * progress while the browser round-trip happens.
 *
 * @param {TriageContext} ctx
 */
export async function connect(ctx) {
	ctx.store.set({ status: "signing-in", note: "", hint: "" });
	try {
		await signIn();
	} catch (err) {
		return ctx.store.set({
			status: "error",
			note: err instanceof Error ? err.message : String(err),
			hint: "",
		});
	}
	await refreshQueue(ctx);
}

/**
 * Focus an agent and open its detail view.
 * Throws on an unknown id so a tool call reports the mistake instead of
 * silently blanking the pane.
 *
 * @param {{ store: CanvasStore }} ctx
 * @param {string} agentId
 * @returns {AgentRiskAssessment}
 */
export function selectAgent({ store }, agentId) {
	const found = store.get().assessments.find((a) => a.agentId === agentId);
	if (!found) throw new Error(`No agent ${agentId} in the current queue.`);
	store.navigate("agent-detail", { agentId });
	return found;
}

/**
 * Return to the queue.
 * @param {{ store: CanvasStore }} ctx
 */
export function showQueue({ store }) {
	store.navigate("triage-queue", {});
}

/**
 * Summary of the queue, shaped for a model rather than a screen.
 *
 * Deliberately drops factor evidence and detection detail: the full
 * assessments are large, and a model choosing what to investigate needs the
 * verdict and the reasons, not every timestamp. `explainAgent` has the depth.
 *
 * @param {{ store: CanvasStore }} ctx
 */
export function summarizeQueue({ store }) {
	const s = store.get();
	return {
		status: s.status,
		note: s.note,
		count: s.assessments.length,
		lastRefresh: s.lastRefresh,
		agents: s.assessments.map((a) => ({
			agentId: a.agentId,
			displayName: a.displayName,
			severity: a.severity,
			compositeScore: a.compositeScore,
			entraRiskLevel: a.entraRiskLevel,
			riskState: a.riskState,
			factors: a.factors.map((f) => f.summary),
		})),
	};
}

/**
 * Full detail for one agent.
 *
 * Serves the queue's copy when it has one — the analyst and the model then
 * discuss identical numbers — and falls back to a fetch for an agent outside
 * the current filters, which is how the MCP server answers about any agent id.
 *
 * @param {{ store?: CanvasStore, repository: AgentSource }} ctx
 * @param {string} agentId
 * @param {{ detectionLimit?: number, dataExposure?: import("../domain/types.js").DataExposure, codeExposure?: import("../domain/types.js").CodeExposure }} [opts]
 * @returns {Promise<AgentRiskAssessment>}
 */
export async function explainAgent({ store, repository }, agentId, opts = {}) {
	if (store && !opts.dataExposure && !opts.codeExposure) {
		const cached = store.get().assessments.find((a) => a.agentId === agentId);
		if (cached?.detectionDetail) return cached;
	}
	return repository.getAssessment(agentId, opts);
}

/**
 * Recent tenant-wide detections, grouped by type.
 * Grouping happens here rather than in a tool so the canvas can show the same
 * rollup without reimplementing it.
 *
 * @param {{ repository: AgentSource }} ctx
 * @param {{ hours?: number, limit?: number }} [opts]
 */
export async function recentActivity({ repository }, opts = {}) {
	const since = new Date(Date.now() - (opts.hours ?? 24) * 3_600_000).toISOString();
	const detections = await repository.listRecentDetections(since, opts.limit ?? 50);

	/** @type {Map<string, number>} */
	const byType = new Map();
	for (const d of detections) {
		const key = d.riskEventType ?? "unknown";
		byType.set(key, (byType.get(key) ?? 0) + 1);
	}

	const groups = [...byType.entries()].sort((a, b) => b[1] - a[1]).map(([riskEventType, count]) => ({
		riskEventType,
		count,
	}));

	return { since, count: detections.length, groups, detections };
}

/**
 * Apply a risk-state transition, then re-sync so the canvas cannot keep
 * showing a verdict the tenant no longer holds.
 *
 * The caller is responsible for the confirmation gate — see tools/mcp-tools.mjs.
 * This function assumes approval has already been obtained.
 *
 * @param {{ store?: CanvasStore, repository: AgentSource }} ctx
 * @param {string[]} agentIds
 * @param {RiskStateAction} action
 */
export async function updateRiskState(ctx, agentIds, action) {
	await ctx.repository.updateRiskState(agentIds, action);
	if (ctx.store) {
		await refreshQueue(/** @type {TriageContext} */ (ctx));
	}
	return { action, agentIds, applied: true };
}

/**
 * Turn a thrown error into renderable state.
 *
 * A 401 means the cached token died. Treating that as an error would leave the
 * analyst staring at a message they cannot act on; it is a sign-in prompt.
 *
 * @param {unknown} err
 * @returns {{ status: import("../domain/types.js").CanvasStatus, note: string, hint: string }}
 */
function failureState(err) {
	const status = err instanceof GraphError ? err.status : 0;
	if (status === 401) {
		return { status: "needs-auth", note: "Session expired. Sign in again.", hint: "" };
	}
	return {
		status: "error",
		note: err instanceof Error ? err.message : String(err),
		hint: err instanceof GraphError ? err.remediation : "",
	};
}
