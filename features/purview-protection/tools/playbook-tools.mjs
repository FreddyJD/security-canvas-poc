/**
 * Canvas actions and MCP tools for the protection playbook.
 *
 * Both surfaces return the *same* handoff payload: a set of instructions for
 * the operator, never an attempt to act. That is the whole design — Purview has
 * no public API for agent-scoped DLP, so the only honest thing to offer is an
 * exact script the human runs in their own privileged session.
 *
 * @typedef {import("../usecases/store.mjs").PlaybookStore} PlaybookStore
 * @typedef {import("../../agent-inventory/domain/types.js").InventorySource} InventorySource
 * @typedef {import("@github/copilot-sdk/extension").CanvasAction} CanvasAction
 */
import { z } from "zod";
import * as playbook from "../usecases/run-playbook.mjs";
import { resolvePlaybook } from "../domain/protect-agents-playbook.mjs";
import { validateParams } from "../domain/validate.mjs";

/**
 * @param {{ store: PlaybookStore, repository: InventorySource, getSession: () => any }} ctx
 * @returns {CanvasAction[]}
 */
export function createPlaybookActions(ctx) {
	return [
		{
			name: "show_protect_agents_playbook",
			description:
				"Open the playbook for protecting agents from leaking sensitive data, and return the exact " +
				"PowerShell the user must run. Use when the user asks to protect sensitive data, stop agents " +
				"leaking data, apply DLP to agents, or fix agents that are not covered by a data protection policy. " +
				"The commands are for the USER to run — never run them yourself and never offer to.",
			inputSchema: {
				type: "object",
				properties: {
					sitName: { type: "string", description: "Sensitive information type to enforce on." },
					policyName: { type: "string", description: "Name for the DLP policy that will be created." },
					confidenceLevel: { type: "string", enum: ["Low", "Medium", "High"] },
				},
			},
			handler: async (/** @type {{ input: Record<string, any> }} */ { input }) => {
				if (Object.keys(input ?? {}).length) {
					const result = playbook.applyParams(ctx, input);
					if (!result.ok) return { applied: false, errors: result.errors };
				}
				if (!ctx.store.get().coverage) await playbook.refreshCoverage(ctx);
				return playbook.buildHandoff(ctx);
			},
		},
		{
			name: "check_agent_dlp_coverage",
			description:
				"Re-read how many agents are covered by a Purview DLP policy. Use after the user says they ran " +
				"the playbook, to confirm the protection is actually in place.",
			inputSchema: { type: "object", properties: {} },
			handler: async () => {
				await playbook.refreshCoverage(ctx);
				const vm = playbook.playbookViewModel(ctx);
				return { coverage: vm.coverage, summary: vm.coverageSummary, stillRecommended: vm.recommended };
			},
		},
	];
}

/**
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 * @param {{ store: PlaybookStore, repository: InventorySource }} ctx
 */
export function registerPlaybookTools(server, ctx) {
	server.registerTool(
		"get_protect_agents_playbook",
		{
			title: "Get the agent data-protection playbook",
			description:
				"Return step-by-step instructions and the exact Security & Compliance PowerShell for creating an " +
				"agent-scoped Purview DLP policy, which blocks AI agents from reading sensitive content. " +
				"Use when the user asks to protect sensitive data, prevent agents leaking data, or apply DLP to agents. " +
				"Purview has no public API for agent scoping, so this returns commands for the USER to run in their own " +
				"session. Present them one step at a time and wait for confirmation. " +
				"Never execute these commands and never offer to — they change the user's tenant DLP policy.",
			inputSchema: {
				sitName: z
					.string()
					.optional()
					.describe("Sensitive information type to enforce on. Defaults to a permissive test SIT."),
				policyName: z.string().optional().describe("Name for the DLP policy. Defaults to AIAgentPolicy."),
				confidenceLevel: z
					.enum(["Low", "Medium", "High"])
					.optional()
					.describe("How certain the SIT match must be. Low is right while proving the policy works."),
			},
			// Read-only in the strict sense: it returns text. The commands it
			// contains are emphatically not, which is why the description says so
			// three times — the annotation cannot express "safe to call, unsafe to
			// act on".
			annotations: { readOnlyHint: true, openWorldHint: false },
		},
		async ({ sitName, policyName, confidenceLevel }) => {
			const supplied = { sitName, policyName, confidenceLevel };
			const provided = Object.fromEntries(Object.entries(supplied).filter(([, v]) => v !== undefined));

			if (Object.keys(provided).length) {
				const definition = resolvePlaybook(ctx.store.get().playbookId);
				const result = validateParams(provided, definition.params);
				if (!result.ok) {
					return {
						content: [{ type: /** @type {"text"} */ ("text"), text: `Rejected:\n${result.errors.map((e) => `  - ${e}`).join("\n")}` }],
						isError: true,
					};
				}
				ctx.store.setParams(result.values);
			}

			// Coverage motivates the playbook but is not required for it: a
			// tenant that cannot be read still needs the same commands.
			if (!ctx.store.get().coverage) {
				await playbook.refreshCoverage({ store: ctx.store, repository: ctx.repository });
			}

			const handoff = playbook.buildHandoff(ctx);
			return {
				content: [{ type: /** @type {"text"} */ ("text"), text: renderPlaybookText(handoff) }],
				structuredContent: handoff,
			};
		},
	);
}

/**
 * The playbook as text for a model to relay.
 *
 * Opens and closes with the same instruction — present, do not execute —
 * because a long block of PowerShell in a tool result reads to a model like a
 * task, and these commands rewrite tenant DLP policy.
 *
 * @param {ReturnType<typeof playbook.buildHandoff>} handoff
 * @returns {string}
 */
function renderPlaybookText(handoff) {
	const lines = [
		handoff.title.toUpperCase(),
		"",
		handoff.summary,
		"",
		`Current state: ${handoff.coverageSummary}`,
		"",
		"IMPORTANT: these commands are for the user to run in their own Security & Compliance PowerShell session. " +
			"Do not run them, and do not offer to. Present one step at a time and wait for the user to confirm before continuing.",
		"",
	];

	for (const [i, step] of handoff.steps.entries()) {
		lines.push(`${i + 1}. ${step.title}`);
		for (const paragraph of step.body) lines.push(`   ${paragraph}`);
		if (step.script) {
			if (step.destructive) lines.push(`   CHANGES THE TENANT: ${step.effect ?? ""}`.trimEnd());
			lines.push("", "   ```powershell", ...step.script.split("\n").map((l) => `   ${l}`), "   ```");
		}
		lines.push("");
	}

	lines.push(
		"When the user says they have run it, call check_agent_dlp_coverage (canvas) or list_agents to confirm the policy took effect.",
	);
	return lines.join("\n");
}
