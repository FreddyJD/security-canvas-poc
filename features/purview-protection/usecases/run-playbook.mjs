/**
 * Use cases for the protection playbook.
 *
 * Same rule as the other features: touch the repository and the store, return
 * plain data, never render.
 *
 * The distinctive job here is the handoff. This process cannot run PowerShell
 * on the operator's machine and should not want to — the credentials that can
 * rewrite tenant DLP policy belong to them. So the "action" a use case produces
 * is a *prompt*: a complete, reviewable set of instructions handed back to the
 * Copilot session, where the operator reads it and runs it themselves.
 *
 * @typedef {import("./store.mjs").PlaybookStore} PlaybookStore
 * @typedef {import("../../agent-inventory/domain/types.js").InventorySource} InventorySource
 * @typedef {import("../domain/types.js").PlaybookStep} PlaybookStep
 * @typedef {{ store: PlaybookStore, repository: InventorySource }} PlaybookContext
 */
import { coverageSummary, dlpCoverage, shouldRecommendPlaybook } from "../domain/coverage.mjs";
import { resolvePlaybook } from "../domain/protect-agents-playbook.mjs";
import { validateParams } from "../domain/validate.mjs";

/**
 * Read DLP coverage from the agent inventory.
 *
 * Failure is not fatal: the playbook is useful without it. Coverage is the
 * evidence that motivates running the scripts, not a precondition for having
 * them — refusing to show the steps because a count could not be fetched would
 * be the wrong trade.
 *
 * @param {PlaybookContext} ctx
 */
export async function refreshCoverage({ store, repository }) {
	try {
		const catalog = await repository.listAgents({ maxCount: 200 });
		const coverage = dlpCoverage(catalog.agents ?? []);
		store.set({ status: "ready", coverage, note: "" });
	} catch (err) {
		store.set({
			status: "ready",
			coverage: null,
			note: `Agent coverage could not be read (${err instanceof Error ? err.message : String(err)}). The playbook below still applies.`,
		});
	}
}

/**
 * The playbook, its steps, and the coverage that motivates it.
 *
 * Steps are derived from the parameters on every read rather than stored, so
 * they cannot fall out of step with the values that produced them.
 *
 * @param {{ store: PlaybookStore }} ctx
 */
export function playbookViewModel({ store }) {
	const state = store.get();
	const playbook = resolvePlaybook(state.playbookId);
	const steps = playbook.buildSteps(state.params);
	const done = new Set(state.progress.claimedDone);

	return {
		status: state.status,
		note: state.note,
		title: playbook.title,
		summary: playbook.summary,
		mode: state.mode,
		rationale: playbook.rationale[state.mode] ?? playbook.rationale.guided,
		autoScript: playbook.buildScript(state.params),
		params: playbook.params.map((p) => ({ ...p, value: state.params[p.id] ?? p.default })),
		steps: steps.map((step) => ({ ...step, done: done.has(step.id) })),
		openStepId: state.progress.openStepId,
		doneCount: steps.filter((s) => done.has(s.id)).length,
		stepCount: steps.length,
		coverage: state.coverage,
		coverageSummary: coverageSummary(state.coverage),
		recommended: shouldRecommendPlaybook(state.coverage),
	};
}

/**
 * Set execution mode.
 *
 * A use case rather than a direct store call for the same reason applyParams
 * is: the canvas toggle and the MCP tool both route through here, so neither
 * can be the one that forgets to validate.
 *
 * @param {{ store: PlaybookStore }} ctx
 * @param {unknown} raw
 * @returns {{ ok: true } | { ok: false, errors: string[] }}
 */
export function setMode({ store }, raw) {
	if (raw !== "guided" && raw !== "auto") {
		return { ok: false, errors: [`Mode must be "guided" or "auto".`] };
	}
	store.setMode(raw);
	return { ok: true };
}

/**
 * Apply parameters, rejecting anything that is not safe to interpolate.
 *
 * Validation lives here rather than at the HTTP edge so the canvas and the MCP
 * tool cannot diverge: both call this, so neither can be the one that forgets.
 *
 * @param {{ store: PlaybookStore }} ctx
 * @param {Record<string, unknown>} raw
 * @returns {{ ok: true } | { ok: false, errors: string[] }}
 */
export function applyParams({ store }, raw) {
	const playbook = resolvePlaybook(store.get().playbookId);
	const result = validateParams(raw, playbook.params);
	if (!result.ok) return result;

	store.setParams(result.values);
	return { ok: true };
}

/**
 * Build the handoff: the complete instructions the operator will run.
 *
 * Returned as data rather than sent, so the same payload serves the canvas
 * button, an MCP tool result, and a test.
 *
 * @param {{ store: PlaybookStore }} ctx
 */
export function buildHandoff({ store }) {
	const vm = playbookViewModel({ store });
	const state = store.get();

	return {
		playbookId: state.playbookId,
		title: vm.title,
		summary: vm.summary,
		params: state.params,
		mode: vm.mode,
		coverageSummary: vm.coverageSummary,
		steps: vm.steps.map((s) => ({
			id: s.id,
			kind: s.kind,
			title: s.title,
			body: s.body,
			script: s.script?.code,
			destructive: s.script?.destructive ?? false,
			effect: s.script?.effect,
		})),
		script: vm.mode === "auto" ? vm.autoScript.code : undefined,
		prompt: vm.mode === "auto" ? renderAutoPrompt(vm) : renderHandoffPrompt(vm),
	};
}

/**
 * The prompt handed back to the Copilot session.
 *
 * Written as instructions *for the operator*, not as a request for the model to
 * act. The final paragraph says so explicitly, because the failure mode here is
 * specific and bad: a model that reads a block of PowerShell as a task will
 * cheerfully try to execute it, and these commands rewrite tenant DLP policy.
 * The model's job is to present and explain; the human runs it.
 *
 * @param {ReturnType<typeof playbookViewModel>} vm
 * @returns {string}
 */
export function renderHandoffPrompt(vm) {
	const lines = [
		`I want to protect my agents from leaking sensitive data. Walk me through the "${vm.title}" playbook.`,
		"",
		`Current state: ${vm.coverageSummary}`,
		"",
		"Purview has no public API for this — agent scoping is carried by EndpointDlpRestrictions, which the compliance portal cannot express — so Security & Compliance PowerShell is the only way to create this policy. I will run the commands myself.",
		"",
		"Here are the steps, already filled in with my values:",
		"",
	];

	for (const [index, step] of vm.steps.entries()) {
		lines.push(`${index + 1}. ${step.title}${step.done ? "  [I have done this]" : ""}`);
		for (const paragraph of step.body) lines.push(`   ${paragraph}`);
		if (step.script) {
			if (step.script.destructive) lines.push(`   CHANGES MY TENANT: ${step.script.effect ?? ""}`.trimEnd());
			lines.push("", "   ```powershell", ...step.script.code.split("\n").map((l) => `   ${l}`), "   ```");
		}
		lines.push("");
	}

	lines.push(
		"Please present these to me one step at a time, explain what each command does before I run it, and wait for me to confirm I have run it before moving on.",
		"",
		"Do not attempt to run any of this yourself, and do not offer to — these commands change my tenant's DLP policy and I need to run them in my own authenticated Security & Compliance session. When I am done, offer to re-check my agents' DLP coverage.",
	);

	return lines.join("\n");
}

/**
 * The auto-mode prompt: run it, do not narrate it.
 *
 * The inverse of {@link renderHandoffPrompt}, and it has to be as emphatic in
 * the opposite direction. A model handed a block of PowerShell alongside eight
 * numbered explanations will reliably do the safe, familiar thing — present the
 * steps and wait — which in this mode is a failure. So the steps are not in
 * this prompt at all. There is one script and one instruction.
 *
 * What it must not lose: the operator still authenticates. Connect-IPPSSession
 * opens a browser prompt and blocks, so "run this" means "run this and wait for
 * me to sign in", and the prompt says so — a model that assumes a hang and
 * kills the terminal would be the obvious way for this to go wrong.
 *
 * @param {ReturnType<typeof playbookViewModel>} vm
 * @returns {string}
 */
export function renderAutoPrompt(vm) {
	return [
		`Run the "${vm.title}" playbook for me. Do not walk me through it — run it.`,
		"",
		`Current state: ${vm.coverageSummary}`,
		"",
		"Run the script below in a PowerShell terminal, as one script, in one session. It signs in, creates the DLP policy and both agent-scoped rules, and reads back the result.",
		"",
		"```powershell",
		vm.autoScript.code,
		"```",
		"",
		"Three things to know while it runs:",
		"",
		`1. It changes my tenant. ${vm.autoScript.effect ?? ""}`.trimEnd(),
		"2. Connect-IPPSSession opens a browser sign-in and blocks until I complete it. That is not a hang — wait for it, and tell me if you need me to sign in.",
		"3. It is idempotent. If it fails partway, re-run it; it reuses an existing policy and skips rules that already exist.",
		"",
		"It stops on its own if the sensitive information type does not exist, without changing anything — if that happens, tell me rather than creating a different one.",
		"",
		"When it finishes, show me the policy and rules it printed, then re-check my agents' DLP coverage.",
	].join("\n");
}

/**
 * Hand the playbook to the Copilot session.
 *
 * @param {{ store: PlaybookStore, getSession: () => any }} ctx
 * @returns {boolean} whether a session was available to receive it
 */
export function sendToCopilot(ctx) {
	const handoff = buildHandoff(ctx);
	const session = ctx.getSession();
	if (!session) return false;

	session.send({ prompt: handoff.prompt });
	return true;
}
