/**
 * The playbook screen.
 *
 * Pure: renders the view model and reports interaction through data attributes.
 */
import { esc } from "../../../platform/html.mjs";
import { coverageBanner, paramField, progressBar, stepList } from "../components/playbook-steps.mjs";

const SEND = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
  <path d="M2.5 8h9M8.25 4.5 11.75 8l-3.5 3.5" stroke-linecap="round" stroke-linejoin="round"/>
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
