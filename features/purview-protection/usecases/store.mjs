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
		// Guided by default. Auto mode runs tenant-changing commands without a
		// human between them, so it is something you turn on, never something
		// you find already on.
		mode: "guided",
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

	/**
	 * Switch execution mode.
	 *
	 * Progress survives the switch, unlike a parameter change. The steps are
	 * unchanged — only who runs them differs — so a ticked step still refers to
	 * a command that still exists, and an operator who ran three steps by hand
	 * before deciding to hand the rest over has not lied about anything.
	 *
	 * @param {import("../domain/types.js").ExecutionMode} mode
	 */
	setMode(mode) {
		if (mode !== "guided" && mode !== "auto") return;
		if (this.state.mode === mode) return;
		this.set({
			mode,
			note:
				mode === "auto"
					? "Auto mode: Copilot runs the whole script in a terminal. You still sign in yourself when the browser prompt opens."
					: "Guided mode: you run each command yourself, one step at a time.",
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
