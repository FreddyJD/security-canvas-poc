/**
 * Table cells for the agent inventory, ported from the Security-UX
 * `RecordTableCells` shapes so the two surfaces render the same objects.
 *
 * Pure string functions. Loaded by Node in tests and by the browser as ES
 * modules, which is what keeps what is tested identical to what ships.
 *
 * @typedef {import("../domain/types.js").InventoryAgent} InventoryAgent
 * @typedef {import("../domain/types.js").Tone} Tone
 */
import { esc } from "../../../platform/html.mjs";
import {
	NO_ACTIVITY_LABEL,
	RISK_LABEL,
	RISK_SEGMENTS,
	RISK_TONE,
	UNOWNED_LABEL,
	discoveryLabel,
	hasOwner,
	lastUsedLabel,
	riskFill,
	statusTone,
} from "../domain/presentation.mjs";

/** A robot glyph, matching the Fluent `BotRegular` the Security-UX table uses. */
const BOT_ICON = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">
  <rect x="3.25" y="6.75" width="13.5" height="9.5" rx="2.75"/>
  <path d="M10 3.25v3.5M7 11h.01M13 11h.01"/>
  <path d="M7.5 13.75h5" stroke-linecap="round"/>
</svg>`;

/**
 * Name cell: icon tile, bold title, muted publisher beneath.
 *
 * The publisher alone under the title — the activity label has its own column,
 * and repeating it here would print the same fact twice per row in two
 * different wordings.
 *
 * @param {InventoryAgent} agent
 * @returns {string}
 */
export function titleCell(agent) {
	return `<div class="title-cell">
    <span class="tile" aria-hidden>${BOT_ICON}</span>
    <span class="title-text">
      <span class="title-name" title="${esc(agent.title)}">${esc(agent.title)}</span>
      <span class="title-sub" title="${esc(agent.publisher)}">${esc(agent.publisher)}</span>
    </span>
  </div>`;
}

/**
 * A tinted dot with its status beside it.
 *
 * The label is required, and that is the design: a column of bare coloured dots
 * is unreadable to a screen reader, ambiguous to anyone colourblind, and
 * guesswork on a first visit — green could mean "active", "healthy" or
 * "online", which are not the same claim. The word stays neutral ink while the
 * dot carries the tone, so the column does not become a run of coloured text.
 *
 * @param {string} label
 * @returns {string}
 */
export function statusCell(label) {
	if (!label) return unknownCell();
	return `<span class="status-cell">
    <span class="status-dot tone-${esc(statusTone(label))}" aria-hidden></span>
    <span class="status-label">${esc(label)}</span>
  </span>`;
}

/**
 * A segmented meter with its reading beside it.
 *
 * The whole meter is one `role="img"` with the reading in its name: four
 * unlabelled spans would be announced as nothing at all, and labelling each
 * segment would announce the picture rather than the fact.
 *
 * @param {number} value
 * @param {number} max
 * @param {string} label
 * @param {Tone} tone
 * @returns {string}
 */
export function meterCell(value, max, label, tone) {
	const filled = Math.max(0, Math.min(max, value));
	const segments = Array.from(
		{ length: max },
		(_, i) => `<span class="meter-seg${i < filled ? ` filled tone-${esc(tone)}` : ""}"></span>`,
	).join("");

	return `<span class="meter-cell">
    <span class="meter" role="img" aria-label="Risk: ${esc(label)}">${segments}</span>
    <span class="meter-label">${esc(label)}</span>
  </span>`;
}

/**
 * Owner cell: an initials avatar with the name, or the dim unowned label.
 * @param {InventoryAgent} agent
 */
export function ownerCell(agent) {
	if (!hasOwner(agent)) return `<span class="dim-italic">${UNOWNED_LABEL}</span>`;
	const name = /** @type {string} */ (agent.owner);
	return `<span class="person-cell">
    <span class="avatar" aria-hidden>${esc(initials(name))}</span>
    <span class="person-name" title="${esc(name)}">${esc(name)}</span>
  </span>`;
}

/**
 * The first letters of the first and last word of a name.
 *
 * Exported for its test: initials look trivial and are exactly the kind of
 * thing that quietly produces "" for an empty string or a stray "undefined"
 * for a name with trailing spaces — either of which lands in a circle on
 * screen.
 *
 * @param {string} name
 * @returns {string}
 */
export function initials(name) {
	const words = String(name ?? "")
		.trim()
		.split(/\s+/)
		.filter(Boolean);
	if (words.length === 0) return "?";
	const first = words[0]?.[0] ?? "";
	const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";
	return (first + last).toUpperCase();
}

/**
 * Dim italic, for a value the estate never measured.
 *
 * The same treatment an unowned row gets: rendering "N/A" in the same weight as
 * a real age would let it read as a value that was reported. The label is
 * abbreviated, so it carries a spoken form rather than being announced as "na".
 *
 * @param {string} [label]
 */
export function unknownCell(label = NO_ACTIVITY_LABEL) {
	return `<span class="dim-italic" aria-label="Not available">${esc(label)}</span>`;
}

/**
 * One table row.
 *
 * The row is a button in all but name: clicking it hands the agent to the model
 * to investigate. `tabindex` plus an explicit label is what keeps that reachable
 * from the keyboard and announced as an action rather than as seven cells.
 *
 * @param {InventoryAgent} agent
 * @returns {string}
 */
export function agentRow(agent) {
	const used = lastUsedLabel(agent);
	const band = agent.riskLevel ?? "none";

	return `<tr
    data-agent-id="${esc(agent.agentId)}"
    tabindex="0"
    role="button"
    aria-label="Investigate ${esc(agent.title)}"
  >
    <td>${titleCell(agent)}</td>
    <td class="cell-text">${esc(discoveryLabel(agent.source))}</td>
    <td class="cell-text">${esc(agent.platform)}</td>
    <td>${ownerCell(agent)}</td>
    <td class="cell-text">${used ? esc(used) : unknownCell()}</td>
    <td>${meterCell(riskFill(band), RISK_SEGMENTS, RISK_LABEL[band] ?? "None", RISK_TONE[band] ?? "neutral")}</td>
    <td>${statusCell(agent.status)}</td>
  </tr>`;
}

/** The sortable columns, in order. */
export const COLUMNS = [
	{ id: "name", label: "Name" },
	{ id: "discovery", label: "Discovery" },
	{ id: "platform", label: "Platform" },
	{ id: "owner", label: "Owner" },
	{ id: "lastUsed", label: "Last used" },
	{ id: "risk", label: "Risk" },
	{ id: "status", label: "Status" },
];

/**
 * The full table.
 *
 * `aria-sort` on the active header is what tells a screen-reader user the
 * column order changed — the caret alone is visual-only.
 *
 * @param {readonly InventoryAgent[]} rows
 * @param {import("../domain/types.js").InventorySort} sort
 * @param {string} [emptyMessage] What to say when nothing matched.
 * @returns {string}
 */
export function agentTable(rows, sort, emptyMessage = "No agents match these filters.") {
	const headers = COLUMNS.map((col) => {
		const active = sort.column === col.id;
		const ariaSort = active ? (sort.descending ? "descending" : "ascending") : "none";
		const caret = active ? `<span class="caret" aria-hidden>${sort.descending ? "▾" : "▴"}</span>` : "";
		return `<th aria-sort="${ariaSort}">
      <button type="button" class="th-button${active ? " active" : ""}" data-sort="${col.id}">
        ${esc(col.label)}${caret}
      </button>
    </th>`;
	}).join("");

	const body = rows.length
		? rows.map(agentRow).join("")
		: `<tr><td colspan="${COLUMNS.length}" class="empty-row">${esc(emptyMessage)}</td></tr>`;

	return `<table class="agent-table">
    <thead><tr>${headers}</tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}
