/**
 * Observable state for the inventory screen.
 *
 * Same contract as the risky-agents store: one authoritative object on the Node
 * side, broadcast over SSE, mutated only through `set`. Must stay
 * JSON-serializable.
 *
 * @typedef {import("../domain/types.js").InventoryState} InventoryState
 * @typedef {(state: InventoryState) => void} Subscriber
 */

/** @returns {InventoryState} */
function initialState() {
	return {
		status: "loading",
		note: "",
		hint: "",
		agents: [],
		summary: null,
		filters: { search: "", platforms: [], risks: [], slice: "all" },
		sort: { column: "name", descending: false },
		page: 0,
		// 50 rows: enough that scrolling is the primary interaction, few enough
		// that the DOM stays small without virtualization.
		pageSize: 50,
		lastRefresh: null,
	};
}

export class InventoryStore {
	/** @param {Partial<InventoryState>} [seed] */
	constructor(seed) {
		/** @type {InventoryState} */
		this.state = { ...initialState(), ...seed };
		/** @type {Set<Subscriber>} */
		this.subscribers = new Set();
	}

	/**
	 * @param {Subscriber} fn
	 * @returns {() => void}
	 */
	subscribe(fn) {
		this.subscribers.add(fn);
		return () => this.subscribers.delete(fn);
	}

	/** @param {Partial<InventoryState>} patch */
	set(patch) {
		this.state = { ...this.state, ...patch };
		this.#notify();
	}

	/**
	 * Merge a filter change and return to the first page.
	 *
	 * Resetting the page is the point: narrowing while on page 6 of 16 can leave
	 * the reader past the end of the new result, staring at an empty table that
	 * looks like the filter matched nothing.
	 *
	 * @param {Partial<import("../domain/types.js").InventoryFilters>} patch
	 */
	setFilters(patch) {
		this.set({ filters: { ...this.state.filters, ...patch }, page: 0 });
	}

	/**
	 * Sort by a column, toggling direction when it is already active.
	 * @param {string} column
	 */
	toggleSort(column) {
		const { sort } = this.state;
		const descending = sort.column === column ? !sort.descending : false;
		this.set({ sort: { column, descending }, page: 0 });
	}

	/** @returns {InventoryState} */
	get() {
		return this.state;
	}

	#notify() {
		for (const fn of this.subscribers) {
			try {
				fn(this.state);
			} catch {
				// A dead SSE socket must not stop the others from updating.
			}
		}
	}
}
