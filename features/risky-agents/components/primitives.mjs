/**
 * Rendering primitives shared by every component.
 *
 * These files are loaded twice: by the browser as ES modules over the canvas's
 * local HTTP server, and by Node in tests. That is only possible because they
 * are pure — data in, HTML string out, no DOM access at module scope. Keeping
 * them that way is what makes the UI testable without a browser.
 */
import { esc } from "../../../platform/html.mjs";

// Re-exported so a component in this feature needs only one import for
// rendering, while the escaping itself stays shared with the other canvas.
export { esc };

/** Canonical severity colours. One source, so badge and bar never drift apart. */
export const SEVERITY_COLOR = {
	critical: "#f85149",
	high: "#db6d28",
	medium: "#d29922",
	low: "#3fb950",
	info: "#58a6ff",
};

/**
 * @param {import("../domain/types.js").Severity} severity
 * @returns {string}
 */
export function severityBadge(severity) {
	return `<span class="sev ${esc(severity)}">${esc(severity)}</span>`;
}

/**
 * @param {string} text
 * @returns {string}
 */
export function pill(text) {
	return `<span class="pill">${esc(text)}</span>`;
}

/**
 * A 0..100 progress bar tinted by severity.
 *
 * @param {number} score
 * @param {import("../domain/types.js").Severity} severity
 * @returns {string}
 */
export function scoreBar(score, severity) {
	const width = Math.max(0, Math.min(100, Number(score) || 0));
	return `<div class="bar"><i style="width:${width}%;background:${SEVERITY_COLOR[severity] ?? SEVERITY_COLOR.info}"></i></div>`;
}

/**
 * @param {object} opts
 * @param {string} opts.title      Pre-escaped or plain title text.
 * @param {string} [opts.body]     Optional HTML body.
 * @param {string} [opts.evidence] Monospace evidence block.
 * @param {string} [opts.badge]    Trailing badge HTML.
 * @returns {string}
 */
export function card({ title, body = "", evidence = "", badge = "" }) {
	return `<div class="card">
    <div class="t">${esc(title)}${badge}</div>
    ${body}
    ${evidence ? `<div class="ev">${esc(evidence)}</div>` : ""}
  </div>`;
}

/**
 * A labelled value in the summary strip.
 * @param {string} label
 * @param {string} value  Raw HTML — callers escape or supply markup deliberately.
 * @returns {string}
 */
export function keyValue(label, value) {
	return `<div><b>${esc(label)}</b>${value}</div>`;
}

/**
 * @param {string} message
 * @returns {string}
 */
export function empty(message) {
	return `<div class="empty">${esc(message)}</div>`;
}

/**
 * Pluralize a count without the "1 factors" tell.
 * @param {number} n
 * @param {string} word
 * @returns {string}
 */
export function plural(n, word) {
	return `${n} ${word}${n === 1 ? "" : "s"}`;
}
