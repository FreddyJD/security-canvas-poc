/**
 * The Agents screen: title, metric cards, filter bar, table, pager.
 *
 * Pure. It renders whatever the view model hands it and reports interaction
 * through data attributes; the client wires them.
 *
 * @typedef {import("../domain/types.js").InventoryState} InventoryState
 */
import { esc } from "../../../platform/html.mjs";
import { agentTable } from "../components/agent-table.mjs";
import { filterBar, pager } from "../components/filter-bar.mjs";
import { metricRow } from "../components/metric-card.mjs";
import { emptyMessage } from "../domain/presentation.mjs";

const SHIELD = `<svg class="gate-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
  <path d="M12 3l7 3v6c0 4.4-3 8.3-7 9-4-0.7-7-4.6-7-9V6l7-3z"/>
</svg>`;

/**
 * The pre-connection screen.
 * @param {{ status: string, note: string, hint: string }} state
 */
export function inventoryGate(state) {
	if (state.status === "loading") {
		// The note carries what we are actually waiting on — reading the
		// inventory, or a sign-in round-trip in the browser. Falling back keeps
		// the first paint honest before anything has been attempted.
		const what = state.note || "Reading your agent inventory…";
		return `<div class="gate">${SHIELD}<h2>Loading</h2><p><span class="spin"></span>${esc(what)}</p></div>`;
	}
	if (state.status === "error") {
		return `<div class="gate">${SHIELD}
      <h2 class="err">Could not load agents</h2>
      <p class="err">${esc(state.note)}</p>
      ${state.hint ? `<p class="gate-hint">${esc(state.hint)}</p>` : ""}
      <button type="button" class="primary" data-action="refresh">Try again</button>
    </div>`;
	}
	return `<div class="gate">${SHIELD}
    <h2>Agents</h2>
    <p>Your agent estate across Microsoft 365 Copilot, Copilot Studio, Endpoint and more.</p>
    <button type="button" class="primary" data-action="connect">Sign in with Microsoft</button>
  </div>`;
}

/**
 * @param {ReturnType<typeof import("../usecases/inventory-browse.mjs").inventoryViewModel>} vm
 * @returns {string}
 */
export function renderInventory(vm) {
	if (vm.status !== "connected") return inventoryGate(vm);

	return `
    ${metricRow(vm.metrics, vm.filters.slice)}
    ${filterBar({ platforms: vm.platforms, filters: vm.filters, matchedCount: vm.matchedCount })}
    ${vm.note ? `<p class="scope-note">${esc(vm.note)}</p>` : ""}
    <div class="table-wrap">${agentTable(vm.rows, vm.sort, emptyMessage(vm.filters))}</div>
    ${pager(vm.page, vm.pageCount)}
  `;
}
