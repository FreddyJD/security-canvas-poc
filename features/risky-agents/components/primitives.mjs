/**
 * Rendering primitives shared by every component.
 *
 * These files are loaded twice: by the browser as ES modules over the canvas's
 * local HTTP server, and by Node in tests. That is only possible because they
 * are pure — data in, HTML string out, no DOM access at module scope. Keeping
 * them that way is what makes the UI testable without a browser.
 */

/**
 * Escape untrusted text for HTML interpolation.
 *
 * Every value that reaches the DOM goes through this. Agent display names and
 * `riskEvidence` come from Graph, which means they are ultimately attacker-
 * influenced: an agent named `<img onerror=...>` would otherwise execute
 * inside the analyst's canvas. Escaping at the boundary, not at the source, is
 * what makes that impossible to forget.
 *
 * @param {unknown} s
 * @returns {string}
 */
const HTML_ENTITIES = /** @type {Record<string, string>} */ ({
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
});

export const esc = (/** @type {unknown} */ s) =>
	String(s ?? "").replace(/[&<>"']/g, (c) => HTML_ENTITIES[c] ?? c);

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
