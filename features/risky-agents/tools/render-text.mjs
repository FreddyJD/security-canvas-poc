/**
 * Text rendering for model consumption.
 *
 * The MCP counterpart to components/: same job, different target. A component
 * renders HTML for an analyst; these render prose for a model. Both are pure
 * and neither computes anything — the verdict arrives already decided by the
 * domain.
 *
 * Kept out of the use cases deliberately: presentation belongs to the surface,
 * and the canvas has no use for these strings.
 *
 * @typedef {import("../domain/types.js").AgentRiskAssessment} AgentRiskAssessment
 * @typedef {import("../domain/types.js").EnrichedDetection} EnrichedDetection
 */

/**
 * The triage queue as a scannable list, most severe first.
 *
 * Factors are truncated to three per agent with a pointer to the deep-dive
 * tool. A full dump of every factor for 25 agents crowds out the analyst's
 * actual question, and the model rarely needs more than the top reasons to
 * decide what to look at next.
 *
 * @param {AgentRiskAssessment[]} assessments
 * @returns {string}
 */
export function renderAgentTable(assessments) {
	const lines = [`${assessments.length} risky agent(s), most severe first:`, ""];
	for (const a of assessments) {
		lines.push(
			`[${a.severity.toUpperCase()}] ${a.displayName} (${a.agentId})`,
			`  score ${a.compositeScore}/100 · entra ${a.entraRiskLevel} · state ${a.riskState}`,
		);
		const top = a.factors.slice(0, 3);
		for (const f of top) lines.push(`  - ${f.summary}`);
		if (a.factors.length > top.length) {
			lines.push(`  - …and ${a.factors.length - top.length} more (use explain_agent_risk)`);
		}
		if (a.isProcessing) lines.push("  ! Entra is still recomputing this agent's risk.");
		lines.push("");
	}
	return lines.join("\n").trimEnd();
}

/**
 * One agent's verdict, evidence, and next steps.
 *
 * Coverage gaps are stated last and explicitly. A model that knows Purview was
 * not consulted will caveat its conclusion; one shown a silent zero will
 * confidently call the agent safe.
 *
 * @param {AgentRiskAssessment} a
 * @param {EnrichedDetection[]} [detections]
 * @returns {string}
 */
export function renderExplanation(a, detections = []) {
	const lines = [
		`${a.displayName} (${a.agentId})`,
		`Severity ${a.severity.toUpperCase()} · composite ${a.compositeScore}/100 · Entra ${a.entraRiskLevel} · state ${a.riskState}`,
		"",
		"Why:",
	];
	for (const f of a.factors) lines.push(`  - [${f.pillar}] ${f.summary}`);
	if (a.factors.length === 0) lines.push("  - No contributing factors found.");

	if (detections.length) {
		lines.push("", "Detections:");
		for (const d of detections) {
			lines.push(`  - ${d.title}${d.detectedDateTime ? ` (${d.detectedDateTime})` : ""} — ${d.impact}`);
		}
	}

	lines.push("", "Recommended actions:");
	for (const r of a.recommendedActions) lines.push(`  - ${r}`);

	const gaps = Object.entries(a.degraded ?? {});
	if (gaps.length) {
		lines.push("", "Coverage gaps (score may understate real risk):");
		for (const [pillar, reason] of gaps) lines.push(`  - ${pillar}: ${reason}`);
	}
	return lines.join("\n");
}

/**
 * @param {{ since: string, count: number, groups: Array<{ riskEventType: string, count: number }> }} activity
 * @param {(t: string) => { title: string, meaning: string }} describe
 * @returns {string}
 */
export function renderActivity(activity, describe) {
	if (!activity.count) return `No agent risk detections since ${activity.since}.`;
	return [
		`${activity.count} detection(s) since ${activity.since}:`,
		...activity.groups.map((g) => {
			const meta = describe(g.riskEventType);
			return `  ${g.count}x ${meta.title} (${g.riskEventType}) — ${meta.meaning}`;
		}),
	].join("\n");
}
