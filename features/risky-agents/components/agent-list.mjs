/**
 * The triage queue list — one row per agent, most severe first.
 *
 * Stateless: it renders whatever it is handed and reports clicks through a
 * `data-agent-id` attribute. It does not fetch, does not sort (the domain
 * already did), and does not know a store exists.
 *
 * @typedef {import("../domain/types.js").AgentRiskAssessment} AgentRiskAssessment
 */
import { empty, esc, plural, scoreBar, severityBadge } from "./primitives.mjs";

/**
 * @param {AgentRiskAssessment} agent
 * @param {boolean} isSelected
 * @returns {string}
 */
export function agentRow(agent, isSelected) {
	return `<div class="row ${isSelected ? "sel" : ""}" data-agent-id="${esc(agent.agentId)}" role="option" aria-selected="${isSelected}" tabindex="0">
    <div class="row-top">
      ${severityBadge(agent.severity)}
      <span class="nm">${esc(agent.displayName)}</span>
      <span class="score">${esc(agent.compositeScore)}</span>
    </div>
    <div class="meta">Entra ${esc(agent.entraRiskLevel)} · ${esc(plural(agent.factors.length, "factor"))}${
			agent.isProcessing ? " · recomputing" : ""
		}</div>
    ${scoreBar(agent.compositeScore, agent.severity)}
  </div>`;
}

/**
 * @param {AgentRiskAssessment[]} agents
 * @param {string | null} selectedId
 * @returns {string}
 */
export function agentList(agents, selectedId) {
	if (!agents.length) return empty("No agents match the risk filters.");
	return `<div role="listbox" aria-label="Risky agents">${agents
		.map((a) => agentRow(a, a.agentId === selectedId))
		.join("")}</div>`;
}
