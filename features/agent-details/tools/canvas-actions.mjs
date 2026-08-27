/**
 * Canvas actions — what the model can drive on the details panel.
 *
 * Adapters, not logic. Each validates its input, calls a use case, and returns
 * model-readable JSON. `show_agent_details` and the `get_agent_details` MCP
 * tool call the same use cases, which is why the two surfaces cannot drift
 * apart about the same agent.
 *
 * Named `show_<view>` so routing stays legible to the model from the action
 * name alone.
 *
 * @typedef {import("../domain/types.js").AgentDetailsSource} AgentDetailsSource
 * @typedef {import("../usecases/store.mjs").DetailsStore} DetailsStore
 * @typedef {import("@github/copilot-sdk/extension").CanvasAction} CanvasAction
 */
import * as details from "../usecases/agent-details.mjs";

/**
 * @param {{ store: DetailsStore, repository: AgentDetailsSource, getSession: () => any }} ctx
 * @returns {CanvasAction[]}
 */
export function createDetailsActions(ctx) {
	return [
		{
			name: "show_agent_details",
			description:
				"Open one agent's detail page on the canvas and return everything known about it: its identity " +
				"facts, its unified secure score and the goals it fails, its protection posture, the resources it " +
				"can reach, and a pan-and-zoom graph of how it reaches them. " +
				"Use for 'tell me more about agent X' or after show_agent_inventory to investigate one row.",
			inputSchema: {
				type: "object",
				properties: {
					agentId: { type: "string", description: "Agent id from show_agent_inventory or list_agents." },
				},
				required: ["agentId"],
			},
			handler: async (/** @type {{ input: { agentId: string } }} */ { input }) => {
				// The load publishes phase one — everything the catalog row knows —
				// before the detail document lands, so the panel is populated by the
				// time this resolves rather than after the slowest of three calls.
				const vm = await details.loadAgent(ctx, input.agentId);
				if (!vm) {
					const state = ctx.store.get();
					return { shown: false, status: state.status, note: state.note };
				}
				return { shown: true, ...details.summarizeAgent(vm) };
			},
		},
		{
			name: "refresh_agent_details",
			description: "Re-read the currently open agent's details from the tenant.",
			inputSchema: { type: "object", properties: {} },
			handler: async () => {
				const current = ctx.store.get().agentId;
				if (!current) return { refreshed: false, note: "No agent is open on the details panel." };
				const vm = await details.loadAgent(ctx, current);
				return vm
					? { refreshed: true, ...details.summarizeAgent(vm) }
					: { refreshed: false, status: ctx.store.get().status, note: ctx.store.get().note };
			},
		},
	];
}
