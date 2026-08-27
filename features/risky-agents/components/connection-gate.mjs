/**
 * The pre-connection screen: loading, sign-in, and error states.
 *
 * Every non-connected status resolves to one of these. Splitting it out of the
 * queue view keeps the happy path readable and means an added status is a
 * change in one file.
 *
 * @typedef {import("../domain/types.js").CanvasState} CanvasState
 */
import { esc } from "./primitives.mjs";

const SHIELD = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 3l7 3v6c0 4.4-3 8.3-7 9-4-0.7-7-4.6-7-9V6l7-3z"/></svg>`;

/**
 * @param {CanvasState} state
 * @returns {string}
 */
export function connectionGate(state) {
	if (state.status === "loading") {
		return `${SHIELD}<h2>Loading</h2><p><span class="spin"></span>Checking your session…</p>`;
	}

	if (state.status === "signing-in") {
		return `${SHIELD}
      <h2>Signing in</h2>
      <p><span class="spin"></span>Complete sign-in in your browser.</p>
      <p class="hint">The queue loads automatically when you finish.</p>`;
	}

	if (state.status === "error") {
		return `${SHIELD}
      <h2 class="err">Could not load agents</h2>
      <p class="err">${esc(state.note)}</p>
      ${state.hint ? `<p class="hint">${esc(state.hint)}</p>` : ""}
      <button class="primary" data-action="connect">Try again</button>`;
	}

	if (state.status === "needs-config") {
		return `${SHIELD}
      <h2>Not configured</h2>
      <p>No Entra app registration is set for this canvas.</p>
      <p class="hint">Set <code>SECURITY_CANVAS_CLIENT_ID</code> or write a client id to
      <code>~/.copilot/security-canvas/config.json</code>.</p>`;
	}

	// needs-auth
	return `${SHIELD}
    <h2>Security Canvas</h2>
    <p>Triage risky agent identities from Microsoft Entra ID Protection.</p>
    <button class="primary" data-action="connect">Sign in with Microsoft</button>`;
}
