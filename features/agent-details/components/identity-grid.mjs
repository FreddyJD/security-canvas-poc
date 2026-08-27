/**
 * The "Details" card: the labelled identity list.
 *
 * Every fact the page tracks is drawn, whether or not the sources answered it.
 * An unanswered one shows a "not available" mark rather than being dropped, so
 * the list is the same length and the same shape for every agent — and an
 * absent value reads as a recorded absence rather than as a fact this page does
 * not report.
 *
 * Most values are plain text. A few render richer: a status fact shows a toned
 * check before the word, an owner shows an initials avatar beside the name, the
 * sponsors show a facepile, and a copyable value (the Agent ID) shows monospace
 * text with a copy affordance. Copying is a drawing concern the row owns, so
 * the button is declared here and wired by the view.
 *
 * The view model carries a semantic `key` per row; this component maps it to a
 * label, so the domain tier stays string-free.
 *
 * @typedef {import("../domain/types.js").IdentityKey} IdentityKey
 * @typedef {import("../domain/types.js").IdentityRow} IdentityRow
 */
import { CHECK_ICON, COPY_ICON, esc, initials, missingValue } from "./primitives.mjs";

/** The label for each identity row key. @type {Record<IdentityKey, string>} */
const LABELS = {
	status: "Status",
	owner: "Owner",
	sponsors: "Sponsors",
	agentId: "Agent ID",
	identityType: "Identity type",
	publisher: "Publisher",
	platform: "Platform",
	lastUsed: "Last used",
	authentication: "Authentication",
};

/**
 * How many faces a facepile shows before collapsing the rest into a count.
 *
 * Four is where the overlap stops reading as a group and starts reading as a
 * smear; past it the "+N" is both smaller and more precise than another disc.
 */
const FACEPILE_LIMIT = 4;

/**
 * The sponsors, as overlapping initials.
 * @param {readonly string[]} names
 * @param {string} label
 * @returns {string}
 */
function facepile(names, label) {
	const shown = names.slice(0, FACEPILE_LIMIT);
	const rest = names.length - shown.length;
	return `<span class="facepile" role="img" aria-label="${esc(label)}: ${esc(names.join(", "))}">
    ${shown.map((name) => `<span class="face" title="${esc(name)}">${esc(initials(name))}</span>`).join("")}
    ${rest > 0 ? `<span class="face face-more">+${rest}</span>` : ""}
  </span>`;
}

/**
 * One row's value, chosen by its render mode.
 *
 * An unanswered fact draws the same mark whatever its mode: a facepile of
 * nobody and a copy button with nothing to copy are affordances for content
 * that is not there.
 *
 * @param {IdentityRow} row
 * @param {string} label
 * @returns {string}
 */
export function factValue(row, label) {
	if (!row.known) return missingValue();

	if (row.render === "facepile") return facepile(row.facepile ?? [], label);

	if (row.render === "avatar") {
		return `<span class="avatar-value">
      <span class="face" aria-hidden>${esc(initials(row.value ?? ""))}</span>
      <span class="value">${esc(row.value)}</span>
    </span>`;
	}

	if (row.render === "monoCopyable") {
		return `<span class="copy-row">
      <span class="value mono">${esc(row.value)}</span>
      <button type="button" class="icon-btn" data-copy="${esc(row.value)}" aria-label="Copy ${esc(label)}">${COPY_ICON}</button>
    </span>`;
	}

	// The authentication row's value is derived chrome this component owns; every
	// other text row draws its real value.
	const text = row.key === "authentication" ? "Entra required" : row.value;

	if (row.status) {
		return `<span class="status-value"><span class="tone-${esc(row.status)}">${CHECK_ICON}</span><span class="value">${esc(text)}</span></span>`;
	}
	return `<span class="value">${esc(text)}</span>`;
}

/**
 * The identity facts list.
 * @param {readonly IdentityRow[]} facts
 * @returns {string}
 */
export function identityGrid(facts) {
	return `<dl class="identity" aria-label="Agent identity">
    ${facts
			.map((row) => {
				const label = LABELS[row.key] ?? row.key;
				return `<div class="identity-row">
        <dt class="identity-label">${esc(label)}</dt>
        <dd class="identity-value">${factValue(row, label)}</dd>
      </div>`;
			})
			.join("")}
  </dl>`;
}
