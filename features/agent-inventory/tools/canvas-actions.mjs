/**
 * Canvas actions for the Agents panel.
 *
 * Adapters over the inventory use cases. Named `show_<view>` so routing stays
 * legible to the model from the action name alone.
 *
 * @typedef {import("../usecases/store.mjs").InventoryStore} InventoryStore
 * @typedef {import("../domain/types.js").InventoryRiskLevel} InventoryRiskLevel
 * @typedef {import("../domain/types.js").InventorySource} InventorySource
 * @typedef {import("@github/copilot-sdk/extension").CanvasAction} CanvasAction
 */
import * as inventory from "../usecases/inventory-browse.mjs";

const RISK_LEVELS = /** @type {const} */ (["none", "low", "medium", "high"]);
const SLICES = /** @type {const} */ (["all", "managed", "highRisk", "unowned"]);

/**
 * Keep only recognized risk levels, or null when nothing usable was supplied.
 *
 * A model can invent a band ("severe"), and an unrecognized value stored as a
 * filter would match no rows and blank the table with no visible reason. Null
 * means "say nothing", so the caller falls back to its default rather than
 * narrowing to an empty set.
 *
 * @param {unknown} levels
 * @returns {InventoryRiskLevel[] | null}
 */
function asRiskLevels(levels) {
	if (!Array.isArray(levels)) return null;
	const kept = levels.filter((l) => RISK_LEVELS.includes(l));
	return kept.length > 0 ? kept : null;
}

/**
 * @param {unknown} value
 * @returns {import("../domain/types.js").AgentSlice | null}
 */
function asSlice(value) {
	return SLICES.includes(/** @type {any} */ (value)) ? /** @type {any} */ (value) : null;
}

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
				"and other platforms, with owner, platform, risk and status. Use for 'what are my agents?' or " +
				"'show me all my agents'. Clears any active filter — use show_risky_agents for the risky ones only.",
			inputSchema: { type: "object", properties: {} },
			handler: async () => {
				if (ctx.store.get().agents.length === 0) await inventory.refreshInventory(ctx);
				ctx.store.setFilters({ slice: "all", platforms: [], risks: [], search: "" });
				return inventory.summarizeInventory(ctx);
			},
		},
		{
			name: "show_risky_agents",
			description:
				"Show the agents that need triage: the inventory narrowed to the ones Microsoft Entra ID Protection " +
				"currently scores as risky, worst first. Use for 'what are my risky agents?', 'show me the risky " +
				"agents', 'what needs triage?' and 'which agents are high risk?'.",
			inputSchema: {
				type: "object",
				properties: {
					levels: {
						type: "array",
						items: { type: "string", enum: ["low", "medium", "high"] },
						description: "Risk levels to show. Defaults to high and medium.",
					},
				},
			},
			handler: async (/** @type {{ input: { levels?: string[] } }} */ { input }) => {
				if (ctx.store.get().agents.length === 0) await inventory.refreshInventory(ctx);

				// Replace rather than merge: arriving here from a narrowed table
				// should show the risky agents, not the risky agents that also
				// happen to match whatever was already pinned.
				ctx.store.setFilters({
					slice: "all",
					platforms: [],
					search: "",
					risks: asRiskLevels(input?.levels) ?? ["high", "medium"],
				});
				// Worst first — the whole point of the view is the top of the list.
				ctx.store.set({ sort: { column: "risk", descending: false } });

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
				if (input.search !== undefined) patch.search = String(input.search);
				if (Array.isArray(input.platforms)) patch.platforms = input.platforms.map(String);
				// Unrecognized bands are dropped rather than stored — the same rule
				// the HTTP filter route applies, for the same reason: a filter the
				// domain cannot interpret matches nothing and blanks the table.
				if (input.risks !== undefined) patch.risks = asRiskLevels(input.risks) ?? [];
				if (input.slice !== undefined) {
					const slice = asSlice(input.slice);
					if (slice) patch.slice = slice;
				}

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
				const { status, estateTotal, riskyCount, note } = inventory.summarizeInventory(ctx);
				return { refreshed: true, status, estateTotal, riskyCount, note };
			},
		},
	];
}

/**
 * Hand an agent back to the model — the bidirectional half of a canvas.
 *
 * Preserved from the retired Security Canvas, where it was the "Ask agent to
 * investigate" button. It carries the row's facts inline so the model can reason
 * without a round-trip, and states what is *not* known: an inventory row has no
 * detection history, so a model told only "risk: high" would happily invent the
 * reasons. Pointing it at explain_agent_risk is what keeps the answer grounded.
 *
 * @param {{ store: InventoryStore, getSession: () => any }} ctx
 * @param {string} agentId
 * @returns {boolean}
 */
export function requestInvestigation({ store, getSession }, agentId) {
	const a = store.get().agents.find((x) => x.agentId === agentId);
	if (!a) return false;

	const owner = (a.owner ?? "").trim() || "nobody (unassigned)";
	const exposure =
		a.publiclyExposed === true
			? "publicly exposed"
			: a.publiclyExposed === false
				? "not publicly exposed"
				: "exposure not evaluated";

	getSession()?.send({
		prompt:
			`Investigate the agent "${a.title}" (id: ${a.agentId}) shown on the Agents canvas. ` +
			`Publisher ${a.publisher}, platform ${a.platform}, owner ${owner}, status ${a.status}. ` +
			`Entra ID Protection risk: ${a.riskLevel}. It is ${exposure}. ` +
			`This row carries no detection history — call explain_agent_risk with this agent id for the ` +
			`signals behind that risk level, and do not infer the reasons from the level alone. ` +
			`Assess whether this is a true positive, what the blast radius is, and recommend next steps. ` +
			`Do not change the agent's risk state without asking me first.`,
	});
	return true;
}
