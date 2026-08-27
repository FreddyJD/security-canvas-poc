/**
 * Screens: components composed into something an analyst works in.
 *
 * The split from components/ is about ownership. A component renders a
 * fragment from arguments; a view owns a whole screen for one state shape and
 * decides which components appear. Views are still pure — the browser calls
 * `render(state)` and swaps in the result.
 *
 * @typedef {import("../domain/types.js").CanvasState} CanvasState
 */
import { agentDetail } from "../components/agent-detail.mjs";
import { agentList } from "../components/agent-list.mjs";
import { empty } from "../components/primitives.mjs";

/**
 * Two-pane triage: the ranked queue beside the selected agent's evidence.
 *
 * Both panes render from one state object, so the highlighted row and the
 * detail can never describe different agents.
 *
 * @param {CanvasState} state
 * @returns {{ queue: string, detail: string }}
 */
export function renderTriageQueue(state) {
	const selected = state.assessments.find((a) => a.agentId === state.selectedId);
	return {
		queue: agentList(state.assessments, state.selectedId),
		detail: state.assessments.length
			? agentDetail(selected)
			: empty("Nothing to triage. Entra reports no agents at risk."),
	};
}
