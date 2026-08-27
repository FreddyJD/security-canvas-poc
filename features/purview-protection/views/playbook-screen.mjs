/**
 * The playbook screen.
 *
 * Pure: renders the view model and reports interaction through data attributes.
 */
import { esc } from "../../../platform/html.mjs";
import { autoPanel, coverageBanner, modeToggle, paramField, progressBar, stepList } from "../components/playbook-steps.mjs";

const SEND = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
  <path d="M2.5 8h9M8.25 4.5 11.75 8l-3.5 3.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const BOLT = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
  <path d="M8.75 1.75 3.25 9.25h3.5l-.5 5 5.5-7.5h-3.5l.5-5z" stroke-linejoin="round"/>
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
	return `
    ${coverageBanner(vm.coverage, vm.coverageSummary)}

    <section class="intro">
      <p class="lead">${esc(vm.summary)}</p>
      ${vm.rationale.map((r) => `<p class="rationale">${esc(r)}</p>`).join("")}
    </section>

    ${vm.note ? `<p class="notice">${esc(vm.note)}</p>` : ""}
    ${vm.errors?.length ? `<ul class="errors">${vm.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}

    <section class="params" aria-label="Playbook settings">
      <h2>Settings</h2>
      <div class="param-grid">${vm.params.map(paramField).join("")}</div>
    </section>

    <section class="mode-section" aria-label="How to run this">
      <h2>How to run this</h2>
      ${modeToggle(vm.mode)}
    </section>

    ${vm.mode === "auto" ? renderAuto(vm) : renderGuided(vm)}
  `;
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
      ${autoPanel(vm.autoScript)}
      <p class="handoff-note">
        Copilot will run this in a terminal. Sign-in still happens in your browser, under your account —
        the script waits for you.
      </p>
      <button type="button" class="primary send-button danger" data-action="handoff">
        ${BOLT}<span>Run it in chat</span>
      </button>
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
      ${progressBar(vm.doneCount, vm.stepCount)}
      <p class="handoff-note">
        Nothing on this screen changes your tenant. Send the playbook to the chat and Copilot will
        walk you through it one step at a time — you run the commands in your own session.
      </p>
      <button type="button" class="primary send-button" data-action="handoff">
        ${SEND}<span>Walk me through this in chat</span>
      </button>
      ${stepList(vm.steps, vm.openStepId)}
    </section>
  `;
}
