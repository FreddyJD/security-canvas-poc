/**
 * Browser entry point for the agent-details screen.
 *
 * Runs in the canvas webview, not in Node. It subscribes to state over SSE,
 * hands it to the view, and turns interaction into POSTs. All rendering lives
 * in components/ and views/, imported here as real ES modules — the same ones
 * the Node tests import, so what is tested is what ships.
 *
 * ### The map is mounted, not re-rendered
 *
 * Everything except the graph is a pure string that is swapped into `innerHTML`
 * on each frame. The graph cannot be: it owns a camera, a set of drag offsets,
 * an open card and an animation loop, and replacing its DOM would reset all
 * four every time an unrelated field changed. So it is mounted once, when the
 * section first appears, and fed new data through `update()` afterwards.
 *
 * @typedef {import("../domain/types.js").DetailsState} DetailsState
 */
import { mountAccessGraph } from "../components/access-graph.mjs";
import { renderDetails } from "./details-screen.mjs";

const SUN = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
  <circle cx="10" cy="10" r="3.5"/>
  <path d="M10 1.5v2M10 16.5v2M18.5 10h-2M3.5 10h-2M16 4l-1.4 1.4M5.4 14.6 4 16M16 16l-1.4-1.4M5.4 5.4 4 4" stroke-linecap="round"/>
</svg>`;

const MOON = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
  <path d="M17 12.3A7.5 7.5 0 0 1 7.7 3a7.5 7.5 0 1 0 9.3 9.3z" stroke-linejoin="round"/>
</svg>`;

/** Shared with the Agents panel, so the two surfaces agree on theme. */
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
 * and no stylesheet swap. The map watches the same attribute and repaints its
 * canvas, which CSS alone cannot do to a bitmap.
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

/** @returns {"light" | "dark"} */
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

/** @type {ReturnType<typeof mountAccessGraph>} */
let graph = null;

/**
 * The last agent whose page structure was rendered.
 *
 * The guard that keeps the map alive. Re-rendering the page for the *same*
 * agent — which is what phase two of the load does — must not touch the graph
 * section, or the camera resets the instant the depth arrives, which is the one
 * moment the reader is most likely to be looking at it.
 *
 * @type {string | null}
 */
let mountedFor = null;

/** @param {DetailsState} state */
function render(state) {
	const agentId = state.status === "connected" && state.vm ? state.vm.agentId : null;

	if (agentId === null || agentId !== mountedFor) {
		graph?.destroy();
		graph = null;
		ui.main.innerHTML = renderDetails(state);
		mountedFor = agentId;
		if (agentId && state.vm) {
			graph = mountAccessGraph({ graph: state.vm.accessGraph, isLoading: state.graphLoading });
		}
		return;
	}

	// Same agent, new facts. Patch the parts that are strings and hand the graph
	// its data rather than rebuilding it.
	if (!state.vm) return;
	const rendered = renderDetails(state);
	const parsed = new DOMParser().parseFromString(`<div>${rendered}</div>`, "text/html");
	const nextGrid = parsed.querySelector(".detail-grid");
	const nextHead = parsed.querySelector(".detail-head");
	const currentGrid = ui.main.querySelector(".detail-grid");
	const currentHead = ui.main.querySelector(".detail-head");
	if (nextGrid && currentGrid) currentGrid.innerHTML = nextGrid.innerHTML;
	if (nextHead && currentHead) currentHead.innerHTML = nextHead.innerHTML;

	graph?.update(state.vm.accessGraph, state.graphLoading);
}

/**
 * @param {EventTarget | null} target
 * @param {string} selector
 * @returns {HTMLElement | null}
 */
function closest(target, selector) {
	return target instanceof Element ? /** @type {HTMLElement | null} */ (target.closest(selector)) : null;
}

// One delegated listener: every render replaces innerHTML, so listeners bound to
// individual elements would die on the next state update.
document.addEventListener("click", (e) => {
	if (closest(e.target, "#theme-toggle")) {
		return applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
	}

	const copy = closest(e.target, "[data-copy]");
	if (copy) {
		void navigator.clipboard?.writeText(copy.dataset.copy ?? "");
		// Confirm in place. Without it the only feedback is the clipboard, which
		// is invisible, so the button reads as broken.
		copy.classList.add("copied");
		setTimeout(() => copy.classList.remove("copied"), 1200);
		return;
	}

	const action = closest(e.target, "[data-action]");
	if (!action) return;
	if (action.dataset.action === "back") return void post("/api/details/back");
	if (action.dataset.action === "retry") return void post("/api/details/refresh");
	if (action.dataset.action === "connect") return void post("/api/details/connect");
});

applyTheme(initialTheme());
new EventSource("/api/details/events").addEventListener("state", (e) => {
	render(JSON.parse(/** @type {MessageEvent} */ (e).data));
});
