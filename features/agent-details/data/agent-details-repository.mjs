/**
 * Repository for one agent's detail.
 *
 * The only layer that knows the inventory API exists. Use cases above it get
 * plain domain objects; the client below knows nothing about how the three
 * reads are combined.
 *
 * ### Three reads, three different failure meanings
 *
 * The catalog row is required — without it there is no page. The detail
 * document and the exposure rollup are enrichments, and each is degraded to
 * `null` independently rather than failing the set. That asymmetry is the whole
 * reason they are separate methods: an agent whose blast radius has not been
 * projected yet still has an owner, a platform, a risk band and a posture, and
 * taking the page down to hide a missing graph would be trading a mostly-complete
 * screen for an error message.
 *
 * @typedef {import("../domain/types.js").AgentDetail} AgentDetail
 * @typedef {import("../domain/types.js").AgentDetailsSource} AgentDetailsSource
 * @typedef {import("../domain/types.js").AgentExposure} AgentExposure
 * @typedef {import("../domain/types.js").InventoryAgent} InventoryAgent
 */
import { InventoryClient, InventoryError } from "../../../platform/inventory-client.mjs";

/** @implements {AgentDetailsSource} */
export class AgentDetailsRepository {
	/**
	 * @param {InventoryClient} [client]
	 * @param {{ listAgents: (opts?: any) => Promise<{ agents: InventoryAgent[] }> }} [catalog]
	 *   Where the row is looked up. Defaults to the client's own catalog call,
	 *   but the canvas passes the inventory repository it already holds — so
	 *   clicking a row on the Agents panel opens this page without re-reading a
	 *   catalog that is already in memory, and the two surfaces cannot show
	 *   different facts about the same agent.
	 */
	constructor(client, catalog) {
		this.client = client ?? new InventoryClient();
		this.catalog = catalog ?? this.client;
	}

	/**
	 * The catalog row for one agent.
	 *
	 * Matched case-insensitively because the id travels through a tool call, a
	 * URL and a click, and an id that differs only in case is the same agent —
	 * failing to find it would look like the agent does not exist.
	 *
	 * Returns `null` rather than throwing on a miss: the catalog indexes only
	 * agents that carry risk, so absence is genuinely "we hold no row for this",
	 * which is weaker than "no such agent" and must not be reported as an error.
	 *
	 * `risk: true` matches what the Agents panel lists, so a row that is
	 * clickable there always resolves here. Without it this read and that list
	 * would be different sets, and the panel could open a page that reports the
	 * agent does not exist.
	 *
	 * @param {string} agentId
	 * @returns {Promise<InventoryAgent | null>}
	 */
	async getAgentRow(agentId) {
		const wanted = String(agentId ?? "").trim().toLowerCase();
		if (!wanted) return null;

		const catalog = await this.catalog.listAgents({ risk: true, maxCount: 200 });
		const rows = catalog?.agents ?? [];
		return rows.find((row) => String(row.agentId ?? "").toLowerCase() === wanted) ?? null;
	}

	/**
	 * The per-agent detail document.
	 *
	 * A 404 is `null`, not a throw: the service answers 404 when neither the
	 * detail nor the catalog holds the id, and this page has already resolved
	 * the row by the time it asks — so the honest reading is "no depth was
	 * projected for this agent", which the access card renders as an empty
	 * state. Every other status still throws, because a 503 or a 403 is a
	 * failure the analyst can act on and must not be shown as "no data".
	 *
	 * @param {string} agentId
	 * @returns {Promise<AgentDetail | null>}
	 */
	async getAgentDetail(agentId) {
		try {
			return await this.client.get(`/inventory/agents/${encodeURIComponent(agentId)}`);
		} catch (err) {
			if (err instanceof InventoryError && err.status === 404) return null;
			throw err;
		}
	}

	/**
	 * The exposure rollup.
	 *
	 * Failure is swallowed entirely. This is a second opinion on reach that the
	 * detail document usually already answers; letting it take down a page that
	 * has everything else would be the tail wagging the dog.
	 *
	 * Note the shape it can return: `resolved: false` is a 200, and it means the
	 * agent mapped to no exposure-graph node — NOT that it reaches nothing. The
	 * adapter preserves that distinction.
	 *
	 * @param {string} agentId
	 * @returns {Promise<AgentExposure | null>}
	 */
	async getAgentExposure(agentId) {
		try {
			return await this.client.get(`/inventory/agents/${encodeURIComponent(agentId)}/exposure`);
		} catch {
			return null;
		}
	}
}
