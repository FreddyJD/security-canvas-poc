/**
 * Playbook run state.
 *
 * Progress is the reason a playbook belongs on a canvas: it survives across
 * turns, so an operator can run step 3, come back after a coffee, and see where
 * they were. A markdown answer in chat cannot do that.
 *
 * @typedef {import("../domain/types.js").PlaybookState} PlaybookState
 * @typedef {(state: PlaybookState) => void} Subscriber
 */
import { DEFAULT_PLAYBOOK_ID, resolvePlaybook } from "../domain/protect-agents-playbook.mjs";

/**
 * @param {string} playbookId
 * @returns {PlaybookState}
 */
function initialState(playbookId) {
	const playbook = resolvePlaybook(playbookId);
	/** @type {Record<string, string>} */
	const params = {};
	for (const p of playbook.params) params[p.id] = p.default;

	return {
		status: "ready",
		note: "",
		playbookId: playbook.id,
		params,
		// The first step opens by default: a fully collapsed list gives the
		// reader nothing to start from and hides that there is a script at all.
		progress: { claimedDone: [], openStepId: playbook.buildSteps(params)[0]?.id ?? null },
		coverage: null,
	};
}

export class PlaybookStore {
	/** @param {Partial<PlaybookState>} [seed] */
	constructor(seed) {
		/** @type {PlaybookState} */
		this.state = { ...initialState(seed?.playbookId ?? DEFAULT_PLAYBOOK_ID), ...seed };
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

	/** @param {Partial<PlaybookState>} patch */
	set(patch) {
		this.state = { ...this.state, ...patch };
		this.#notify();
	}

	/**
	 * Set parameters and reset progress.
	 *
	 * Resetting is deliberate. The steps are generated from the parameters, so
	 * changing the policy name rewrites every script — leaving "step 4 done"
	 * ticked would claim the operator ran a command that no longer exists.
	 *
	 * @param {Record<string, string>} params
	 */
	setParams(params) {
		const merged = { ...this.state.params, ...params };
		const changed = Object.keys(params).some((k) => this.state.params[k] !== params[k]);
		if (!changed) return;

		const steps = resolvePlaybook(this.state.playbookId).buildSteps(merged);
		this.set({
			params: merged,
			progress: { claimedDone: [], openStepId: steps[0]?.id ?? null },
			note: "Parameters changed, so the scripts were rebuilt and progress was cleared.",
		});
	}

	/** @param {string} stepId */
	toggleDone(stepId) {
		const done = this.state.progress.claimedDone;
		const claimedDone = done.includes(stepId) ? done.filter((id) => id !== stepId) : [...done, stepId];
		this.set({ progress: { ...this.state.progress, claimedDone } });
	}

	/**
	 * Open a step, or collapse it if it is already open.
	 * @param {string} stepId
	 */
	openStep(stepId) {
		const openStepId = this.state.progress.openStepId === stepId ? null : stepId;
		this.set({ progress: { ...this.state.progress, openStepId } });
	}

	/** @returns {PlaybookState} */
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
