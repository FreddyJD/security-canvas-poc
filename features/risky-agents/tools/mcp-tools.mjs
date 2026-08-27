/**
 * MCP tools — the portable surface.
 *
 * Adapters over the same use cases the canvas drives. Each tool validates
 * input with zod, calls a use case, and formats the result; none of them
 * compute a score or talk to Graph directly.
 *
 * Design rules:
 *  1. Read tools are `readOnlyHint: true`. Write tools are `destructiveHint`
 *     and require an explicit `confirm: true` — some hosts (notably Security
 *     Copilot) refuse destructive tools outright, and an analyst should never
 *     lose an agent to an ambiguous sentence.
 *  2. Every tool returns a verdict-shaped payload, not a raw Graph dump.
 *  3. Errors come back as readable text plus remediation, never a stack trace.
 *
 * @typedef {import("../domain/types.js").AgentSource} AgentSource
 */
import { z } from "zod";
import { GraphError } from "../../../platform/graph.mjs";
import { describeDetection } from "../domain/risk-catalog.mjs";
import { enrichDetections } from "../domain/scoring.mjs";
import * as triage from "../usecases/agent-triage.mjs";
import { renderActivity, renderAgentTable, renderExplanation } from "./render-text.mjs";

const RISK_LEVELS = ["low", "medium", "high", "hidden", "none"];
const RISK_STATES = ["none", "confirmedSafe", "dismissed", "atRisk", "confirmedCompromised"];

/**
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 * @param {AgentSource} repository
 */
export function registerTools(server, repository) {
	const ctx = { repository };

	// ---------------------------------------------------------------
	// list_risky_agents — the "what are my high-risk agents?" entry point
	// ---------------------------------------------------------------
	server.registerTool(
		"list_risky_agents",
		{
			title: "List risky agents",
			description:
				"List Microsoft Entra agent identities currently flagged as risky by Entra ID Protection. " +
				"Returns a triage-ordered summary (highest severity first) with the reason each agent was flagged. " +
				"Use this to answer questions like 'what are my high-risk agents?'.",
			inputSchema: {
				riskLevels: z
					.array(z.enum(RISK_LEVELS))
					.optional()
					.describe("Filter by Entra risk level. Defaults to high and medium."),
				riskStates: z
					.array(z.enum(RISK_STATES))
					.optional()
					.describe("Filter by risk state. Defaults to atRisk and confirmedCompromised."),
				includeDetections: z
					.boolean()
					.optional()
					.describe("Attach per-detection detail to each agent. Slower; defaults to false."),
				limit: z.number().int().min(1).max(100).optional().describe("Max agents to return (default 25)."),
			},
			annotations: { readOnlyHint: true, openWorldHint: true },
		},
		async ({ riskLevels, riskStates, includeDetections, limit }) => {
			try {
				const agents = await repository.listAssessments({
					riskLevels: riskLevels ?? ["high", "medium"],
					riskStates: riskStates ?? ["atRisk", "confirmedCompromised"],
					includeDetections: includeDetections ?? false,
					limit: limit ?? 25,
				});

				if (agents.length === 0) {
					return ok("No agents currently match those risk filters.", { agents: [], count: 0 });
				}
				return ok(renderAgentTable(agents), { agents, count: agents.length });
			} catch (err) {
				return fail(err);
			}
		},
	);

	// ---------------------------------------------------------------
	// explain_agent_risk — the "why is this risky?" deep dive
	// ---------------------------------------------------------------
	server.registerTool(
		"explain_agent_risk",
		{
			title: "Explain agent risk",
			description:
				"Explain why a specific Entra agent is considered risky. Returns the full detection history with " +
				"plain-language meaning, impact, and recommended remediation for each signal. " +
				"Use after list_risky_agents to investigate one agent.",
			inputSchema: {
				agentId: z.string().min(1).describe("The agent object id from list_risky_agents."),
				detectionLimit: z.number().int().min(1).max(100).optional().describe("Max detections (default 25)."),
			},
			annotations: { readOnlyHint: true, openWorldHint: true },
		},
		async ({ agentId, detectionLimit }) => {
			try {
				const assessment = await triage.explainAgent(ctx, agentId, {
					detectionLimit: detectionLimit ?? 25,
				});
				const detections = assessment.detectionDetail ?? [];
				return ok(renderExplanation(assessment, detections), { assessment, detections });
			} catch (err) {
				return fail(err);
			}
		},
	);

	// ---------------------------------------------------------------
	// assess_agent_blast_radius — the cross-pillar correlation
	// ---------------------------------------------------------------
	server.registerTool(
		"assess_agent_blast_radius",
		{
			title: "Assess agent blast radius",
			description:
				"Combine Entra identity risk with data exposure (Purview) and code access (GitHub) to judge how much " +
				"damage an agent could do if compromised. Pass known exposure details; omitted pillars are reported " +
				"as degraded rather than silently scored as zero.",
			inputSchema: {
				agentId: z.string().min(1).describe("The agent object id."),
				dataExposure: z
					.object({
						highestLabel: z.string().optional().describe("Most sensitive Purview label touched."),
						labelIds: z.array(z.string()).optional(),
						dlpMatches: z.number().int().min(0).optional(),
					})
					.optional()
					.describe("Purview exposure, if known."),
				codeExposure: z
					.object({
						writeRepos: z.array(z.string()).optional(),
						productionRepos: z.array(z.string()).optional(),
						canApprovePullRequests: z.boolean().optional(),
					})
					.optional()
					.describe("GitHub exposure, if known."),
			},
			annotations: { readOnlyHint: true, openWorldHint: true },
		},
		async ({ agentId, dataExposure, codeExposure }) => {
			try {
				const assessment = await triage.explainAgent(ctx, agentId, { dataExposure, codeExposure });
				return ok(renderExplanation(assessment), { assessment });
			} catch (err) {
				return fail(err);
			}
		},
	);

	// ---------------------------------------------------------------
	// list_recent_agent_detections — tenant-wide recent activity
	// ---------------------------------------------------------------
	server.registerTool(
		"list_recent_agent_detections",
		{
			title: "List recent agent detections",
			description:
				"List agent risk detections across the tenant within a recent time window, grouped by detection type. " +
				"Use for 'what happened in the last 24 hours?' style questions. Entra retains detections for 90 days.",
			inputSchema: {
				hours: z.number().int().min(1).max(2160).optional().describe("Look-back window in hours (default 24)."),
				limit: z.number().int().min(1).max(200).optional().describe("Max detections (default 50)."),
			},
			annotations: { readOnlyHint: true, openWorldHint: true },
		},
		async ({ hours, limit }) => {
			try {
				const activity = await triage.recentActivity(ctx, { hours, limit });
				const groups = activity.groups.map((g) => {
					const meta = describeDetection(g.riskEventType);
					return { ...g, title: meta.title, meaning: meta.meaning };
				});
				return ok(renderActivity(activity, describeDetection), {
					since: activity.since,
					count: activity.count,
					groups,
					detections: enrichDetections(activity.detections),
				});
			} catch (err) {
				return fail(err);
			}
		},
	);

	// ---------------------------------------------------------------
	// Write actions — double-gated: confirm flag + destructive annotation
	// ---------------------------------------------------------------
	server.registerTool(
		"update_agent_risk_state",
		{
			title: "Update agent risk state",
			description:
				"Change an agent's risk state in Entra ID Protection. " +
				"'confirmCompromised' sets risk to high and triggers risk-based Conditional Access. " +
				"'confirmSafe' clears risk and teaches Entra to stop flagging similar activity. " +
				"'dismiss' clears the current finding but keeps flagging similar activity. " +
				"Requires Security Administrator and IdentityRiskyAgent.ReadWrite.All. " +
				"You MUST confirm the action with the user before calling this.",
			inputSchema: {
				agentIds: z.array(z.string().min(1)).min(1).max(50).describe("Agent object ids to update."),
				action: z
					.enum(["dismiss", "confirmCompromised", "confirmSafe"])
					.describe("The risk-state transition to apply."),
				confirm: z
					.boolean()
					.describe("Must be true. Explicit acknowledgement that the user approved this change."),
				justification: z.string().optional().describe("Reason, for the audit trail in your response."),
			},
			annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
		},
		async ({ agentIds, action, confirm, justification }) => {
			if (!confirm) {
				return {
					content: content(
						`Refused: \`confirm\` was not true. ${action} on ${agentIds.length} agent(s) changes ` +
							`security posture and may trigger Conditional Access. Ask the user to approve, then retry with confirm: true.`,
					),
					isError: true,
				};
			}

			try {
				const result = await triage.updateRiskState(ctx, agentIds, action);
				const note = justification ? ` Justification: ${justification}` : "";
				return ok(`Applied '${action}' to ${agentIds.length} agent(s).${note}`, result);
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
		err instanceof GraphError
			? `Microsoft Graph error (${err.status}${err.code ? ` ${err.code}` : ""}): ${err.message}\n\n${err.remediation}`
			: `Unexpected error: ${err instanceof Error ? err.message : String(err)}`;

	return { content: content(text), isError: true };
}
