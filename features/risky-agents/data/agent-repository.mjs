/**
 * Repository for risky agents: fetch, then hand back domain assessments.
 *
 * This is the only layer that knows Graph exists. Use cases above it receive
 * scored `AgentRiskAssessment` objects and never see an OData filter; the
 * client below it knows nothing about scoring. Swapping in a different data
 * source (an agent inventory, a cached snapshot, a test fixture) means
 * implementing this interface and changing nothing else.
 *
 * Both hosts share it, which is what guarantees the canvas queue and the MCP
 * tools return the same agents in the same order.
 *
 * @typedef {import("../domain/types.js").AgentRiskAssessment} AgentRiskAssessment
 * @typedef {import("../domain/types.js").CodeExposure} CodeExposure
 * @typedef {import("../domain/types.js").DataExposure} DataExposure
 * @typedef {import("../domain/types.js").Pillar} Pillar
 * @typedef {import("../domain/types.js").AgentSource} AgentSource
 * @typedef {import("../domain/types.js").RiskStateAction} RiskStateAction
 */
import { GraphClient } from "../../../platform/graph.mjs";
import { assessAgent, compareBySeverity, enrichDetections, normalizeDetection } from "../domain/scoring.mjs";

/**
 * Pillars that are not wired to a live source yet.
 *
 * Reported as explicit gaps rather than silently scored as zero. A model told
 * "no Purview data" will caveat its answer; a model shown a 0 will confidently
 * call the agent safe. That difference matters in security.
 *
 * @type {Partial<Record<Pillar, string>>}
 */
export const UNWIRED_PILLARS = {
	purview: "Purview exposure not collected; data risk not evaluated.",
	github: "GitHub exposure not collected; code risk not evaluated.",
	defender: "Defender not wired; use the Sentinel MCP server for incidents.",
};

/** @implements {AgentSource} */
export class AgentRepository {
	/** @param {GraphClient} [graph] */
	constructor(graph) {
		this.graph = graph ?? new GraphClient();
	}

	/**
	 * The triage queue: every risky agent, scored and ordered.
	 *
	 * Detections are fetched in one tenant-wide call and grouped locally rather
	 * than per agent. An N+1 fetch is slow on a large tenant and invites
	 * throttling, and the whole set is needed anyway to score the queue.
	 *
	 * @param {object} [opts]
	 * @param {string[]} [opts.riskLevels]
	 * @param {string[]} [opts.riskStates]
	 * @param {number} [opts.limit]
	 * @param {boolean} [opts.includeDetections] Attach per-detection detail to each assessment.
	 * @returns {Promise<AgentRiskAssessment[]>}
	 */
	async listAssessments(opts = {}) {
		const agents = await this.graph.listRiskyAgents({
			riskLevels: opts.riskLevels ?? ["high", "medium", "low"],
			riskStates: opts.riskStates ?? ["atRisk", "confirmedCompromised"],
			top: opts.limit ?? 25,
		});
		if (agents.length === 0) return [];

		const byAgent = await this.#detectionsByAgent(opts.limit ?? 25);

		return agents
			.map((agent) => {
				const detections = byAgent.get(agent.id) ?? [];
				const assessment = assessAgent({ agent, detections, degraded: UNWIRED_PILLARS });
				if (opts.includeDetections) assessment.detectionDetail = enrichDetections(detections);
				return assessment;
			})
			.sort(compareBySeverity);
	}

	/**
	 * One agent, with its full detection history enriched for display.
	 *
	 * @param {string} agentId
	 * @param {object} [opts]
	 * @param {number} [opts.detectionLimit]
	 * @param {DataExposure} [opts.dataExposure]
	 * @param {CodeExposure} [opts.codeExposure]
	 * @returns {Promise<AgentRiskAssessment>}
	 */
	async getAssessment(agentId, opts = {}) {
		const [agent, detections] = await Promise.all([
			this.graph.getRiskyAgent(agentId),
			this.graph.listDetectionsForAgent(agentId, opts.detectionLimit ?? 25).catch(() => []),
		]);

		// Only report a pillar as degraded when the caller did not supply it.
		const degraded = { ...UNWIRED_PILLARS };
		if (opts.dataExposure) delete degraded.purview;
		if (opts.codeExposure) delete degraded.github;

		const assessment = assessAgent({
			agent,
			detections,
			dataExposure: opts.dataExposure,
			codeExposure: opts.codeExposure,
			degraded,
		});
		assessment.detectionDetail = enrichDetections(detections);
		return assessment;
	}

	/**
	 * Tenant-wide detections in a recent window, normalized.
	 *
	 * @param {string} sinceIso
	 * @param {number} [limit]
	 */
	async listRecentDetections(sinceIso, limit = 50) {
		const raw = await this.graph.listRecentDetections(sinceIso, limit);
		return raw.map(normalizeDetection);
	}

	/**
	 * Apply a risk-state transition. Gated at the tool layer, never implicit.
	 *
	 * @param {string[]} agentIds
	 * @param {RiskStateAction} action
	 */
	async updateRiskState(agentIds, action) {
		if (action === "dismiss") return this.graph.dismissAgentRisk(agentIds);
		if (action === "confirmCompromised") return this.graph.confirmAgentCompromised(agentIds);
		return this.graph.confirmAgentSafe(agentIds);
	}

	/**
	 * Detections grouped by agent id.
	 * Failure is tolerated: agents still score on their standing risk level,
	 * which is better than showing the analyst an empty queue.
	 *
	 * @param {number} limit
	 * @returns {Promise<Map<string, import("../domain/types.js").AgentRiskDetection[]>>}
	 */
	async #detectionsByAgent(limit) {
		/** @type {Map<string, import("../domain/types.js").AgentRiskDetection[]>} */
		const byAgent = new Map();
		try {
			const all = await this.graph.listAllDetections(Math.max(200, limit));
			for (const d of all) {
				const key = d.identityId || d.agentId;
				if (!key) continue;
				const list = byAgent.get(key);
				if (list) list.push(d);
				else byAgent.set(key, [d]);
			}
		} catch {
			/* detections are optional; agents still score on standing risk */
		}
		return byAgent;
	}
}
