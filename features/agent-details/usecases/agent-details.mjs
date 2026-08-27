/**
 * Use cases for the agent-details page.
 *
 * The middle layer, held to the same rule as the other two features: a use case
 * may touch the repository and the store, and must return plain data. It never
 * renders HTML, never builds an MCP envelope, never touches `req`/`res`.
 *
 * ### The two-phase load is the design, not an optimisation
 *
 * The catalog row alone builds the header, the identity list, the risk donut
 * and the posture panel. The detail document only fills in the access card and
 * the graph. So the page is published in two commits: everything the row knows
 * lands immediately with `graphLoading: true`, and the depth folds in when it
 * arrives.
 *
 * Blocking the whole page on the cold read would hide facts already in hand
 * behind a spinner — and worse, it would make the page's arrival time depend on
 * the slowest of three calls, which is exactly the "glitchy" appearance the
 * shimmering placeholder exists to replace.
 *
 * @typedef {import("../domain/types.js").AgentDetailsSource} AgentDetailsSource
 * @typedef {import("../domain/types.js").AgentDetailsVM} AgentDetailsVM
 * @typedef {import("./store.mjs").DetailsStore} DetailsStore
 * @typedef {{ store: DetailsStore, repository: AgentDetailsSource }} DetailsContext
 */
import { getToken } from "../../../platform/auth.mjs";
import { GraphError } from "../../../platform/graph.mjs";
import { InventoryError } from "../../../platform/inventory-client.mjs";
import { buildAgentDetails } from "../domain/details-adapter.mjs";

/**
 * Load one agent into the store, in two phases.
 *
 * Resolves every failure mode into a `status` the UI renders directly:
 *
 *   needs-auth   no usable token, or the session expired
 *   not-found    the tenant's catalog holds no row for this id
 *   error        the service refused, with a hint the analyst can act on
 *   connected    real tenant data
 *
 * There is deliberately no sample mode. A security page that can show invented
 * facts about a named agent is worse than one that shows nothing: an analyst
 * who mistakes placeholder values for their tenant draws exactly the wrong
 * conclusion, and the failure is silent.
 *
 * @param {DetailsContext} ctx
 * @param {string} agentId
 * @returns {Promise<AgentDetailsVM | null>}
 */
export async function loadAgent({ store, repository }, agentId) {
	const id = String(agentId ?? "").trim();
	if (!id) {
		store.set({ status: "not-found", note: "No agent id was supplied.", hint: "", vm: null, graphLoading: false });
		return null;
	}

	store.focus(id);

	if (!(await getToken())) {
		store.set({
			status: "needs-auth",
			note: "Sign in to load this agent's details from your tenant.",
			hint: "",
			vm: null,
			graphLoading: false,
		});
		return null;
	}

	/** @type {import("../domain/types.js").InventoryAgent | null} */
	let row;
	try {
		row = await repository.getAgentRow(id);
	} catch (err) {
		// Also guarded: an error about the agent the reader has already navigated
		// away from must not replace the page they are now looking at.
		if (store.get().agentId === id) store.set({ ...failureState(err), vm: null, graphLoading: false });
		return null;
	}

	if (!row) {
		if (store.get().agentId !== id) return null;
		store.set({
			status: "not-found",
			// Worded as the weaker claim it actually is. The catalog indexes only
			// flagged agents, so a miss is "we hold no row", not "no such agent"
			// — and telling an analyst an agent does not exist when it simply is
			// not flagged would send them looking for a deletion that never
			// happened.
			note: `No inventory row for agent ${id}. The catalog lists agents that are risky, unowned, publicly exposed, or unmonitored.`,
			hint: "",
			vm: null,
			graphLoading: false,
		});
		return null;
	}

	// Phase one: publish everything the row knows, immediately.
	//
	// Guarded, like phase two: a second focus can land while the row read is in
	// flight, and publishing unconditionally would put this agent's facts under
	// the other agent's id. The check is at *both* publish points because both
	// follow an await — covering only the slower one leaves the faster race
	// open, and it is the harder one to notice.
	if (store.get().agentId !== id) return null;

	const shallow = buildAgentDetails(row, null, null);
	store.set({
		status: "connected",
		note: "",
		hint: "",
		agentId: row.agentId,
		vm: shallow,
		graphLoading: true,
		lastRefresh: new Date().toISOString(),
	});

	// Phase two: the depth. Both reads are independent and both degrade to null,
	// so `Promise.all` is safe here — neither can reject the pair.
	const [detail, exposure] = await Promise.all([
		repository.getAgentDetail(row.agentId).catch(() => null),
		repository.getAgentExposure(row.agentId).catch(() => null),
	]);

	// A second focus may have landed while this was in flight. Publishing now
	// would put this agent's graph under the other agent's name.
	if (store.get().agentId !== row.agentId) return shallow;

	const full = buildAgentDetails(row, detail, exposure);
	store.set({ vm: full, graphLoading: false, lastRefresh: new Date().toISOString() });
	return full;
}

/**
 * One agent's details, without touching the canvas.
 *
 * This is what the MCP tool calls. It serves the store's copy when it already
 * holds the agent — so the analyst and the model discuss identical numbers —
 * and otherwise reads through, which is how the MCP server answers about an
 * agent nobody has opened.
 *
 * @param {{ store?: DetailsStore, repository: AgentDetailsSource }} ctx
 * @param {string} agentId
 * @returns {Promise<AgentDetailsVM | null>}
 */
export async function describeAgent({ store, repository }, agentId) {
	const id = String(agentId ?? "").trim();
	if (!id) return null;

	const cached = store?.get();
	// Only a fully-loaded copy counts. Serving the phase-one view model would
	// report "no connected resources" for an agent whose graph simply had not
	// arrived yet — a fabricated finding, which is the one thing this page is
	// built not to do.
	if (cached?.vm && !cached.graphLoading && cached.vm.agentId.toLowerCase() === id.toLowerCase()) {
		return cached.vm;
	}

	const row = await repository.getAgentRow(id);
	if (!row) return null;

	const [detail, exposure] = await Promise.all([
		repository.getAgentDetail(row.agentId).catch(() => null),
		repository.getAgentExposure(row.agentId).catch(() => null),
	]);

	return buildAgentDetails(row, detail, exposure);
}

/**
 * The page as a model reads it: the verdict, the facts, and the reach.
 *
 * Deliberately not the whole view model. The relationship graph is positions
 * and glyph keys — a large payload that says nothing a model can reason about,
 * since it is a picture. The counts it encodes are here instead.
 *
 * @param {AgentDetailsVM} vm
 */
export function summarizeAgent(vm) {
	return {
		agentId: vm.agentId,
		name: vm.name,
		publisher: vm.publisher,
		governance: vm.governance?.kind,
		verified: vm.verified,
		score: vm.risk.score,
		band: vm.risk.band,
		posture: vm.posture.status,
		facts: Object.fromEntries(
			vm.identityRows.map((row) => [
				row.key,
				row.known ? (row.value ?? row.facepile?.join(", ") ?? true) : null,
			]),
		),
		unmetGoals: vm.risk.verdicts.filter((v) => v.applies && !v.met).map((v) => v.summary),
		notEvaluated: vm.risk.verdicts.filter((v) => !v.applies).map((v) => v.summary),
		access: {
			permissions: vm.access.permissions.length,
			resources: vm.access.resourceTotal,
			named: vm.access.resources.map((r) => r.name),
			hasProfile: vm.access.hasProfile,
		},
		graph: { nodes: vm.accessGraph.nodes.length, edges: vm.accessGraph.edges.length },
	};
}

/**
 * Turn a thrown error into renderable state.
 *
 * A 401 means the cached token died. Treating that as an error would leave the
 * analyst staring at a message they cannot act on; it is a sign-in prompt.
 *
 * @param {unknown} err
 * @returns {{ status: import("../domain/types.js").DetailsStatus, note: string, hint: string }}
 */
function failureState(err) {
	const known = err instanceof InventoryError || err instanceof GraphError;
	if (known && err.status === 401) {
		return { status: "needs-auth", note: "Session expired. Sign in again.", hint: "" };
	}
	return {
		status: "error",
		note: err instanceof Error ? err.message : String(err),
		hint: known ? err.remediation : "",
	};
}
