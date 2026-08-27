/**
 * Canvas actions and MCP tools for the protection playbook.
 *
 * Both surfaces return the *same* handoff payload, and the payload's shape
 * depends on the mode the operator chose. Guided mode returns instructions for
 * a human; auto mode returns one script for the agent to run.
 *
 * Guided is the default everywhere, and auto has to be asked for by name. The
 * asymmetry is the point: these commands rewrite tenant DLP policy, so the mode
 * where nobody reads them first is the one that requires an explicit request.
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
				"Open the playbook for protecting agents from leaking sensitive data. Use when the user asks to " +
				"protect sensitive data, stop agents leaking data, apply DLP to agents, or fix agents that are not " +
				"covered by a data protection policy. " +
				"Returns mode='guided' by default: PowerShell for the USER to run — present it step by step, never " +
				"run it. Pass mode='auto' ONLY when the user explicitly asks you to run it for them (\"just run it\", " +
				"\"do it for me\", \"don't walk me through it\"); that returns one composed script for you to run in a " +
				"terminal, and its instructions take precedence over this description.",
			inputSchema: {
				type: "object",
				properties: {
					sitName: { type: "string", description: "Sensitive information type to enforce on." },
					policyName: { type: "string", description: "Name for the DLP policy that will be created." },
					confidenceLevel: { type: "string", enum: ["Low", "Medium", "High"] },
					mode: {
						type: "string",
						enum: ["guided", "auto"],
						description:
							"guided (default) returns steps for the user to run. auto returns one script for you to run — " +
							"only when the user explicitly asked you to run it.",
					},
				},
			},
			handler: async (/** @type {{ input: Record<string, any> }} */ { input }) => {
				const { mode, ...params } = input ?? {};
				if (mode !== undefined) {
					const result = playbook.setMode(ctx, mode);
					if (!result.ok) return { applied: false, errors: result.errors };
				}
				if (Object.keys(params).length) {
					const result = playbook.applyParams(ctx, params);
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
				"Return Security & Compliance PowerShell for creating an agent-scoped Purview DLP policy, which blocks " +
				"AI agents from reading sensitive content. Use when the user asks to protect sensitive data, prevent " +
				"agents leaking data, or apply DLP to agents. Purview has no public API for agent scoping, so this " +
				"returns commands rather than performing the change. " +
				"Defaults to mode='guided': the commands are for the USER to run — present them one step at a time, " +
				"wait for confirmation, never execute them and never offer to. " +
				"Pass mode='auto' ONLY when the user explicitly asked you to run it for them; that returns a single " +
				"composed script to run in a terminal, and the instructions in that result take precedence.",
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
				mode: z
					.enum(["guided", "auto"])
					.optional()
					.describe(
						"guided (default) returns steps for the user to run. auto returns one script for you to run, " +
							"and is only appropriate when the user explicitly asked you to run it for them.",
					),
			},
			// Read-only in the strict sense: it returns text. The commands it
			// contains are emphatically not, which is why the description says so
			// three times — the annotation cannot express "safe to call, unsafe to
			// act on".
			annotations: { readOnlyHint: true, openWorldHint: false },
		},
		async ({ sitName, policyName, confidenceLevel, mode }) => {
			const supplied = { sitName, policyName, confidenceLevel };
			const provided = Object.fromEntries(Object.entries(supplied).filter(([, v]) => v !== undefined));

			if (mode !== undefined) ctx.store.setMode(mode);

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
				content: [
					{
						type: /** @type {"text"} */ ("text"),
						text: handoff.mode === "auto" ? renderAutoText(handoff) : renderPlaybookText(handoff),
					},
				],
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

/**
 * The auto-mode result: one script, and an instruction to run it.
 *
 * Deliberately does *not* include the eight steps. A model given both a
 * runnable script and a numbered walkthrough will take the walkthrough — it is
 * the more conservative reading, and it is wrong here, because the user asked
 * for the opposite. Offering only one artifact removes the choice.
 *
 * @param {ReturnType<typeof playbook.buildHandoff>} handoff
 * @returns {string}
 */
function renderAutoText(handoff) {
	return [
		handoff.title.toUpperCase(),
		"",
		handoff.summary,
		"",
		`Current state: ${handoff.coverageSummary}`,
		"",
		"AUTO MODE: the user asked you to run this rather than explain it. Run the script below in a PowerShell " +
			"terminal, as one script, in one session — the sign-in it performs does not survive across invocations.",
		"",
		"```powershell",
		handoff.script ?? "",
		"```",
		"",
		`CHANGES THE TENANT: ${handoff.steps.find((s) => s.destructive)?.effect ?? "Creates a DLP policy and two agent-scoped rules."}`,
		"",
		"Connect-IPPSSession opens a browser sign-in and blocks until the user completes it. That is expected — wait " +
			"for it and tell the user to sign in rather than assuming the terminal has hung.",
		"",
		"The script is idempotent: if it fails partway, re-running it is safe. It stops on its own, without changing " +
			"anything, if the sensitive information type does not exist — report that rather than substituting another one.",
		"",
		"When it finishes, show the policy and rules it printed, then call check_agent_dlp_coverage or list_agents to confirm.",
	].join("\n");
}
