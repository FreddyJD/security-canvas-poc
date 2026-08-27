/**
 * The playbook screen.
 *
 * Pure: renders the view model and reports interaction through data attributes.
 */
import { esc } from "../../../platform/html.mjs";
import { autoPanel, panelTabs, paramField, progressBar, stepList } from "../components/playbook-steps.mjs";

const SEND = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
  <path d="M2.5 8h9M8.25 4.5 11.75 8l-3.5 3.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const BOLT = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
  <path d="M8.75 1.75 3.25 9.25h3.5l-.5 5 5.5-7.5h-3.5l.5-5z" stroke-linejoin="round"/>
</svg>`;

const CHECK = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
  <path d="M3.5 8.5 6.5 11.5 12.5 5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

/**
 * @typedef {ReturnType<typeof import("../usecases/run-playbook.mjs").playbookViewModel>} PlaybookViewModel
 *
 * Errors are appended by the server rather than produced by the use case: they
 * describe the last submission, not the playbook, so they must not live in
 * state where they would survive a refresh.
 *
 * @param {PlaybookViewModel & { errors?: string[] }} vm
 * @returns {string}
 */
export function renderPlaybook(vm) {
	// Two regions, in reading order: everything you read, then the one place
	// you act. The bar is pinned, so the decision is reachable from any scroll
	// position and the reader never has to scroll back up to commit.
	return `
    <div class="doc">
      <section class="intro">
        <p class="lead">${esc(vm.summary)}</p>
        ${vm.rationale.map((r) => `<p class="rationale">${esc(r)}</p>`).join("")}
      </section>

      ${vm.note ? `<p class="notice">${esc(vm.note)}</p>` : ""}
      ${vm.errors?.length ? `<ul class="errors">${vm.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}

      ${vm.panel === "configure" ? renderConfigure(vm) : vm.mode === "auto" ? renderAuto(vm) : renderGuided(vm)}
    </div>

    ${actionBar(vm)}
  `;
}

/**
 * The action bar: choose, then commit.
 *
 * Pinned to the bottom because that is where the reader ends up. The old layout
 * put the choice above a screenful of script and the button below it, so
 * picking a mode and acting on it were separated by the whole document — the
 * operator had to remember what they had selected by the time they scrolled to
 * the button.
 *
 * One row: the segmented control on the left, the button on the right. There
 * was a line of explanatory text between them and it was the third place on
 * screen saying the same thing — the selected segment names the mode and the
 * button names the action, so a sentence restating both was noise that made the
 * bar two uneven rows.
 *
 * @param {PlaybookViewModel} vm
 * @returns {string}
 */
function actionBar(vm) {
	return `
    <div class="action-bar">
      ${panelTabs(vm.panel, vm.paramsAreDefault)}
      ${commitButton(vm)}
    </div>
  `;
}

/**
 * The one button that acts, whichever pane is open.
 *
 * Always present, always the same size in the same corner, so the commit target
 * never moves between panes. Only its label and its colour change — auto is red
 * because it hands over something that rewrites tenant policy with nobody
 * reading between the commands.
 *
 * On the configure pane it does not hand off at all: there is nothing to send,
 * so it returns to the mode the operator came from. Keeping the slot filled
 * means the bar does not reflow when they switch panes.
 *
 * @param {PlaybookViewModel} vm
 * @returns {string}
 */
function commitButton(vm) {
	if (vm.panel === "configure") {
		return `<button type="button" class="primary bar-button" data-panel="${esc(vm.mode)}">
      <span>Continue</span>${CHECK}
    </button>`;
	}

	return vm.mode === "auto"
		? `<button type="button" class="primary bar-button danger" data-action="handoff">
        ${BOLT}<span>Run it in chat</span>
      </button>`
		: `<button type="button" class="primary bar-button" data-action="handoff">
        ${SEND}<span>Walk me through it in chat</span>
      </button>`;
}

/**
 * The configure pane: just the parameters.
 *
 * No "Done" button of its own any more — the action bar owns commit, and two
 * buttons that both mean "leave this pane" is one too many. Nothing here needs
 * saving either: each field posts on change, so the values are applied by the
 * time the operator looks away.
 *
 * @param {PlaybookViewModel} vm
 * @returns {string}
 */
function renderConfigure(vm) {
	return `
    <section class="params" aria-label="Playbook settings">
      <h2>Configure policy</h2>
      <div class="param-grid">${vm.params.map(paramField).join("")}</div>
    </section>
  `;
}

/**
 * What the scripts below are parameterised with.
 *
 * The counterweight to hiding the form: the values still appear everywhere they
 * matter, inside the commands, but an operator scanning a wall of PowerShell
 * should not have to parse it to see which SIT they are about to enforce on.
 * One line, and a way back to change it.
 *
 * @param {PlaybookViewModel} vm
 * @returns {string}
 */
function paramSummary(vm) {
	const values = vm.params.map((p) => `${esc(p.label)}: <b>${esc(p.value)}</b>`).join(" &middot; ");
	return `<p class="param-summary">
    <span>${values}</span>
    <button type="button" class="link-button" data-panel="configure">Change</button>
  </p>`;
}

/**
 * Auto mode: the script, and one button that hands it over.
 *
 * The step list is gone rather than collapsed. Leaving it on screen next to
 * "Copilot runs this" would invite the reader to tick steps nobody is running,
 * and the progress bar would be measuring a thing that no longer happens.
 *
 * @param {PlaybookViewModel} vm
 * @returns {string}
 */
function renderAuto(vm) {
	return `
    <section class="run" aria-label="Run the playbook">
      ${paramSummary(vm)}
      ${autoPanel(vm.autoScript)}
    </section>
  `;
}

/**
 * Guided mode: the steps, and a button that starts the walkthrough.
 *
 * @param {PlaybookViewModel} vm
 * @returns {string}
 */
function renderGuided(vm) {
	return `
    <section class="run" aria-label="Run the playbook">
      <h2>Steps</h2>
      ${paramSummary(vm)}
      ${progressBar(vm.doneCount, vm.stepCount)}
      ${stepList(vm.steps, vm.openStepId)}
    </section>
  `;
}
