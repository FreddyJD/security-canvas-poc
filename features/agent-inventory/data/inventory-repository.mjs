/**
 * Repository for the agent inventory.
 *
 * The only layer that knows the inventory API exists. Use cases above it get
 * plain domain data; the client below knows nothing about filtering or metrics.
 *
 * @typedef {import("../domain/types.js").AgentCatalog} AgentCatalog
 * @typedef {import("../domain/types.js").InventorySource} InventorySource
 * @typedef {import("../domain/types.js").InventorySummary} InventorySummary
 */
import { InventoryClient } from "../../../platform/inventory-client.mjs";

/** @implements {InventorySource} */
export class InventoryRepository {
	/** @param {InventoryClient} [client] */
	constructor(client) {
		this.client = client ?? new InventoryClient();
	}

	/**
	 * @param {{ risk?: boolean, flagged?: boolean, maxCount?: number }} [opts]
	 * @returns {Promise<AgentCatalog>}
	 */
	async listAgents(opts = {}) {
		return this.client.listAgents(opts);
	}

	/**
	 * The tenant aggregate, or null when it cannot be read.
	 *
	 * Failure is swallowed on purpose: the summary supplies the headline totals,
	 * but the table is perfectly usable without it. Letting a 503 on the summary
	 * take down a catalog that loaded fine would be trading a complete screen
	 * for an error page.
	 *
	 * @returns {Promise<InventorySummary | null>}
	 */
	async getSummary() {
		try {
			return await this.client.getSummary();
		} catch {
			return null;
		}
	}
}
