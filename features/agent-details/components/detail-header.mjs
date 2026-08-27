/**
 * The page header: the agent's icon, its name, and its governance verdict.
 *
 * Stateless. A back affordance is declared as a `data-action` and wired by the
 * view; this module never calls fetch.
 *
 * @typedef {import("../domain/types.js").AgentDetailsVM} AgentDetailsVM
 */
import { BOT_ICON, esc } from "./primitives.mjs";

/**
 * The governance pill's words.
 *
 * Only drawn when a verdict is actually known — see `buildGovernance`. An agent
 * Conditional Access can never target must not be labelled "Ungoverned", which
 * would read as a finding rather than as an absence, so the adapter omits the
 * verdict entirely and this draws nothing.
 *
 * @param {NonNullable<AgentDetailsVM["governance"]>} governance
 * @returns {string}
 */
function governancePill(governance) {
	const label = governance.kind === "governed" ? "Governed" : "Ungoverned";
	return `<span class="gov gov-${esc(governance.kind)}">${esc(label)}</span>`;
}

/**
 * @param {AgentDetailsVM} vm
 * @returns {string}
 */
export function detailHeader(vm) {
	return `<div class="detail-head">
    <nav class="crumbs" aria-label="Breadcrumb">
      <button type="button" class="crumb-link" data-action="back">Agents</button>
      <span class="crumb-sep" aria-hidden>&rsaquo;</span>
      <span class="crumb-current" aria-current="page">${esc(vm.name)}</span>
    </nav>
    <div class="head-row">
      <span class="head-avatar" aria-hidden>${BOT_ICON}</span>
      <div class="head-text">
        <h1 class="head-name">${esc(vm.name)}</h1>
        <div class="head-status" role="group" aria-label="Agent status">
          ${vm.governance ? governancePill(vm.governance) : ""}
          ${vm.verified ? `<span class="head-verified">Verified in Entra</span>` : ""}
        </div>
      </div>
    </div>
  </div>`;
}
