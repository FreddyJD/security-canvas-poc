/**
 * The agent-details screen: header, details card, risk card, access card, graph.
 *
 * Pure. It renders whatever the state hands it and reports interaction through
 * data attributes; the client wires them.
 *
 * The split from components/ is about ownership. A component renders a fragment
 * from arguments; a view owns a whole screen for one state shape and decides
 * which components appear.
 *
 * @typedef {import("../domain/types.js").DetailsState} DetailsState
 */
import { esc } from "../../../platform/html.mjs";
import { accessGraphSection } from "../components/access-graph.mjs";
import { agentAccess } from "../components/agent-access.mjs";
import { detailHeader } from "../components/detail-header.mjs";
import { identityGrid } from "../components/identity-grid.mjs";
import { sectionCard } from "../components/primitives.mjs";
import { unifiedRiskScore } from "../components/risk-score.mjs";

const SHIELD = `<svg class="gate-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
  <path d="M12 3l7 3v6c0 4.4-3 8.3-7 9-4-0.7-7-4.6-7-9V6l7-3z"/>
</svg>`;

/**
 * The pre-content screen — everything that is not a loaded agent.
 *
 * Every non-connected status resolves to one of these. Splitting it out of the
 * page keeps the happy path readable and means an added status is a change in
 * one file.
 *
 * @param {DetailsState} state
 * @returns {string}
 */
export function detailsGate(state) {
	if (state.status === "idle") {
		return `<div class="gate">${SHIELD}
      <h2>No agent selected</h2>
      <p>This page opens from a row in the Agents table, or from the <code>get_agent_details</code> tool. Pick an agent to see its details.</p>
    </div>`;
	}

	if (state.status === "loading") {
		return `<div class="gate">${SHIELD}<h2>Loading</h2><p><span class="spin"></span>Reading this agent's details…</p></div>`;
	}

	if (state.status === "not-found") {
		return `<div class="gate">${SHIELD}
      <h2>Agent not found</h2>
      <p>${esc(state.note)}</p>
      <button type="button" class="primary" data-action="back">Back to agents</button>
    </div>`;
	}

	if (state.status === "error") {
		return `<div class="gate">${SHIELD}
      <h2 class="err">Could not load this agent</h2>
      <p class="err">${esc(state.note)}</p>
      ${state.hint ? `<p class="gate-hint">${esc(state.hint)}</p>` : ""}
      <button type="button" class="primary" data-action="retry">Try again</button>
    </div>`;
	}

	// needs-auth
	return `<div class="gate">${SHIELD}
    <h2>Agent details</h2>
    <p>${esc(state.note || "Sign in to read this agent's details from your tenant.")}</p>
    <button type="button" class="primary" data-action="connect">Sign in with Microsoft</button>
  </div>`;
}

/**
 * The page.
 *
 * The graph section is rendered from the *first* frame, including while the
 * detail document is still in flight. It used to be tempting to withhold it
 * until the graph resolved, which meant the page grew a whole section under the
 * reader at whatever moment the fetch happened to land — the "glitchy" arrival
 * the shimmering placeholder exists to replace.
 *
 * @param {DetailsState} state
 * @returns {string}
 */
export function renderDetails(state) {
	if (state.status !== "connected" || !state.vm) return detailsGate(state);
	const vm = state.vm;

	return `
    ${detailHeader(vm)}
    <div class="detail-grid">
      <div class="detail-main">
        ${sectionCard({ title: "Details", body: identityGrid(vm.identityRows), className: "details-card" })}
      </div>
      <aside class="detail-rail">
        ${sectionCard({ title: "Unified risk score", body: unifiedRiskScore(vm.risk, vm.posture) })}
        ${sectionCard({ title: "Agent's access", body: agentAccess(vm.access), className: "rail-fill" })}
      </aside>
    </div>
    ${accessGraphSection()}
  `;
}
