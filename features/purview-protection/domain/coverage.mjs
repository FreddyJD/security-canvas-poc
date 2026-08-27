/**
 * DLP coverage over the agent estate.
 *
 * Pure: it reads inventory rows and reports what they say. It never infers.
 *
 * @typedef {import("../../agent-inventory/domain/types.js").InventoryAgent} InventoryAgent
 * @typedef {import("./types.js").DlpCoverage} DlpCoverage
 */

/** How many uncovered agents to name. Enough to be concrete, few enough to scan. */
const EXAMPLE_LIMIT = 5;

/**
 * Split the estate by DLP protection state.
 *
 * Three buckets, not two, and that is the point. `protection.dlp` is tri-state:
 * `null` means the control was never evaluated, which is a different claim from
 * `false` ("evaluated, and not protected"). Folding null into uncovered would
 * inflate the problem and send an operator to write a policy for agents nobody
 * measured; folding it into covered would hide real exposure. So it is reported
 * as its own number and the UI says what it means.
 *
 * @param {readonly InventoryAgent[]} agents
 * @returns {DlpCoverage}
 */
export function dlpCoverage(agents) {
	let covered = 0;
	let uncovered = 0;
	let notEvaluated = 0;
	/** @type {DlpCoverage["examples"]} */
	const examples = [];

	for (const agent of agents) {
		const state = agent.protection?.dlp ?? null;
		if (state === true) {
			covered += 1;
		} else if (state === false) {
			uncovered += 1;
			if (examples.length < EXAMPLE_LIMIT) {
				examples.push({ agentId: agent.agentId, title: agent.title, platform: agent.platform });
			}
		} else {
			notEvaluated += 1;
		}
	}

	return { covered, uncovered, notEvaluated, total: agents.length, examples };
}

/**
 * A one-line reading of the coverage, in the terms an operator would use.
 *
 * Leads with whichever number is the actionable one: agents known to be
 * uncovered are a problem to fix, whereas an estate that is entirely
 * unevaluated is a measurement gap and needs different words. Saying "0 agents
 * uncovered" for a tenant nobody has assessed would be true and completely
 * misleading.
 *
 * @param {DlpCoverage | null} coverage
 * @returns {string}
 */
export function coverageSummary(coverage) {
	if (!coverage || coverage.total === 0) {
		return "No agent inventory loaded yet, so DLP coverage is unknown.";
	}

	const { covered, uncovered, notEvaluated, total } = coverage;

	if (uncovered > 0) {
		return `${uncovered} of ${total} agents are not covered by a DLP policy.`;
	}
	if (covered === 0 && notEvaluated === total) {
		return `DLP coverage has not been evaluated for any of the ${total} agents. That is not the same as being uncovered — it means nothing has measured them.`;
	}
	if (notEvaluated > 0) {
		return `${covered} of ${total} agents are covered by a DLP policy; coverage was never evaluated for the other ${notEvaluated}.`;
	}
	return `All ${total} agents are covered by a DLP policy.`;
}

/**
 * Whether the playbook is worth recommending.
 *
 * True for an unevaluated estate as well as an uncovered one: both mean there
 * is no evidence agents are protected, which is the question the playbook
 * answers. Only a fully-covered estate makes it unnecessary.
 *
 * @param {DlpCoverage | null} coverage
 * @returns {boolean}
 */
export function shouldRecommendPlaybook(coverage) {
	if (!coverage || coverage.total === 0) return true;
	return coverage.covered < coverage.total;
}
