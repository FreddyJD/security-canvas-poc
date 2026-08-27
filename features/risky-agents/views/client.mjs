/**
 * Browser entry point.
 *
 * Runs in the canvas webview, not in Node. Its only jobs are to subscribe to
 * state, hand it to the view registry, and translate clicks into POSTs. All
 * rendering logic lives in components/ and views/, which this file imports as
 * real ES modules — the same modules the Node tests import, so what is tested
 * is what ships.
 *
 * Deliberately no framework: the panel is one page with one state object
 * arriving over SSE. A framework would add a build step to a project whose
 * defining constraint is that it must run from a plain file copy.
 *
 * @typedef {import("../domain/types.js").CanvasState} CanvasState
 */
import { connectionGate } from "../components/connection-gate.mjs";
import { renderRoute } from "./registry.mjs";

/**
 * Elements declared in the shell. Resolved once — they are static, so
 * re-querying on every frame would be wasted work, and a missing id is a bug
 * in the shell rather than a runtime condition to handle.
 *
 * @param {string} id
 * @returns {HTMLElement}
 */
function el(id) {
	const node = document.getElementById(id);
	if (!node) throw new Error(`Canvas shell is missing #${id}`);
	return node;
}

const ui = {
	gate: el("gate"),
	cols: el("cols"),
	note: el("note"),
	count: el("count"),
	refresh: el("refresh"),
	queue: el("queue"),
	detail: el("detail"),
};

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

/** @param {CanvasState} state */
function render(state) {
	const connected = state.status === "connected";

	ui.gate.style.display = connected ? "none" : "";
	ui.cols.style.display = connected ? "" : "none";
	ui.refresh.style.display = connected ? "" : "none";
	ui.count.style.display = connected ? "" : "none";
	ui.note.style.display = connected && state.note ? "" : "none";
	ui.note.textContent = state.note || "";

	if (!connected) {
		ui.gate.innerHTML = connectionGate(state);
		return;
	}

	ui.count.textContent = `${state.assessments.length} at risk`;
	ui.count.className = "badge live";

	const { queue, detail } = renderRoute(state);
	ui.queue.innerHTML = queue;
	ui.detail.innerHTML = detail;
}

/**
 * Nearest ancestor matching a selector, or null.
 * @param {EventTarget | null} target
 * @param {string} selector
 * @returns {HTMLElement | null}
 */
function closest(target, selector) {
	return target instanceof Element ? /** @type {HTMLElement | null} */ (target.closest(selector)) : null;
}

/**
 * One delegated listener for the whole panel.
 *
 * Every re-render replaces innerHTML, so listeners bound to individual buttons
 * would die on the next state update. Delegating from the document means
 * markup can change freely and interaction keeps working — and components stay
 * pure strings with no wiring of their own.
 */
document.addEventListener("click", (e) => {
	const actionEl = closest(e.target, "[data-action]");
	if (actionEl) {
		const { action, agentId } = actionEl.dataset;
		if (action === "connect") return void post("/api/connect");
		if (action === "refresh") return void post("/api/refresh");
		if (action === "investigate") return void post("/api/investigate", { agentId });
		return;
	}

	const row = closest(e.target, "[data-agent-id]");
	if (row) post("/api/select", { agentId: row.dataset.agentId });
});

// Keyboard parity for the queue: rows are listbox options, so they must be
// operable without a pointer.
document.addEventListener("keydown", (e) => {
	if (e.key !== "Enter" && e.key !== " ") return;
	const row = closest(e.target, "[data-agent-id]");
	if (!row || row.hasAttribute("data-action")) return;
	e.preventDefault();
	post("/api/select", { agentId: row.dataset.agentId });
});

new EventSource("/api/events").addEventListener("state", (e) => {
	render(JSON.parse(/** @type {MessageEvent} */ (e).data));
});
