#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { GraphClient } from "./graph-client.js";
import { registerTools } from "./tools.js";

/**
 * Security Canvas MCP server.
 *
 * Transport is stdio, so stdout belongs to JSON-RPC. All diagnostics go to
 * stderr — a stray console.log here corrupts the protocol and the client
 * disconnects with an opaque parse error.
 */
async function main(): Promise<void> {
	const server = new McpServer(
		{ name: "security-canvas", version: "0.1.0" },
		{
			instructions:
				"Cross-pillar agent security triage. Start with list_risky_agents to find flagged Entra agent " +
				"identities, then explain_agent_risk for a single agent's detection history, and " +
				"assess_agent_blast_radius to weigh identity risk against data and code exposure. " +
				"All read tools respect the signed-in analyst's Entra RBAC. " +
				"update_agent_risk_state changes security posture: always confirm with the user first.",
		},
	);

	registerTools(server, new GraphClient());

	const transport = new StdioServerTransport();
	await server.connect(transport);
	process.stderr.write("[security-canvas] MCP server ready on stdio\n");
}

main().catch((err) => {
	process.stderr.write(`[security-canvas] fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
	process.exit(1);
});
