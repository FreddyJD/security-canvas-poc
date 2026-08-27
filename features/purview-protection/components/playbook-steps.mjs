/**
 * Playbook components: the coverage banner, parameter fields, and step cards.
 *
 * Pure string functions, loaded by Node in tests and by the browser as ES
 * modules.
 *
 * @typedef {import("../domain/types.js").PlaybookStep} PlaybookStep
 * @typedef {import("../domain/types.js").DlpCoverage} DlpCoverage
 */
import { esc } from "../../../platform/html.mjs";

const CHECK = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
  <path d="M3 8.5 6.2 11.5 13 4.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const COPY = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">
  <rect x="5.75" y="5.75" width="7.5" height="7.5" rx="1.75"/>
  <path d="M10.25 5.75v-1.5a1.75 1.75 0 0 0-1.75-1.75h-4.5A1.75 1.75 0 0 0 2.25 4.25v4.5A1.75 1.75 0 0 0 4 10.5h1.5"/>
</svg>`;

const WARN = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
  <path d="M8 2.75 14.5 13.5h-13L8 2.75z" stroke-linejoin="round"/>
  <path d="M8 6.75v3M8 11.75h.01" stroke-linecap="round"/>
</svg>`;

/** How each step kind is labelled in its badge. */
const KIND_LABEL = {
	prerequisite: "Before you start",
	script: "Run",
	verify: "Verify",
	note: "Next",
};

/**
 * The coverage banner: what the estate looks like right now.
 *
 * `notEvaluated` gets its own line whenever it is non-zero, rather than being
 * folded into a single percentage. An operator who reads "0 uncovered" for an
 * estate nobody measured will conclude they are protected, which is the exact
 * wrong action.
 *
 * @param {DlpCoverage | null} coverage
 * @param {string} summary
 * @returns {string}
 */
export function coverageBanner(coverage, summary) {
	const stats = coverage
		? `<div class="coverage-stats">
        <span class="stat"><b>${coverage.covered}</b> covered</span>
        <span class="stat"><b>${coverage.uncovered}</b> uncovered</span>
        <span class="stat"><b>${coverage.notEvaluated}</b> not evaluated</span>
      </div>`
		: "";

	const examples =
		coverage && coverage.examples.length
			? `<p class="coverage-examples">For example: ${coverage.examples
					.map((e) => `${esc(e.title)} <span class="dim">(${esc(e.platform)})</span>`)
					.join(", ")}</p>`
			: "";

	return `<section class="coverage" aria-label="DLP coverage">
    <p class="coverage-summary">${esc(summary)}</p>
    ${stats}
    ${examples}
  </section>`;
}

/**
 * One parameter field.
 *
 * The help text is always visible rather than hidden behind a tooltip: these
 * values end up inside a command the operator runs as an administrator, and
 * "what happens if I get this wrong" should not require hovering.
 *
 * @param {{ id: string, label: string, help: string, value: string, options?: string[] }} param
 * @returns {string}
 */
export function paramField(param) {
	const control = param.options
		? `<select id="param-${esc(param.id)}" data-param="${esc(param.id)}">
        ${param.options
					.map(
						(o) =>
							`<option value="${esc(o)}"${o === param.value ? " selected" : ""}>${esc(o)}</option>`,
					)
					.join("")}
      </select>`
		: `<input id="param-${esc(param.id)}" type="text" data-param="${esc(param.id)}" value="${esc(param.value)}" spellcheck="false"/>`;

	return `<div class="param">
    <label for="param-${esc(param.id)}">${esc(param.label)}</label>
    ${control}
    <p class="param-help">${esc(param.help)}</p>
  </div>`;
}

/**
 * The mode toggle.
 *
 * A segmented control rather than a checkbox called "YOLO": the two modes are
 * both legitimate choices with different tradeoffs, and naming them as a pair
 * makes the tradeoff visible in a way "on/off" does not. The description under
 * the selected option changes, because the honest sentence differs — in guided
 * mode nothing here touches the tenant, and in auto mode something does.
 *
 * @param {import("../domain/types.js").ExecutionMode} mode
 * @returns {string}
 */
export function modeToggle(mode) {
	const option = (/** @type {string} */ value, /** @type {string} */ label, /** @type {string} */ hint) => `
    <button
      type="button"
      class="mode-option${mode === value ? " selected" : ""}"
      data-mode="${esc(value)}"
      role="radio"
      aria-checked="${mode === value}"
    >
      <span class="mode-label">${esc(label)}</span>
      <span class="mode-hint">${esc(hint)}</span>
    </button>`;

	return `<div class="mode" role="radiogroup" aria-label="How to run this playbook">
    ${option("guided", "Walk me through it", "You run each command, one step at a time.")}
    ${option("auto", "Just run it", "Copilot runs the whole script. You still sign in.")}
  </div>`;
}

/**
 * A script block with a copy button.
 *
 * Copy rather than run, everywhere and always. This process has no business
 * executing commands that rewrite tenant policy, and a button that looked like
 * it might would be worse than useless — it would teach the operator to expect
 * something that must never happen.
 *
 * @param {string} stepId
 * @param {NonNullable<PlaybookStep["script"]>} script
 * @returns {string}
 */
export function scriptBlock(stepId, script) {
	const warning = script.destructive
		? `<p class="script-warning">${WARN}<span>Changes your tenant${script.effect ? `: ${esc(script.effect)}` : "."}</span></p>`
		: script.effect
			? `<p class="script-effect">${esc(script.effect)}</p>`
			: "";

	return `<div class="script${script.destructive ? " destructive" : ""}">
    ${warning}
    <div class="script-head">
      <span class="script-lang">${esc(script.language)}</span>
      <button type="button" class="copy-button" data-copy="${esc(stepId)}" aria-label="Copy this script">
        ${COPY}<span>Copy</span>
      </button>
    </div>
    <pre id="script-${esc(stepId)}"><code>${esc(script.code)}</code></pre>
  </div>`;
}

/**
 * One step card.
 *
 * The done control is a checkbox the operator ticks, not a status this process
 * derives. Its label says "I ran this" rather than "Complete", because nothing
 * here can see their terminal — the only honest claim is what they told us.
 *
 * @param {PlaybookStep & { done: boolean }} step
 * @param {number} index
 * @param {boolean} open
 * @returns {string}
 */
export function stepCard(step, index, open) {
	const body = open
		? `<div class="step-body" id="step-body-${esc(step.id)}">
        ${step.body.map((p) => `<p>${esc(p)}</p>`).join("")}
        ${step.script ? scriptBlock(step.id, step.script) : ""}
        ${
					step.docsUrl
						? `<a class="step-docs" href="${esc(step.docsUrl)}" target="_blank" rel="noopener noreferrer">${esc(step.docsLabel ?? "Documentation")}</a>`
						: ""
				}
        <label class="step-done">
          <input type="checkbox" data-done="${esc(step.id)}"${step.done ? " checked" : ""}/>
          <span>I ran this</span>
        </label>
      </div>`
		: "";

	return `<li class="step${step.done ? " done" : ""}${open ? " open" : ""}">
    <button
      type="button"
      class="step-head"
      data-step="${esc(step.id)}"
      aria-expanded="${open}"
      aria-controls="step-body-${esc(step.id)}"
    >
      <span class="step-index" aria-hidden>${step.done ? CHECK : index + 1}</span>
      <span class="step-title">${esc(step.title)}</span>
      <span class="step-kind">${esc(KIND_LABEL[step.kind] ?? step.kind)}</span>
    </button>
    ${body}
  </li>`;
}

/**
 * @param {Array<PlaybookStep & { done: boolean }>} steps
 * @param {string | null} openStepId
 * @returns {string}
 */
export function stepList(steps, openStepId) {
	return `<ol class="steps">${steps
		.map((step, i) => stepCard(step, i, step.id === openStepId))
		.join("")}</ol>`;
}

/**
 * Progress across the playbook.
 *
 * Worded as a claim — "steps marked done" — for the same reason the checkbox
 * is. "3 of 8 complete" would assert something this process cannot know.
 *
 * @param {number} done
 * @param {number} total
 * @returns {string}
 */
export function progressBar(done, total) {
	const pct = total > 0 ? Math.round((done / total) * 100) : 0;
	return `<div class="progress">
    <div class="progress-track"><i style="width:${pct}%"></i></div>
    <span class="progress-label">${done} of ${total} steps marked done</span>
  </div>`;
}

/**
 * The auto-mode panel: the composed script, and what running it will do.
 *
 * The script is shown in full rather than summarised. The operator is about to
 * let something else run it as an administrator, which makes reading it first
 * more important than in guided mode, not less — a collapsed "details" would
 * be the wrong economy.
 *
 * @param {NonNullable<import("../domain/types.js").PlaybookScript>} script
 * @returns {string}
 */
export function autoPanel(script) {
	return `<section class="auto" aria-label="The script Copilot will run">
    <h2>What will run</h2>
    <p class="auto-note">
      One script, one PowerShell session. It signs you in, creates the policy and both rules, and reads
      back the result. It is safe to re-run: anything that already exists is reused.
    </p>
    ${scriptBlock("auto", script)}
  </section>`;
}
