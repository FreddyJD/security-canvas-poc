/**
 * Use cases for the agent inventory.
 *
 * Same rule as the risky-agents layer: touch the repository and the store,
 * return plain data, never render. Everything that can go wrong on the way to
 * the screen resolves here into a `status` the UI draws without branching on
 * HTTP codes.
 *
 * @typedef {import("../domain/types.js").InventorySource} InventorySource
 * @typedef {import("./store.mjs").InventoryStore} InventoryStore
 * @typedef {import("../domain/types.js").InventoryAgent} InventoryAgent
 * @typedef {{ store: InventoryStore, repository: InventorySource }} InventoryContext
 */
import { getToken, signIn } from "../../../platform/auth.mjs";
import { InventoryError } from "../../../platform/inventory-client.mjs";
import { GraphError } from "../../../platform/graph.mjs";
import { buildMetrics, filterAgents, platformsIn, sortAgents } from "../domain/presentation.mjs";

/**
 * Load the estate.
 *
 * The catalog and the summary are fetched together because they answer
 * different questions and the screen needs both: the catalog is the flagged
 * rows the table lists, the summary is the only place the true estate total
 * lives. They are independent, so `Promise.all` — and the repository already
 * degrades the summary to null rather than failing the pair.
 *
 * @param {InventoryContext} ctx
 * @param {{ maxCount?: number }} [opts]
 */
export async function refreshInventory({ store, repository }, opts = {}) {
	if (!(await getToken())) {
		return store.set({
			status: "needs-auth",
			note: "Sign in to load the agent inventory for your tenant.",
			hint: "",
			agents: [],
			summary: null,
		});
	}

	try {
		const [catalog, summary] = await Promise.all([
			repository.listAgents({ maxCount: opts.maxCount ?? 200 }),
			repository.getSummary(),
		]);

		const agents = catalog.agents ?? [];
		store.set({
			status: "connected",
			note: noteFor(agents, summary),
			hint: "",
			agents,
			summary,
			lastRefresh: new Date().toISOString(),
		});
	} catch (err) {
		store.set({ ...failureState(err), agents: [], summary: null });
	}
}

/**
 * Interactive sign-in, then load.
 *
 * The Sign in button on the gate has always POSTed to `/api/connect`; until
 * this existed that route was not registered on the inventory server and the
 * button 404'd silently, leaving the panel on the gate with no feedback. It
 * only mattered once the Agents canvas became the only place to sign in.
 *
 * Status goes to `loading` first so the gate shows progress while the browser
 * round-trip happens, rather than looking dead for several seconds.
 *
 * @param {InventoryContext} ctx
 */
export async function connect(ctx) {
	ctx.store.set({ status: "loading", note: "Waiting for sign-in…", hint: "" });
	try {
		await signIn();
	} catch (err) {
		return ctx.store.set({
			status: "error",
			note: err instanceof Error ? err.message : String(err),
			hint: "",
		});
	}
	await refreshInventory(ctx);
}

/**
 * What the strip above the table says about what is on screen.
 *
 * The catalog is the *flagged* subset, so saying so is not a caveat — it is the
 * difference between "your tenant has 300 agents" and "300 of your 788 agents
 * need attention". Staying silent would let the table be read as the estate.
 *
 * @param {readonly InventoryAgent[]} agents
 * @param {import("../domain/types.js").InventorySummary | null} summary
 */
function noteFor(agents, summary) {
	if (agents.length === 0) {
		return "Connected. No agents are currently flagged in this tenant.";
	}
	const total = summary?.agents?.total;
	if (typeof total === "number" && total > agents.length) {
		return `Showing ${agents.length.toLocaleString()} flagged agents of ${total.toLocaleString()} in the estate. The inventory API serves agents that are risky, unowned, publicly exposed, or unmonitored.`;
	}
	return "";
}

/**
 * The rows currently on screen, after filter, sort and paging.
 *
 * Derived rather than stored: keeping a second "visible agents" array in the
 * store would let it fall out of step with the filters that produced it. The
 * cost is recomputation per render, which is trivial at inventory scale.
 *
 * @param {{ store: InventoryStore }} ctx
 */
export function visibleAgents({ store }) {
	const { agents, filters, sort, page, pageSize } = store.get();
	const matched = sortAgents(filterAgents(agents, filters), sort);
	const start = page * pageSize;

	return {
		rows: matched.slice(start, start + pageSize),
		matchedCount: matched.length,
		totalCount: agents.length,
		pageCount: Math.max(1, Math.ceil(matched.length / pageSize)),
	};
}

/**
 * Everything the screen needs in one object.
 *
 * Assembled here rather than in the browser so the view stays a pure function
 * of it, and so the same numbers can be handed to a model.
 *
 * @param {{ store: InventoryStore }} ctx
 */
export function inventoryViewModel({ store }) {
	const state = store.get();
	const view = visibleAgents({ store });

	return {
		...view,
		metrics: buildMetrics(state.agents, state.summary),
		platforms: platformsIn(state.agents),
		filters: state.filters,
		sort: state.sort,
		page: state.page,
		pageSize: state.pageSize,
		status: state.status,
		note: state.note,
		hint: state.hint,
		lastRefresh: state.lastRefresh,
	};
}

/**
 * A model-facing summary of the estate.
 *
 * Deliberately not the full rows: 200 agents with nested protection and
 * identity objects is a large payload that mostly repeats. This gives the
 * shape of the estate plus a sample, and `list_agents` can filter for detail.
 *
 * @param {{ store: InventoryStore }} ctx
 * @param {{ sample?: number }} [opts]
 */
export function summarizeInventory({ store }, opts = {}) {
	const state = store.get();
	const { rows, matchedCount } = visibleAgents({ store });
	const metrics = buildMetrics(state.agents, state.summary);

	return {
		status: state.status,
		note: state.note,
		estateTotal: state.summary?.agents?.total ?? state.agents.length,
		flaggedCount: state.agents.length,
		matchedCount,
		byRiskLevel: state.summary?.agents?.byRiskLevel ?? countBy(state.agents, (a) => a.riskLevel),
		byPlatform: state.summary?.agents?.byPlatform ?? countBy(state.agents, (a) => a.platform),
		metrics: metrics.map((m) => ({ label: m.label, value: m.value })),
		agents: rows.slice(0, opts.sample ?? 25).map((a) => ({
			agentId: a.agentId,
			title: a.title,
			publisher: a.publisher,
			platform: a.platform,
			owner: a.owner,
			riskLevel: a.riskLevel,
			status: a.status,
			lastActivity: a.lastActivity,
		})),
	};
}

/**
 * @template T
 * @param {readonly T[]} items
 * @param {(item: T) => string} key
 * @returns {Record<string, number>}
 */
function countBy(items, key) {
	/** @type {Record<string, number>} */
	const out = {};
	for (const item of items) {
		const k = key(item) || "Unknown";
		out[k] = (out[k] ?? 0) + 1;
	}
	return out;
}

/**
 * Turn a thrown error into renderable state.
 *
 * A 401 is a sign-in prompt, not an error screen — the analyst can act on it.
 * A 503 from this service is explicitly retryable and says so.
 *
 * @param {unknown} err
 */
function failureState(err) {
	if ((err instanceof InventoryError || err instanceof GraphError) && err.status === 401) {
		return { status: /** @type {const} */ ("needs-auth"), note: "Session expired. Sign in again.", hint: "" };
	}
	return {
		status: /** @type {const} */ ("error"),
		note: err instanceof Error ? err.message : String(err),
		hint: err instanceof InventoryError || err instanceof GraphError ? err.remediation : "",
	};
}
