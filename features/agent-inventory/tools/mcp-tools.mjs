/**
 * MCP tools for the agent inventory.
 *
 * The portable half of "what are my agents?" — available in VS Code, Security
 * Copilot, Copilot Studio and Foundry, not just the canvas. Read-only: this
 * inventory API exposes no writes.
 *
 * @typedef {import("../domain/types.js").InventoryAgent} InventoryAgent
 * @typedef {import("../domain/types.js").InventorySource} InventorySource
 */
import { z } from "zod";
import { InventoryError } from "../../../platform/inventory-client.mjs";
import { GraphError } from "../../../platform/graph.mjs";
import { discoveryLabel, filterAgents, lastUsedLabel, ownerLabel, platformsIn, sortAgents } from "../domain/presentation.mjs";

/**
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 * @param {InventorySource} repository
 */
export function registerInventoryTools(server, repository) {
	server.registerTool(
		"list_agents",
		{
			title: "List agents",
			description:
				"List the tenant's AI agents that carry risk, across every Microsoft platform — Microsoft 365 Copilot, " +
				"Copilot Studio, Endpoint and others — with publisher, owner, platform, risk level and status. " +
				"This is the same set the Security Unified UX Agents page shows. " +
				"Use get_agent_estate_summary for whole-estate totals, and list_risky_agents for the Entra identity-risk view. " +
				"Answers 'what are my risky agents?' and 'who owns agent X?'.",
			inputSchema: {
				search: z.string().optional().describe("Free text matched against name, publisher, owner and platform."),
				platforms: z
					.array(z.string())
					.optional()
					.describe('Platform labels to keep, e.g. ["M365 Copilot", "Copilot Studio"].'),
				risks: z
					.array(z.enum(["none", "low", "medium", "high"]))
					.optional()
					.describe("Risk levels to keep."),
				unownedOnly: z.boolean().optional().describe("Only agents with no accountable owner."),
				sortBy: z
					.enum(["name", "platform", "owner", "risk", "status", "lastUsed", "discovery"])
					.optional()
					.describe("Column to order by. Defaults to risk, worst first."),
				limit: z.number().int().min(1).max(200).optional().describe("Max agents to return (default 50)."),
			},
			annotations: { readOnlyHint: true, openWorldHint: true },
		},
		async ({ search, platforms, risks, unownedOnly, sortBy, limit }) => {
			try {
				const [catalog, summary] = await Promise.all([
					repository.listAgents({ risk: true, maxCount: 200 }),
					repository.getSummary(),
				]);

				const all = catalog.agents ?? [];
				const matched = sortAgents(
					filterAgents(all, {
						search: search ?? "",
						platforms: platforms ?? [],
						risks: risks ?? [],
						slice: unownedOnly ? "unowned" : "all",
					}),
					// Risk-first by default: on an inventory the useful question is
					// "what needs attention", not "what is alphabetically first".
					{ column: sortBy ?? "risk", descending: false },
				);

				const rows = matched.slice(0, limit ?? 50);
				const estateTotal = summary?.agents?.total ?? all.length;

				return ok(renderInventoryText(rows, matched.length, all.length, estateTotal, summary), {
					agents: rows,
					matchedCount: matched.length,
					riskyCount: all.length,
					estateTotal,
					platforms: platformsIn(all),
					byRiskLevel: summary?.agents?.byRiskLevel,
					byPlatform: summary?.agents?.byPlatform,
				});
			} catch (err) {
				return fail(err);
			}
		},
	);

	server.registerTool(
		"get_agent_estate_summary",
		{
			title: "Get agent estate summary",
			description:
				"Tenant-wide totals for the agent estate: how many agents exist, how many are flagged, the breakdown " +
				"by risk level and by platform, and how many lack an owner or a protection control. " +
				"Use for 'how many agents do we have?' and posture questions, rather than listing rows.",
			inputSchema: {},
			annotations: { readOnlyHint: true, openWorldHint: true },
		},
		async () => {
			try {
				const summary = await repository.getSummary();
				if (!summary) {
					return fail(new InventoryError("The tenant's inventory summary is not available.", 503, "inventoryUnavailable", 5));
				}
				return ok(renderSummaryText(summary), { summary });
			} catch (err) {
				return fail(err);
			}
		},
	);
}

/**
 * The inventory as a scannable list.
 *
 * Leads with the scope line because these rows are the *risky* subset: without
 * it, a model reading 7 rows will report "you have 7 agents" when the tenant
 * has 789.
 *
 * @param {readonly InventoryAgent[]} rows
 * @param {number} matchedCount
 * @param {number} riskyCount
 * @param {number} estateTotal
 * @param {import("../domain/types.js").InventorySummary | null} summary
 */
function renderInventoryText(rows, matchedCount, riskyCount, estateTotal, summary) {
	const lines = [];

	if (estateTotal > riskyCount) {
		lines.push(
			`${estateTotal.toLocaleString()} agents in the estate. ${riskyCount.toLocaleString()} carry risk, and are listed here.`,
		);
	} else {
		lines.push(`${estateTotal.toLocaleString()} agents in the estate.`);
	}
	lines.push(`Showing ${rows.length} of ${matchedCount.toLocaleString()} matching.`, "");

	for (const a of rows) {
		const used = lastUsedLabel(a) ?? "no activity signal";
		lines.push(
			`${a.title} — ${a.publisher}`,
			`  ${a.platform} · ${discoveryLabel(a.source)} · owner ${ownerLabel(a)} · risk ${a.riskLevel} · ${a.status} · ${used}`,
			`  id ${a.agentId}`,
		);
	}

	if (summary?.agents?.byPlatform) {
		const byPlatform = Object.entries(summary.agents.byPlatform)
			.sort((a, b) => b[1] - a[1])
			.map(([name, count]) => `${name} ${count}`)
			.join(", ");
		lines.push("", `Estate by platform: ${byPlatform}`);
	}

	return lines.join("\n").trimEnd();
}

/** @param {import("../domain/types.js").InventorySummary} s */
function renderSummaryText(s) {
	const agents = s.agents ?? {};
	const signals = agents.riskSignals ?? {};
	const entries = (/** @type {Record<string, number>} */ map) =>
		Object.entries(map ?? {})
			.sort((a, b) => b[1] - a[1])
			.map(([k, v]) => `  ${k}: ${v.toLocaleString()}`)
			.join("\n");

	const lines = [
		`Agent estate for tenant ${s.metadata?.tenantId ?? "(unknown)"}`,
		`Collected ${s.metadata?.collectedAt ?? "(unknown)"}`,
		"",
		`Total agents: ${(agents.total ?? 0).toLocaleString()}`,
		`Flagged (risky, unowned, publicly exposed, or unmonitored): ${(agents.atRisk ?? 0).toLocaleString()}`,
		"",
		"By risk level:",
		entries(agents.byRiskLevel),
		"",
		"By platform:",
		entries(agents.byPlatform),
		"",
		"Risk signals:",
		`  without an owner: ${(signals.unowned ?? 0).toLocaleString()}`,
		`  publicly exposed: ${(signals.publiclyExposed ?? 0).toLocaleString()}`,
		`  unmonitored (no activity signal): ${(signals.unmonitored ?? 0).toLocaleString()}`,
	];

	if (s.protection) {
		lines.push(
			"",
			"Protection coverage (notEvaluated means the control was never assessed, which is not the same as unprotected):",
			`  Defender — protected ${s.protection.defender?.protected ?? 0}, unprotected ${s.protection.defender?.unprotected ?? 0}, not evaluated ${s.protection.defender?.notEvaluated ?? 0}`,
			`  DLP      — protected ${s.protection.dlp?.protected ?? 0}, unprotected ${s.protection.dlp?.unprotected ?? 0}, not evaluated ${s.protection.dlp?.notEvaluated ?? 0}`,
		);
	}

	return lines.join("\n");
}

/**
 * @param {string} text
 * @returns {[{ type: "text", text: string }]}
 */
function content(text) {
	return [{ type: "text", text }];
}

/**
 * @param {string} text
 * @param {Record<string, unknown>} structured
 */
function ok(text, structured) {
	return { content: content(text), structuredContent: structured };
}

/** @param {unknown} err */
function fail(err) {
	const text =
		err instanceof InventoryError || err instanceof GraphError
			? `Inventory error (${err.status}${err.code ? ` ${err.code}` : ""}): ${err.message}\n\n${err.remediation}`
			: `Unexpected error: ${err instanceof Error ? err.message : String(err)}`;
	return { content: content(text), isError: true };
}
