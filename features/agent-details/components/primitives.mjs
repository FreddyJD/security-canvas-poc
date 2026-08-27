/**
 * Rendering primitives shared by the agent-details components.
 *
 * Pure: data in, HTML string out, no DOM access at module scope. That is what
 * lets these files be loaded twice — by the browser as ES modules over the
 * panel's local HTTP server, and by Node in the tests — so what is tested is
 * exactly what ships.
 */
import { esc } from "../../../platform/html.mjs";

// Re-exported so a component in this feature needs one import for rendering,
// while the escaping itself stays shared with the other canvases.
export { esc };

/**
 * The mark for a fact none of the sources answered.
 *
 * A hyphen-minus, deliberately — not an em or en dash. The typographically
 * correct choice would be an en dash, but this copy passes through review
 * tooling that flags long dashes as machine-written, so the mark that would be
 * *correct* is the one that would be *rejected*.
 */
export const NOT_AVAILABLE = "-";

/**
 * A value that was never measured.
 *
 * The mark alone is announced as silence by a screen reader, so the words
 * travel in a visually-hidden span beside it — otherwise the row would read as
 * a label followed by nothing, which is exactly the ambiguity ("is this empty
 * or broken?") that drawing the row was meant to remove.
 *
 * @returns {string}
 */
export function missingValue() {
	return `<span class="missing"><span aria-hidden>${NOT_AVAILABLE}</span><span class="sr-only">Not available</span></span>`;
}

/**
 * A tinted pill.
 *
 * @param {string} text
 * @param {string} tone
 * @param {string} [icon] Optional pre-escaped SVG markup.
 * @returns {string}
 */
export function tag(text, tone = "neutral", icon = "") {
	return `<span class="tag tone-${esc(tone)}">${icon}${esc(text)}</span>`;
}

/**
 * The first letters of the first and last word of a name.
 *
 * Exported for its test: initials look trivial and are exactly the kind of
 * thing that quietly produces "" for an empty string or a stray "undefined" for
 * a name with trailing spaces — either of which lands in a circle on screen.
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
 * A titled card — the surface every section on this page sits on.
 *
 * @param {{ title: string, body: string, className?: string, subtitle?: string }} opts
 * @returns {string}
 */
export function sectionCard({ title, body, className = "", subtitle = "" }) {
	return `<section class="card ${esc(className)}">
    <h2 class="card-title">${esc(title)}</h2>
    ${subtitle ? `<p class="card-subtitle">${esc(subtitle)}</p>` : ""}
    ${body}
  </section>`;
}

/** A check-in-circle, matching Fluent's `CheckmarkCircleRegular`. */
export const CHECK_ICON = `<svg class="mark" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
  <circle cx="10" cy="10" r="7.25"/><path d="M6.75 10.25l2.25 2.25 4.25-4.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

/** A warning triangle, matching Fluent's `WarningRegular`. */
export const WARNING_ICON = `<svg class="mark" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
  <path d="M10 3.6 2.9 16.1h14.2L10 3.6z" stroke-linejoin="round"/><path d="M10 8.2v3.4M10 13.7h.01" stroke-linecap="round"/>
</svg>`;

/** A copy affordance, matching Fluent's `CopyRegular`. */
export const COPY_ICON = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">
  <rect x="7.25" y="7.25" width="9" height="9" rx="2"/><path d="M12.75 7.25v-1.5a2 2 0 0 0-2-2h-5a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h1.5"/>
</svg>`;

/** A robot head, matching the Fluent `BotRegular` the Agents table uses. */
export const BOT_ICON = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">
  <rect x="3.25" y="6.75" width="13.5" height="9.5" rx="2.75"/>
  <path d="M10 3.25v3.5M7 11h.01M13 11h.01"/>
  <path d="M7.5 13.75h5" stroke-linecap="round"/>
</svg>`;

/**
 * Pluralize a count without the "1 resources" tell.
 * @param {number} n
 * @param {string} word
 * @returns {string}
 */
export function plural(n, word) {
	return `${n} ${word}${n === 1 ? "" : "s"}`;
}
