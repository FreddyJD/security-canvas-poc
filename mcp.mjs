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
import { AgentDetailsRepository } from "./features/agent-details/data/agent-details-repository.mjs";
import { registerDetailsTools } from "./features/agent-details/tools/mcp-tools.mjs";
import { PlaybookStore } from "./features/purview-protection/usecases/store.mjs";
import { registerPlaybookTools } from "./features/purview-protection/tools/playbook-tools.mjs";
import { registerSessionTools } from "./features/entra-session/tools/mcp-tools.mjs";

async function main() {
	const server = new McpServer(
		{ name: "security-canvas", version: "0.1.0" },
		{
			instructions:
				"Agent inventory and cross-pillar security triage for a Microsoft tenant.\n\n" +
				"For 'what are my agents?' start with list_agents — the agents that carry risk, across Microsoft 365 " +
				"Copilot, Copilot Studio, Endpoint and other platforms — or get_agent_estate_summary for whole-estate " +
				"totals. list_agents lists a subset by design, so never read its row count as the tenant's agent count.\n\n" +
				"For 'tell me more about agent X' call get_agent_details with the agent id: it returns that one " +
				"agent's identity facts, its secure score and the goals it fails, its Conditional Access / Defender / " +
				"Purview DLP posture, and the resources it can reach. It distinguishes a control that was evaluated " +
				"and failed from one that was never evaluated — never report the second as a security gap.\n\n" +
				"For security triage start with list_risky_agents to find flagged Entra agent identities, then " +
				"explain_agent_risk for a single agent's detection history, and assess_agent_blast_radius to weigh " +
				"identity risk against data and code exposure.\n\n" +
				"To protect agents from leaking sensitive data, call get_protect_agents_playbook. It returns " +
				"PowerShell for the USER to run in their own session — Purview has no API for agent-scoped DLP. " +
				"Present those commands step by step and never execute them.\n\n" +
				"All read tools respect the signed-in analyst's Entra RBAC. " +
				"update_agent_risk_state changes security posture: always confirm with the user first.\n\n" +
				"Every tool needs a Microsoft Entra sign-in. When one reports that sign-in is required, call " +
				"sign_in — it opens the browser account picker and caches the credential on this device. When a " +
				"read comes back empty or refused, call get_auth_status before concluding the tenant is clean: " +
				"signed out and signed in without the necessary role look identical in the results.",
		},
	);

	// One inventory repository, shared: the playbook's coverage numbers, the
	// Agents tools and the details page must describe the same estate.
	const inventoryRepository = new InventoryRepository();

	registerTools(server, new AgentRepository());
	registerInventoryTools(server, inventoryRepository);
	registerSessionTools(server);
	// The details repository reads its catalog row through the shared inventory
	// repository, so `list_agents` and `get_agent_details` cannot disagree about
	// the same agent — and asking about one agent does not re-download a catalog
	// the process already holds.
	registerDetailsTools(server, { repository: new AgentDetailsRepository(undefined, inventoryRepository) });
	registerPlaybookTools(server, { store: new PlaybookStore(), repository: inventoryRepository });

	await server.connect(new StdioServerTransport());
	process.stderr.write("[security-canvas] MCP server ready on stdio\n");
}

main().catch((err) => {
	process.stderr.write(`[security-canvas] fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
	process.exit(1);
});
