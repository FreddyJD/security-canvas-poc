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
		rationale: playbook.rationale,
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
		prompt: renderHandoffPrompt(vm),
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
