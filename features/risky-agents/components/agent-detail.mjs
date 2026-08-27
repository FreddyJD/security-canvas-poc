/**
 * Detail pane for a single agent: verdict, why it scored, evidence, next steps.
 *
 * Stateless. Actions are declared as `data-action` attributes and wired by the
 * view; this module never calls fetch.
 *
 * @typedef {import("../domain/types.js").AgentRiskAssessment} AgentRiskAssessment
 */
import { SEVERITY_COLOR, card, empty, esc, keyValue, pill } from "./primitives.mjs";

/**
 * @param {AgentRiskAssessment | undefined} agent
 * @returns {string}
 */
export function agentDetail(agent) {
	if (!agent) return empty("Select an agent.");

	const factors = agent.factors.length
		? agent.factors
				.map((f) =>
					card({
						title: f.summary,
						badge: pill(f.pillar),
						evidence: typeof f.evidence?.riskEvidence === "string" ? f.evidence.riskEvidence : "",
					}),
				)
				.join("")
		: `<div class="gap">No contributing factors.</div>`;

	const detections = (agent.detectionDetail ?? [])
		.map((d) =>
			card({
				title: d.title,
				badge: pill(d.riskLevel || "n/a"),
				body: `<div class="m">${esc(d.meaning)}</div><div class="m"><strong>Impact:</strong> ${esc(d.impact)}</div>`,
				evidence: d.riskEvidence ?? "",
			}),
		)
		.join("");

	const gaps = Object.entries(agent.degraded ?? {});

	return `
    <h2>${esc(agent.displayName)}</h2>
    <div class="sub">${esc(agent.agentId)}</div>
    <div class="kv">
      ${keyValue("Composite", `${esc(agent.compositeScore)}/100`)}
      ${keyValue("Severity", `<span style="color:${SEVERITY_COLOR[agent.severity]}">${esc(agent.severity)}</span>`)}
      ${keyValue("Entra risk", esc(agent.entraRiskLevel))}
      ${keyValue("State", esc(agent.riskState))}
      ${keyValue("Type", esc(agent.identityType))}
    </div>
    <div class="actions">
      <button class="primary" data-action="investigate" data-agent-id="${esc(agent.agentId)}">Ask agent to investigate</button>
    </div>
    <h3>Why this scored ${esc(agent.compositeScore)}</h3>${factors}
    ${detections ? `<h3>Detections</h3>${detections}` : ""}
    <h3>Recommended actions</h3>
    <ul>${agent.recommendedActions.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
    ${
			gaps.length
				? `<h3>Coverage gaps</h3>${gaps
						.map(([pillar, reason]) => `<div class="gap"><strong>${esc(pillar)}</strong> — ${esc(reason)}</div>`)
						.join("")}`
				: ""
		}`;
}
