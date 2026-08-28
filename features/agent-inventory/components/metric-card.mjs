/**
 * The four headline counts above the table.
 *
 * Each card reports a slice and applies the same slice, so the natural control
 * is one that stays down while it is in effect — `aria-pressed` carries that,
 * and pressing an active card releases it. "Total agents" is the identity
 * slice: selecting it *is* clearing the filter.
 *
 * No trend line and no proportion bar. The inventory returns the estate as it
 * is now with no history, so any trend would be a number this page invented —
 * and a fabricated percentage on a security console is worse than a missing
 * one.
 *
 * @typedef {import("../domain/types.js").AgentMetric} AgentMetric
 */
import { esc } from "../../../platform/html.mjs";

/**
 * The share of the estate a metric covers.
 * Guarded: an empty estate would otherwise render `NaN%`.
 *
 * @param {AgentMetric} metric
 * @returns {number}
 */
export function sharePercent(metric) {
	if (metric.total <= 0) return 0;
	return Math.round((metric.value / metric.total) * 100);
}

/**
 * @param {AgentMetric} metric
 * @param {boolean} selected
 * @returns {string}
 */
export function metricCard(metric, selected) {
	const share =
		metric.shareLabel ??
		(metric.value === metric.total
			? "of the whole estate"
			: `${sharePercent(metric)}% of ${metric.total.toLocaleString()} agents`);

	return `<div class="metric-card${selected ? " selected" : ""}">
    <button
      type="button"
      class="metric-toggle"
      aria-pressed="${selected}"
      aria-label="${esc(metric.label)}: ${metric.value.toLocaleString()}, ${esc(share)}. Filter the list."
      data-slice="${esc(metric.id)}"
    ></button>
    <span class="metric-label" aria-hidden>${esc(metric.label)}</span>
    <span class="metric-value" aria-hidden>${metric.value.toLocaleString()}</span>
    <span class="metric-share" aria-hidden>${esc(share)}</span>
    <button
      type="button"
      class="metric-breakdown"
      aria-label="${esc(metric.breakdownLabel)} for ${esc(metric.label)}"
      data-breakdown="${esc(metric.id)}"
    >${esc(metric.breakdownLabel)}</button>
  </div>`;
}

/**
 * @param {readonly AgentMetric[]} metrics
 * @param {string} slice
 * @returns {string}
 */
export function metricRow(metrics, slice) {
	return `<div class="metrics" role="group" aria-label="Filter by category">
    ${metrics.map((m) => metricCard(m, m.id === slice)).join("")}
  </div>`;
}
