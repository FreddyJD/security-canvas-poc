/**
 * MCP tools for agent details — the portable surface.
 *
 * Adapters over the same use cases the canvas drives. Each tool validates input
 * with zod, calls a use case, and formats the result; none of them compute a
 * score or talk to the API directly.
 *
 * Read-only: this is a detail view, and the inventory API exposes no writes on
 * these routes.
 *
 * @typedef {import("../domain/types.js").AgentDetailsSource} AgentDetailsSource
 */
import { z } from "zod";
import { GraphError } from "../../../platform/graph.mjs";
import { InventoryError } from "../../../platform/inventory-client.mjs";
import * as details from "../usecases/agent-details.mjs";
import { renderAgentDetails } from "./render-text.mjs";

/**
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 * @param {{ repository: AgentDetailsSource, store?: import("../usecases/store.mjs").DetailsStore }} ctx
 */
export function registerDetailsTools(server, ctx) {
	server.registerTool(
		"get_agent_details",
		{
			title: "Get agent details",
			description:
				"Everything known about ONE agent: its identity facts (owner, sponsors, agent id, identity type, " +
				"publisher, platform, last used, authentication), its unified secure score with the specific goals " +
				"it fails, its protection posture across Conditional Access, Microsoft Defender and Microsoft " +
				"Purview DLP, and the resources it can reach. " +
				"Use for 'tell me more about agent X', 'who owns X?', 'why is X's score low?', or 'what can X " +
				"access?'. Call list_agents first to find the agent id. " +
				"Unmeasured facts are reported as 'not available' and unevaluated controls are listed separately " +
				"from failed ones — do not report an unevaluated control as a security gap.",
			inputSchema: {
				agentId: z
					.string()
					.min(1)
					.describe("The agent's id, as served on agents[].agentId by list_agents."),
			},
			annotations: { readOnlyHint: true, openWorldHint: true },
		},
		async ({ agentId }) => {
			try {
				const vm = await details.describeAgent(ctx, agentId);
				if (!vm) {
					// Worded as the weaker claim it is: the catalog indexes only
					// flagged agents, so a miss is "we hold no row", not "no such
					// agent" — and telling a model the agent does not exist would
					// send the analyst looking for a deletion that never happened.
					return {
						content: content(
							`No inventory row for agent ${agentId}. The catalog lists agents that are risky, unowned, ` +
								`publicly exposed, or unmonitored — an agent outside that set is not enumerable here. ` +
								`Check the id with list_agents.`,
						),
						isError: true,
					};
				}

				return {
					content: content(renderAgentDetails(vm)),
					structuredContent: details.summarizeAgent(vm),
				};
			} catch (err) {
				return fail(err);
			}
		},
	);
}

/**
 * Wrap text in the MCP content envelope.
 *
 * The literal type annotation is load-bearing: the SDK's result type requires
 * the literal "text", and an unannotated object literal widens `type` to
 * `string`, which fails to typecheck at every registerTool call site.
 *
 * @param {string} text
 * @returns {[{ type: "text", text: string }]}
 */
function content(text) {
	return [{ type: "text", text }];
}

/** @param {unknown} err */
function fail(err) {
	const text =
		err instanceof InventoryError || err instanceof GraphError
			? `Inventory error (${err.status}${err.code ? ` ${err.code}` : ""}): ${err.message}\n\n${err.remediation}`
			: `Unexpected error: ${err instanceof Error ? err.message : String(err)}`;
	return { content: content(text), isError: true };
}
