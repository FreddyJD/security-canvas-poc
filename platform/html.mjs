/**
 * HTML escaping — the one boundary every rendered string crosses.
 *
 * In `platform/` rather than inside a feature because both canvases need it,
 * and a second copy is exactly how one of them ends up with a subtly weaker
 * version. It is also the reason this file has no imports: it is loaded by the
 * browser as an ES module, and a shared helper that dragged feature code into
 * every page would be a liability.
 */

/** @type {Record<string, string>} */
const HTML_ENTITIES = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
};

/**
 * Escape untrusted text for HTML interpolation.
 *
 * Every value that reaches the DOM goes through this. Agent display names,
 * publishers and `riskEvidence` all originate from Graph or from third-party
 * app registrations, which means they are ultimately attacker-influenced: an
 * agent named `<img onerror=...>` would otherwise execute inside the analyst's
 * canvas. Escaping at the boundary, not at the source, is what makes that
 * impossible to forget.
 *
 * Single quotes are included deliberately — values are interpolated into
 * attributes as well as text, and omitting `'` allows attribute break-out.
 *
 * @param {unknown} s
 * @returns {string}
 */
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => HTML_ENTITIES[c] ?? c);
