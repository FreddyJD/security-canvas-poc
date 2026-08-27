/**
 * Canvas actions — what the model can drive on the panel.
 *
 * These are adapters, not logic. Each one validates its input, calls a use
 * case, and returns model-readable JSON. When an action and an MCP tool do the
 * same job they call the same use case, which is why the two surfaces cannot
 * drift apart.
 *
 * Naming follows the `show_<view>` convention so routing is legible to the
 * model from the action name alone.
 *
 * @typedef {import("../usecases/store.mjs").CanvasStore} CanvasStore
 * @typedef {import("../domain/types.js").AgentSource} AgentSource
 * @typedef {import("@github/copilot-sdk/extension").CanvasAction} CanvasAction
 */
import * as triage from "../usecases/agent-triage.mjs";

/**
 * @param {{ store: CanvasStore, repository: AgentSource, getSession: () => any }} ctx
 * @returns {CanvasAction[]}
 */
export function createCanvasActions(ctx) {
	return [
		{
			name: "show_triage_queue",
			description:
				"Show the triage queue: every risky agent with its composite score, severity, and contributing factors. " +
				"Use for 'what are my risky agents?' and to return to the list after looking at one agent.",
			inputSchema: { type: "object", properties: {} },
			handler: () => {
				triage.showQueue(ctx);
				return triage.summarizeQueue(ctx);
			},
		},
		{
			name: "show_agent_detail",
			description:
				"Focus one agent in the canvas and return its full assessment: every detection with its meaning, " +
				"impact, and recommended remediation. Use after show_triage_queue to investigate a specific agent.",
			inputSchema: {
				type: "object",
				properties: {
					agentId: { type: "string", description: "Agent id from show_triage_queue." },
				},
				required: ["agentId"],
			},
			handler: async (/** @type {{ input: { agentId: string } }} */ { input }) => {
				// Navigate first so the analyst sees the agent the model is about
				// to discuss, rather than after a slow fetch.
				triage.selectAgent(ctx, input.agentId);
				return triage.explainAgent(ctx, input.agentId);
			},
		},
		{
			name: "refresh_queue",
			description: "Re-query Microsoft Graph and rebuild the triage queue with current tenant data.",
			inputSchema: { type: "object", properties: {} },
			handler: async () => {
				await triage.refreshQueue(ctx);
				const { status, count, note } = triage.summarizeQueue(ctx);
				return { refreshed: true, status, count, note };
			},
		},
		{
			name: "sign_in",
			description:
				"Open the browser so the user can sign in to Microsoft Entra, then load their risky agents. " +
				"Use when the canvas reports it is not signed in.",
			inputSchema: { type: "object", properties: {} },
			handler: async () => {
				await triage.connect(ctx);
				const { status, count } = triage.summarizeQueue(ctx);
				return { signedIn: status === "connected", status, count };
			},
		},
	];
}

/**
 * Hand the selected agent back to the model — the bidirectional half of a canvas.
 *
 * The prompt carries the score and factors inline so the model can reason
 * without a round-trip, and ends with an explicit instruction not to change
 * risk state unprompted: a canvas button should never be able to escalate into
 * a tenant write on its own.
 *
 * @param {{ store: CanvasStore, getSession: () => any }} ctx
 * @param {string} agentId
 */
export function requestInvestigation({ store, getSession }, agentId) {
	const a = store.get().assessments.find((x) => x.agentId === agentId);
	if (!a) return false;

	getSession()?.send({
		prompt:
			`Investigate the risky agent "${a.displayName}" (id: ${a.agentId}) shown on the Security Canvas. ` +
			`It scores ${a.compositeScore}/100 (${a.severity}), Entra risk ${a.entraRiskLevel}, state ${a.riskState}. ` +
			`Contributing factors: ${a.factors.map((f) => f.summary).join("; ") || "none recorded"}. ` +
			`Assess whether this is a true positive, what the blast radius is, and recommend next steps. ` +
			`Do not change the agent's risk state without asking me first.`,
	});
	return true;
}
