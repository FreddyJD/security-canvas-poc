#!/usr/bin/env node
/**
 * MCP host — stdio server for Copilot app, VS Code, Security Copilot,
 * Copilot Studio, and Foundry.
 *
 * Composition root only. It shares the repository, the scoring engine, and the
 * use cases with the canvas, so the two surfaces cannot disagree about which
 * agents are risky or how severe they are.
 *
 * Transport is stdio, so stdout belongs to JSON-RPC. All diagnostics go to
 * stderr — a stray console.log here corrupts the protocol and the client
 * disconnects with an opaque parse error.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AgentRepository } from "./features/risky-agents/data/agent-repository.mjs";
import { registerTools } from "./features/risky-agents/tools/mcp-tools.mjs";
import { InventoryRepository } from "./features/agent-inventory/data/inventory-repository.mjs";
import { registerInventoryTools } from "./features/agent-inventory/tools/mcp-tools.mjs";

async function main() {
	const server = new McpServer(
		{ name: "security-canvas", version: "0.1.0" },
		{
			instructions:
				"Agent inventory and cross-pillar security triage for a Microsoft tenant.\n\n" +
				"For 'what are my agents?' start with list_agents — the whole estate across Microsoft 365 Copilot, " +
				"Copilot Studio, Endpoint and other platforms — or get_agent_estate_summary for totals only.\n\n" +
				"For security triage start with list_risky_agents to find flagged Entra agent identities, then " +
				"explain_agent_risk for a single agent's detection history, and assess_agent_blast_radius to weigh " +
				"identity risk against data and code exposure.\n\n" +
				"All read tools respect the signed-in analyst's Entra RBAC. " +
				"update_agent_risk_state changes security posture: always confirm with the user first.",
		},
	);

	registerTools(server, new AgentRepository());
	registerInventoryTools(server, new InventoryRepository());

	await server.connect(new StdioServerTransport());
	process.stderr.write("[security-canvas] MCP server ready on stdio\n");
}

main().catch((err) => {
	process.stderr.write(`[security-canvas] fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
	process.exit(1);
});
