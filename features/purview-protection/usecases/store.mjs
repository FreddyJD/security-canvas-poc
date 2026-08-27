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
		// Open on the work, not on the form. Every parameter has a working
		// default, so landing on "Configure" would make the operator dismiss a
		// settings pane before seeing what the playbook does.
		panel: "guided",
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
		if (this.state.mode === mode) {
			// Same mode, but possibly a different pane: this is the operator on
			// the Configure tab clicking back to the mode they already had.
			// Without this the tab would be inert and they would be stuck on
			// the form.
			if (this.state.panel !== mode) this.set({ panel: mode });
			return;
		}
		this.set({
			mode,
			// Selecting a mode also shows it. A tool that switched to auto and
			// left the operator staring at the settings form would have changed
			// what the handoff does with nothing on screen to say so.
			panel: mode,
			// No note. The selected segment and the hint above the button both
			// already say which mode is active and what it will do, and the
			// note said it a third time — in a banner at the top of the
			// document, shifting the layout at the far end of the screen from
			// where the operator just clicked.
			note: "",
		});
	}

	/**
	 * Show a pane.
	 *
	 * Selecting "guided" or "auto" also selects that mode, because on this
	 * screen they are the same gesture — the operator clicking "Just run it"
	 * means it. "Configure" is the one tab that changes nothing: it shows the
	 * parameters without disturbing which mode the handoff will use, so the
	 * operator can go and look at the policy name and come back.
	 *
	 * @param {import("../domain/types.js").PlaybookPanel} panel
	 */
	setPanel(panel) {
		if (panel === "guided" || panel === "auto") return this.setMode(panel);
		if (panel !== "configure") return;
		if (this.state.panel === panel) return;
		this.set({ panel });
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
