/**
 * Use cases — the layer between the data and every surface that shows it.
 *
 * This is the "middle layer" that usually rots. The rule that keeps it honest:
 * a use case may touch the repository and the store, and it must return plain
 * data. It never renders HTML, never builds an MCP content envelope, never
 * touches `req`/`res`. Anything host-shaped belongs in tools/ or components/.
 *
 * This feature no longer owns a canvas: "show me the risky agents" is answered
 * by the Agents table filtered to the risky bands, because an inventory row's
 * `riskLevel` *is* Entra ID Protection risk — the service joins riskyAgents,
 * riskyUsers and riskyServicePrincipals server-side at collect time. What
 * survives here is the part the inventory row genuinely does not carry: the
 * detection history and the scored explanation behind that level, reached
 * through the MCP tools.
 *
 * There is deliberately no store any more. These use cases take a repository
 * and return plain data, which is all a stateless MCP tool call needs.
 *
 * @typedef {import("../domain/types.js").AgentSource} AgentSource
 * @typedef {import("../domain/types.js").RiskStateAction} RiskStateAction
 * @typedef {import("../domain/types.js").AgentRiskAssessment} AgentRiskAssessment
 *
 * The repository is typed as the `AgentSource` port, not as the class that
 * implements it. Depending on the interface is what keeps this layer free of
 * Graph and makes it testable with a four-method stub.
 * @typedef {{ repository: AgentSource }} TriageContext
 */
import { GraphError } from "../../../platform/graph.mjs";

/**
 * The tenant's risky agents, most severe first.
 *
 * @param {TriageContext} ctx
 * @param {{ riskLevels?: string[], riskStates?: string[], limit?: number, includeDetections?: boolean }} [opts]
 * @returns {Promise<AgentRiskAssessment[]>}
 */
export async function listRiskyAgents({ repository }, opts = {}) {
	return repository.listAssessments({
		riskLevels: opts.riskLevels ?? ["high", "medium"],
		riskStates: opts.riskStates ?? ["atRisk", "confirmedCompromised"],
		includeDetections: opts.includeDetections ?? false,
		limit: opts.limit ?? 25,
	});
}

/**
 * Full detail for one agent.
 *
 * @param {TriageContext} ctx
 * @param {string} agentId
 * @param {{ detectionLimit?: number, dataExposure?: import("../domain/types.js").DataExposure, codeExposure?: import("../domain/types.js").CodeExposure }} [opts]
 * @returns {Promise<AgentRiskAssessment>}
 */
export async function explainAgent({ repository }, agentId, opts = {}) {
	return repository.getAssessment(agentId, opts);
}

/**
 * Recent tenant-wide detections, grouped by type.
 *
 * Grouping happens here rather than in the tool so the rollup is computed in
 * one place, testable without an MCP envelope.
 *
 * @param {TriageContext} ctx
 * @param {{ hours?: number, limit?: number }} [opts]
 */
export async function recentActivity({ repository }, opts = {}) {
	const since = new Date(Date.now() - (opts.hours ?? 24) * 3_600_000).toISOString();
	const detections = await repository.listRecentDetections(since, opts.limit ?? 50);

	/** @type {Map<string, number>} */
	const byType = new Map();
	for (const d of detections) {
		const key = d.riskEventType ?? "unknown";
		byType.set(key, (byType.get(key) ?? 0) + 1);
	}

	const groups = [...byType.entries()].sort((a, b) => b[1] - a[1]).map(([riskEventType, count]) => ({
		riskEventType,
		count,
	}));

	return { since, count: detections.length, groups, detections };
}

/**
 * Apply a risk-state transition.
 *
 * The caller is responsible for the confirmation gate — see tools/mcp-tools.mjs.
 * This function assumes approval has already been obtained.
 *
 * @param {TriageContext} ctx
 * @param {string[]} agentIds
 * @param {RiskStateAction} action
 */
export async function updateRiskState({ repository }, agentIds, action) {
	await repository.updateRiskState(agentIds, action);
	return { action, agentIds, applied: true };
}

/**
 * Whether a thrown error means the caller should sign in again.
 *
 * Kept because a 401 is actionable — the tool layer turns this into "sign in
 * again" rather than dumping a stack trace at an analyst who can fix it.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function isAuthFailure(err) {
	return err instanceof GraphError && err.status === 401;
}
