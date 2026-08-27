/**
 * Browser entry point for the Agents screen.
 *
 * Subscribes to state over SSE, hands it to the view, and turns interaction
 * into POSTs. All rendering lives in components/ and views/, imported here as
 * real ES modules — the same ones the Node tests import.
 *
 * Theme is the one piece of state deliberately kept client-side. It is a
 * per-reader display preference, not tenant data: routing it through the server
 * would mean a round-trip and a full re-render to change a colour, and would
 * make two panels open side by side fight over one value.
 */
import { renderInventory } from "./inventory-screen.mjs";

const SUN = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
  <circle cx="10" cy="10" r="3.5"/>
  <path d="M10 1.5v2M10 16.5v2M18.5 10h-2M3.5 10h-2M16 4l-1.4 1.4M5.4 14.6 4 16M16 16l-1.4-1.4M5.4 5.4 4 4" stroke-linecap="round"/>
</svg>`;

const MOON = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
  <path d="M17 12.3A7.5 7.5 0 0 1 7.7 3a7.5 7.5 0 1 0 9.3 9.3z" stroke-linejoin="round"/>
</svg>`;

const THEME_KEY = "security-canvas-theme";

/** @param {string} id */
function el(id) {
	const node = document.getElementById(id);
	if (!node) throw new Error(`Canvas shell is missing #${id}`);
	return node;
}

const ui = { main: el("main"), theme: el("theme-toggle") };

/**
 * Apply a theme and remember it.
 *
 * `data-theme` on the root is the whole mechanism: the token custom properties
 * are scoped to it, so one attribute retints every component with no re-render
 * and no stylesheet swap.
 *
 * @param {"light" | "dark"} theme
 */
function applyTheme(theme) {
	document.documentElement.dataset.theme = theme;
	ui.theme.innerHTML = theme === "dark" ? SUN : MOON;
	ui.theme.setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
	try {
		localStorage.setItem(THEME_KEY, theme);
	} catch {
		// Storage can be unavailable in an embedded webview. The toggle still
		// works for this session; it just will not be remembered.
	}
}

/**
 * The reader's stored choice, else the OS preference.
 *
 * Honouring `prefers-color-scheme` on first open matters here: the canvas is
 * embedded in an app that already has a theme, and defaulting to light inside a
 * dark host is a flash of the wrong colour on every launch.
 *
 * @returns {"light" | "dark"}
 */
function initialTheme() {
	try {
		const stored = localStorage.getItem(THEME_KEY);
		if (stored === "light" || stored === "dark") return stored;
	} catch {
		/* fall through to the OS preference */
	}
	return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * @param {string} url
 * @param {Record<string, unknown>} [body]
 */
const post = (url, body) =>
	fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body || {}),
	});

/**
 * Preserved across re-renders so typing does not lose the caret.
 * @param {any} vm The view model, as sent over SSE.
 */
function render(vm) {
	const search = /** @type {HTMLInputElement | null} */ (document.getElementById("agent-search"));
	const focused = document.activeElement === search;
	const caret = search?.selectionStart ?? null;

	ui.main.innerHTML = renderInventory(vm);

	if (focused) {
		const next = /** @type {HTMLInputElement | null} */ (document.getElementById("agent-search"));
		if (next) {
			next.focus();
			if (caret !== null) next.setSelectionRange(caret, caret);
		}
	}
}

/**
 * @param {EventTarget | null} target
 * @param {string} selector
 * @returns {HTMLElement | null}
 */
function closest(target, selector) {
	return target instanceof Element ? /** @type {HTMLElement | null} */ (target.closest(selector)) : null;
}

// One delegated listener: every render replaces innerHTML, so listeners bound
// to individual elements would die on the next state update.
document.addEventListener("click", (e) => {
	if (closest(e.target, "#theme-toggle")) {
		return applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
	}

	const sort = closest(e.target, "[data-sort]");
	if (sort) return void post("/api/inventory/sort", { column: sort.dataset.sort });

	const pill = closest(e.target, "[data-filter]");
	if (pill) {
		return void post("/api/inventory/filter", { kind: pill.dataset.filter, value: pill.dataset.value });
	}

	const slice = closest(e.target, "[data-slice]");
	if (slice) return void post("/api/inventory/slice", { slice: slice.dataset.slice });

	const page = closest(e.target, "[data-page]");
	if (page) return void post("/api/inventory/page", { direction: page.dataset.page });

	const action = closest(e.target, "[data-action]");
	if (action) {
		if (action.dataset.action === "refresh") return void post("/api/inventory/refresh");
		if (action.dataset.action === "connect") return void post("/api/connect");
	}

	const breakdown = closest(e.target, "[data-breakdown]");
	if (breakdown) return void post("/api/inventory/slice", { slice: breakdown.dataset.breakdown });

	// Last, so a click on a control *inside* a row is handled by that control
	// rather than being swallowed by the row it sits in.
	const row = closest(e.target, "[data-agent-id]");
	if (row) return void post("/api/inventory/investigate", { agentId: row.dataset.agentId });
});

/**
 * Keyboard activation for table rows.
 *
 * The rows carry `tabindex` and `role="button"`, which promises Enter and Space
 * work — a focusable thing that only responds to a mouse is worse than one that
 * was never focusable. Space is prevented from scrolling the panel, as it would
 * on a real button.
 */
document.addEventListener("keydown", (e) => {
	if (e.key !== "Enter" && e.key !== " ") return;
	const row = closest(e.target, "[data-agent-id]");
	if (!row) return;
	e.preventDefault();
	void post("/api/inventory/investigate", { agentId: row.dataset.agentId });
});

/**
 * Search, debounced.
 *
 * Every keystroke is a POST that re-renders the table; without this, typing
 * "copilot" fires seven renders and the caret fights the reader. 180ms is below
 * the threshold where a filter feels laggy and well above a fast typist's
 * inter-key gap.
 */
/** @type {ReturnType<typeof setTimeout> | undefined} */
let searchTimer;
document.addEventListener("input", (e) => {
	const target = /** @type {HTMLInputElement} */ (e.target);
	if (target?.id !== "agent-search") return;
	clearTimeout(searchTimer);
	const value = target.value;
	searchTimer = setTimeout(() => post("/api/inventory/filter", { kind: "search", value }), 180);
});

applyTheme(initialTheme());
new EventSource("/api/inventory/events").addEventListener("state", (e) => {
	render(JSON.parse(/** @type {MessageEvent} */ (e).data));
});
