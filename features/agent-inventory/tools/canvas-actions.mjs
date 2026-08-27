/**
 * Canvas actions for the Agents panel.
 *
 * Adapters over the inventory use cases. Named `show_<view>` so routing stays
 * legible to the model from the action name alone.
 *
 * @typedef {import("../usecases/store.mjs").InventoryStore} InventoryStore
 * @typedef {import("../domain/types.js").InventorySource} InventorySource
 * @typedef {import("@github/copilot-sdk/extension").CanvasAction} CanvasAction
 */
import * as inventory from "../usecases/inventory-browse.mjs";

/**
 * @param {{ store: InventoryStore, repository: InventorySource, getSession: () => any }} ctx
 * @returns {CanvasAction[]}
 */
export function createInventoryActions(ctx) {
	return [
		{
			name: "show_agent_inventory",
			description:
				"Show the full agent inventory: every agent across Microsoft 365 Copilot, Copilot Studio, Endpoint " +
				"and other platforms, with owner, platform, risk and status. Use for 'what are my agents?', " +
				"'show me all my agents', or to see the estate rather than just the risky ones.",
			inputSchema: { type: "object", properties: {} },
			handler: async () => {
				if (ctx.store.get().agents.length === 0) await inventory.refreshInventory(ctx);
				ctx.store.setFilters({ slice: "all", platforms: [], risks: [], search: "" });
				return inventory.summarizeInventory(ctx);
			},
		},
		{
			name: "filter_agent_inventory",
			description:
				"Narrow the agent inventory shown on the canvas by free-text search, platform, or risk level, " +
				"and report what matched. Use after show_agent_inventory for questions like " +
				"'which of them are high risk?' or 'show only Copilot Studio agents'.",
			inputSchema: {
				type: "object",
				properties: {
					search: { type: "string", description: "Free text matched against name, publisher, owner and platform." },
					platforms: {
						type: "array",
						items: { type: "string" },
						description: 'Platform labels to keep, e.g. ["M365 Copilot", "Copilot Studio"].',
					},
					risks: {
						type: "array",
						items: { type: "string", enum: ["none", "low", "medium", "high"] },
						description: "Risk levels to keep.",
					},
					slice: {
						type: "string",
						enum: ["all", "managed", "highRisk", "unowned"],
						description: "A headline slice: all agents, managed, high risk, or without owners.",
					},
				},
			},
			handler: async (/** @type {{ input: Record<string, any> }} */ { input }) => {
				if (ctx.store.get().agents.length === 0) await inventory.refreshInventory(ctx);

				/** @type {Record<string, unknown>} */
				const patch = {};
				if (input.search !== undefined) patch.search = input.search;
				if (input.platforms !== undefined) patch.platforms = input.platforms;
				if (input.risks !== undefined) patch.risks = input.risks;
				if (input.slice !== undefined) patch.slice = input.slice;

				ctx.store.setFilters(patch);
				return inventory.summarizeInventory(ctx);
			},
		},
		{
			name: "refresh_agent_inventory",
			description: "Re-read the agent inventory from the tenant and rebuild the table with current data.",
			inputSchema: { type: "object", properties: {} },
			handler: async () => {
				await inventory.refreshInventory(ctx);
				const { status, estateTotal, flaggedCount, note } = inventory.summarizeInventory(ctx);
				return { refreshed: true, status, estateTotal, flaggedCount, note };
			},
		},
	];
}
