/**
 * Observable state container for the canvas.
 *
 * The canvas is a server-rendered page fed by SSE, so "state management" here
 * is not React state — it is one authoritative object on the Node side that is
 * broadcast to every connected browser on change. Keeping it in a store rather
 * than as module-level `let`s buys two things: the use cases become pure
 * functions of (store, repository) and are testable without HTTP, and every
 * mutation funnels through one place that knows to notify subscribers.
 *
 * Invariant: state must stay JSON-serializable. It is stringified on every
 * broadcast, so a Map, a Date, or a class instance here becomes silent data
 * loss in the browser.
 *
 * @typedef {import("../domain/types.js").CanvasState} CanvasState
 * @typedef {import("../domain/types.js").Route} Route
 * @typedef {(state: CanvasState) => void} Subscriber
 */

/** @returns {CanvasState} */
function initialState() {
	return {
		status: "loading",
		note: "",
		hint: "",
		route: { view: "triage-queue", params: {} },
		assessments: [],
		selectedId: null,
		lastRefresh: null,
	};
}

export class CanvasStore {
	/** @param {Partial<CanvasState>} [seed] */
	constructor(seed) {
		/** @type {CanvasState} */
		this.state = { ...initialState(), ...seed };
		/** @type {Set<Subscriber>} */
		this.subscribers = new Set();
	}

	/**
	 * Subscribe to changes. Returns an unsubscribe function.
	 * @param {Subscriber} fn
	 * @returns {() => void}
	 */
	subscribe(fn) {
		this.subscribers.add(fn);
		return () => this.subscribers.delete(fn);
	}

	/**
	 * Merge a patch and notify. The only way state changes.
	 * @param {Partial<CanvasState>} patch
	 */
	set(patch) {
		this.state = { ...this.state, ...patch };
		this.#notify();
	}

	/**
	 * Navigate. Selection is derived from the route rather than tracked
	 * separately, so the detail pane and the URL-ish route can never disagree
	 * about which agent is open.
	 *
	 * @param {string} view
	 * @param {Record<string, unknown>} [params]
	 */
	navigate(view, params = {}) {
		const patch = /** @type {Partial<CanvasState>} */ ({ route: { view, params } });
		if (typeof params.agentId === "string") patch.selectedId = params.agentId;
		this.set(patch);
	}

	/** @returns {CanvasState} */
	get() {
		return this.state;
	}

	/**
	 * The currently focused assessment, if any.
	 * @returns {import("../domain/types.js").AgentRiskAssessment | undefined}
	 */
	selected() {
		return this.state.assessments.find((a) => a.agentId === this.state.selectedId);
	}

	#notify() {
		for (const fn of this.subscribers) {
			try {
				fn(this.state);
			} catch {
				// A broken subscriber (usually a dead SSE socket) must not stop
				// the others from receiving the update.
			}
		}
	}
}
