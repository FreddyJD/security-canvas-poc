/**
 * View registry — the routing table for the canvas.
 *
 * Why a registry rather than generic render primitives: a canvas has to earn
 * its existence against a markdown table in chat. Letting a model compose
 * arbitrary tables from primitives yields a worse markdown table that costs
 * more tokens, and gives the analyst a different layout on every query. Naming
 * the small set of screens instead means the canvas owns sorting, empty
 * states, keyboard nav and hover once, and the model only picks *which* screen
 * — never how it looks.
 *
 * Adding a screen is: write a view, register it here, expose a matching
 * `show_<view>` canvas action in tools/canvas-actions.mjs. If a request does
 * not fit an existing view, that is a signal to add one, not to make the model
 * invent a layout.
 *
 * @typedef {import("../domain/types.js").CanvasState} CanvasState
 * @typedef {(state: CanvasState) => { queue: string, detail: string }} ViewRenderer
 */
import { renderTriageQueue } from "./triage-queue.mjs";

/**
 * @typedef {{ title: string, render: ViewRenderer }} View
 * @satisfies {Record<string, View>}
 */
export const VIEWS = {
	"triage-queue": {
		title: "Triage queue",
		render: renderTriageQueue,
	},
	// The detail pane is driven by `selectedId`, so focusing one agent is the
	// same screen with a different selection rather than a separate layout.
	// Registering it by name keeps routing explicit and leaves room for a
	// dedicated single-agent screen later without changing any caller.
	"agent-detail": {
		title: "Agent detail",
		render: renderTriageQueue,
	},
};

export const DEFAULT_VIEW = "triage-queue";

/**
 * Resolve a route to a renderer, falling back rather than throwing.
 * A canvas that renders nothing because of a bad route name is worse than one
 * that shows the queue.
 *
 * @param {string} view
 */
export function resolveView(view) {
	return /** @type {Record<string, View>} */ (VIEWS)[view] ?? VIEWS[DEFAULT_VIEW];
}

/**
 * @param {CanvasState} state
 * @returns {{ queue: string, detail: string }}
 */
export function renderRoute(state) {
	return resolveView(state.route?.view ?? DEFAULT_VIEW).render(state);
}
