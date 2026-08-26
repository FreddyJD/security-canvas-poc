import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { GraphError, type GraphClient } from "./graph-client.js";
import { assessAgent, normalizeDetection } from "./correlate.js";
import { describeDetection } from "./risk-catalog.js";
import type { AgentRiskAssessment, RiskyAgent } from "./types.js";

/**
 * Tool design notes
 * -----------------
 * 1. Read tools are `readOnlyHint: true`. Write tools are `destructiveHint`
 *    and require an explicit `confirm: true` argument — some hosts (notably
 *    Security Copilot) refuse destructive tools outright, and an analyst
 *    should never lose an agent to an ambiguous sentence.
 * 2. Every tool returns a verdict-shaped payload, not a raw Graph dump.
 * 3. Errors come back as readable text plus remediation, never a stack trace.
 */

const RISK_LEVELS = ["low", "medium", "high", "hidden", "none"] as const;
const RISK_STATES = ["none", "confirmedSafe", "dismissed", "atRisk", "confirmedCompromised"] as const;

export function registerTools(server: McpServer, graph: GraphClient): void {
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
					.describe("Fetch per-agent detections for richer reasons. Slower; defaults to false."),
				limit: z.number().int().min(1).max(100).optional().describe("Max agents to return (default 25)."),
			},
			annotations: { readOnlyHint: true, openWorldHint: true },
		},
		async ({ riskLevels, riskStates, includeDetections, limit }) => {
			try {
				const agents = await graph.listRiskyAgents({
					riskLevels: riskLevels ?? ["high", "medium"],
					riskStates: riskStates ?? ["atRisk", "confirmedCompromised"],
					top: limit ?? 25,
				});

				if (agents.length === 0) {
					return ok("No agents currently match those risk filters.", { agents: [], count: 0 });
				}

				const assessments: AgentRiskAssessment[] = [];
				for (const agent of agents) {
					// Detections are opt-in: N+1 calls against a large tenant is
					// slow and floods context for little triage value.
					const detections = includeDetections
						? await graph.listDetectionsForAgent(agent.id, 10).catch(() => [])
						: [];
					assessments.push(assessAgent({ agent, detections }));
				}

				assessments.sort(compareBySeverity);
				return ok(renderAgentTable(assessments), { agents: assessments, count: assessments.length });
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
				const [agent, detections] = await Promise.all([
					graph.getRiskyAgent(agentId),
					graph.listDetectionsForAgent(agentId, detectionLimit ?? 25).catch(() => []),
				]);

				const assessment = assessAgent({ agent, detections });
				const enriched = detections.map((raw) => {
					const d = normalizeDetection(raw);
					const meta = describeDetection(d.riskEventType);
					return {
						detectionId: d.id,
						riskEventType: d.riskEventType,
						title: meta.title,
						meaning: meta.meaning,
						impact: meta.impact,
						recommendedAction: meta.action,
						riskLevel: d.riskLevel,
						detectedDateTime: d.detectedDateTime,
						riskEvidence: d.riskEvidence,
					};
				});

				return ok(renderExplanation(assessment, enriched), { assessment, detections: enriched });
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
				const [agent, detections] = await Promise.all([
					graph.getRiskyAgent(agentId),
					graph.listDetectionsForAgent(agentId, 25).catch(() => []),
				]);

				// Be explicit about missing pillars. A model told "no Purview data"
				// will caveat; a model shown a 0 will confidently call it safe.
				const degraded: Record<string, string> = {};
				if (!dataExposure) degraded.purview = "No Purview exposure supplied; data risk not evaluated.";
				if (!codeExposure) degraded.github = "No GitHub exposure supplied; code risk not evaluated.";
				degraded.defender = "Defender correlation not yet wired; use the Sentinel MCP server for incidents.";

				const assessment = assessAgent({ agent, detections, dataExposure, codeExposure, degraded });
				return ok(renderExplanation(assessment, []), { assessment });
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
				const since = new Date(Date.now() - (hours ?? 24) * 3_600_000).toISOString();
				const raw = await graph.listRecentDetections(since, limit ?? 50);
				const detections = raw.map(normalizeDetection);

				const byType = new Map<string, number>();
				for (const d of detections) {
					const key = d.riskEventType ?? "unknown";
					byType.set(key, (byType.get(key) ?? 0) + 1);
				}

				const groups = [...byType.entries()]
					.sort((a, b) => b[1] - a[1])
					.map(([riskEventType, count]) => {
						const meta = describeDetection(riskEventType);
						return { riskEventType, count, title: meta.title, meaning: meta.meaning };
					});

				const summary = detections.length
					? [
							`${detections.length} detection(s) since ${since}:`,
							...groups.map((g) => `  ${g.count}x ${g.title} (${g.riskEventType}) — ${g.meaning}`),
						].join("\n")
					: `No agent risk detections since ${since}.`;

				return ok(summary, { since, count: detections.length, groups, detections });
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
					content: [
						{
							type: "text" as const,
							text:
								`Refused: \`confirm\` was not true. ${action} on ${agentIds.length} agent(s) changes ` +
								`security posture and may trigger Conditional Access. Ask the user to approve, then retry with confirm: true.`,
						},
					],
					isError: true,
				};
			}

			try {
				if (action === "dismiss") await graph.dismissAgentRisk(agentIds);
				else if (action === "confirmCompromised") await graph.confirmAgentCompromised(agentIds);
				else await graph.confirmAgentSafe(agentIds);

				const note = justification ? ` Justification: ${justification}` : "";
				return ok(`Applied '${action}' to ${agentIds.length} agent(s).${note}`, {
					action,
					agentIds,
					applied: true,
				});
			} catch (err) {
				return fail(err);
			}
		},
	);
}

// ---------------------------------------------------------------------------
// Rendering — text for the model to read, structuredContent for programmatic use
// ---------------------------------------------------------------------------

/**
 * Triage ordering. Composite scores legitimately tie at the top (see
 * computeComposite), so ties are broken deterministically: confirmed
 * compromises first, then more corroborating evidence, then agent id.
 * Without this, equally-scored agents would shuffle between identical calls
 * and the analyst could not trust the list order.
 */
export function compareBySeverity(a: AgentRiskAssessment, b: AgentRiskAssessment): number {
	if (b.compositeScore !== a.compositeScore) return b.compositeScore - a.compositeScore;

	const confirmed = (x: AgentRiskAssessment) => (x.riskState === "confirmedCompromised" ? 1 : 0);
	if (confirmed(b) !== confirmed(a)) return confirmed(b) - confirmed(a);

	if (b.factors.length !== a.factors.length) return b.factors.length - a.factors.length;
	return a.agentId.localeCompare(b.agentId);
}

function renderAgentTable(assessments: AgentRiskAssessment[]): string {
	const lines = [`${assessments.length} risky agent(s), most severe first:`, ""];
	for (const a of assessments) {
		lines.push(
			`[${a.severity.toUpperCase()}] ${a.displayName} (${a.agentId})`,
			`  score ${a.compositeScore}/100 · entra ${a.entraRiskLevel} · state ${a.riskState}`,
		);
		const top = a.factors.slice(0, 3);
		for (const f of top) lines.push(`  - ${f.summary}`);
		if (a.factors.length > top.length) {
			lines.push(`  - …and ${a.factors.length - top.length} more (use explain_agent_risk)`);
		}
		if (a.isProcessing) lines.push("  ! Entra is still recomputing this agent's risk.");
		lines.push("");
	}
	return lines.join("\n").trimEnd();
}

function renderExplanation(
	a: AgentRiskAssessment,
	detections: Array<{ title: string; riskEventType?: string; detectedDateTime?: string; impact: string }>,
): string {
	const lines = [
		`${a.displayName} (${a.agentId})`,
		`Severity ${a.severity.toUpperCase()} · composite ${a.compositeScore}/100 · Entra ${a.entraRiskLevel} · state ${a.riskState}`,
		"",
		"Why:",
	];
	for (const f of a.factors) lines.push(`  - [${f.pillar}] ${f.summary}`);
	if (a.factors.length === 0) lines.push("  - No contributing factors found.");

	if (detections.length) {
		lines.push("", "Detections:");
		for (const d of detections) {
			lines.push(`  - ${d.title}${d.detectedDateTime ? ` (${d.detectedDateTime})` : ""} — ${d.impact}`);
		}
	}

	lines.push("", "Recommended actions:");
	for (const r of a.recommendedActions) lines.push(`  - ${r}`);

	if (a.degraded && Object.keys(a.degraded).length) {
		lines.push("", "Coverage gaps (score may understate real risk):");
		for (const [pillar, reason] of Object.entries(a.degraded)) lines.push(`  - ${pillar}: ${reason}`);
	}
	return lines.join("\n");
}

function ok(text: string, structured: Record<string, unknown>) {
	return { content: [{ type: "text" as const, text }], structuredContent: structured };
}

function fail(err: unknown) {
	if (err instanceof GraphError) {
		return {
			content: [
				{
					type: "text" as const,
					text: `Microsoft Graph error (${err.status}${err.code ? ` ${err.code}` : ""}): ${err.message}\n\n${err.remediation}`,
				},
			],
			isError: true,
		};
	}
	const message = err instanceof Error ? err.message : String(err);
	return { content: [{ type: "text" as const, text: `Unexpected error: ${message}` }], isError: true };
}

export type { RiskyAgent };
