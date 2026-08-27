/**
 * Search, filter pills, result count and Refresh.
 *
 * Platform pills are derived from the rows rather than hardcoded: the service
 * reports whatever planes the tenant actually has, and a fixed list would offer
 * filters that match nothing while hiding one that matters. Risk pills are
 * fixed, because the four bands are a closed set on the wire.
 *
 * @typedef {import("../domain/types.js").InventoryFilters} InventoryFilters
 */
import { esc } from "../../../platform/html.mjs";
import { RISK_LABEL, RISK_ORDER } from "../domain/presentation.mjs";

const SEARCH_ICON = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
  <circle cx="7" cy="7" r="4.25"/><path d="M10.2 10.2 14 14" stroke-linecap="round"/>
</svg>`;

const REFRESH_ICON = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
  <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" stroke-linecap="round"/>
  <path d="M13.8 2.2v3.1h-3.1" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

/**
 * @param {string} label
 * @param {string} kind   "platform" | "risk"
 * @param {string} value
 * @param {boolean} active
 */
function pill(label, kind, value, active) {
	return `<button
    type="button"
    class="pill${active ? " active" : ""}"
    aria-pressed="${active}"
    data-filter="${esc(kind)}"
    data-value="${esc(value)}"
  >${esc(label)}</button>`;
}

/**
 * @param {object} opts
 * @param {readonly string[]} opts.platforms
 * @param {InventoryFilters} opts.filters
 * @param {number} opts.matchedCount
 * @returns {string}
 */
export function filterBar({ platforms, filters, matchedCount }) {
	const platformPills = platforms
		.map((p) => pill(p, "platform", p, filters.platforms.includes(p)))
		.join("");

	const riskPills = RISK_ORDER.filter((band) => band !== "none")
		.map((band) => pill(RISK_LABEL[band], "risk", band, filters.risks.includes(band)))
		.join("");

	const unassigned = pill("Unassigned", "slice", "unowned", filters.slice === "unowned");

	return `<div class="filter-bar">
    <div class="search">
      <span class="search-icon" aria-hidden>${SEARCH_ICON}</span>
      <input
        id="agent-search"
        type="search"
        placeholder="Search agents..."
        aria-label="Search agents"
        value="${esc(filters.search)}"
      />
    </div>
    <div class="pills">${platformPills}${riskPills}${unassigned}</div>
    <span class="spacer"></span>
    <span class="result-count">${matchedCount.toLocaleString()} agent${matchedCount === 1 ? "" : "s"}</span>
    <button type="button" class="icon-button" data-action="refresh" aria-label="Refresh">
      ${REFRESH_ICON}<span>Refresh</span>
    </button>
  </div>`;
}

/**
 * Page controls.
 *
 * Rendered only when there is more than one page: a pager that can never move
 * is noise, and it implies the table is longer than it is.
 *
 * @param {number} page
 * @param {number} pageCount
 * @returns {string}
 */
export function pager(page, pageCount) {
	if (pageCount <= 1) return "";
	return `<div class="pager">
    <button type="button" class="page-button" data-page="prev" ${page === 0 ? "disabled" : ""}>Previous</button>
    <span class="page-status">Page ${page + 1} of ${pageCount}</span>
    <button type="button" class="page-button" data-page="next" ${page >= pageCount - 1 ? "disabled" : ""}>Next</button>
  </div>`;
}
