/**
 * Observable state for the agent-details screen.
 *
 * Same contract as the other two stores: one authoritative object on the Node
 * side, broadcast to every connected browser on change, mutated only through
 * `set`.
 *
 * Invariant: state must stay JSON-serializable. It is stringified on every
 * broadcast, so a Map, a Date, or a class instance here becomes silent data
 * loss in the browser.
 *
 * @typedef {import("../domain/types.js").DetailsState} DetailsState
 * @typedef {(state: DetailsState) => void} Subscriber
 */

/** @returns {DetailsState} */
function initialState() {
	return {
		// `idle`, not `loading`: this panel has no agent until one is chosen, and
		// opening it to a spinner that will never resolve would promise an
		// arrival that is not coming.
		status: "idle",
		note: "",
		hint: "",
		agentId: null,
		vm: null,
		graphLoading: false,
		lastRefresh: null,
	};
}

export class DetailsStore {
	/** @param {Partial<DetailsState>} [seed] */
	constructor(seed) {
		/** @type {DetailsState} */
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
	 * @param {Partial<DetailsState>} patch
	 */
	set(patch) {
		this.state = { ...this.state, ...patch };
		this.#notify();
	}

	/**
	 * Point the panel at a different agent.
	 *
	 * Clears the view model rather than leaving the previous agent's on screen
	 * while the new one loads. Keeping it would show one agent's name above
	 * another's score for as long as the fetch takes, which is the single worst
	 * thing a security detail page can do.
	 *
	 * @param {string} agentId
	 */
	focus(agentId) {
		this.set({ status: "loading", agentId, vm: null, graphLoading: true, note: "", hint: "" });
	}

	/** @returns {DetailsState} */
	get() {
		return this.state;
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
