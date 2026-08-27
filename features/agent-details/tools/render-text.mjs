/**
 * Text rendering for model consumption.
 *
 * The MCP counterpart to components/: same job, different target. A component
 * renders HTML for an analyst; these render prose for a model. Both are pure,
 * and neither computes anything — the verdict arrives already decided by the
 * domain.
 *
 * Kept out of the use cases deliberately: presentation belongs to the surface,
 * and the canvas has no use for these strings.
 *
 * @typedef {import("../domain/types.js").AgentDetailsVM} AgentDetailsVM
 */
import { postureBody } from "../components/risk-score.mjs";

/** The label each identity row states, for the prose form. */
const FACT_LABEL = {
	status: "Status",
	owner: "Owner",
	sponsors: "Sponsors",
	agentId: "Agent ID",
	identityType: "Identity type",
	publisher: "Publisher",
	platform: "Platform",
	lastUsed: "Last used",
	authentication: "Authentication",
};

/**
 * One agent's full detail, as a model reads it.
 *
 * Three things are stated explicitly that a naive dump would leave implicit,
 * and each of them changes the conclusion:
 *
 *  1. **An unanswered fact is named as unanswered.** Dropping the row would let
 *     a model report "this agent has no owner" for an agent nobody measured.
 *  2. **A not-evaluated goal is separated from an unmet one.** "Not protected
 *     by Purview DLP" is a finding; saying it about an agent DLP was never
 *     asked about is a fabricated one.
 *  3. **The resource total is the service's, not the length of the list.** A
 *     category can report 40 and carry 3 examples, and reporting 3 would
 *     understate the blast radius.
 *
 * @param {AgentDetailsVM} vm
 * @returns {string}
 */
export function renderAgentDetails(vm) {
	const lines = [
		`${vm.name}${vm.publisher ? ` — ${vm.publisher}` : ""}`,
		`Secure score ${vm.risk.score}/100 (${vm.risk.band})` +
			`${vm.governance ? ` · ${vm.governance.kind}` : ""}` +
			`${vm.verified ? " · verified in Entra" : " · no verified Entra identity"}`,
		"",
		"Details:",
	];

	for (const row of vm.identityRows) {
		const label = FACT_LABEL[row.key] ?? row.key;
		if (!row.known) {
			lines.push(`  ${label}: not available`);
			continue;
		}
		if (row.key === "authentication") {
			lines.push(`  ${label}: Entra required`);
			continue;
		}
		lines.push(`  ${label}: ${row.value ?? row.facepile?.join(", ") ?? ""}`);
	}

	lines.push("", `Posture: ${vm.posture.status === "secure" ? "Agent is secure" : "Review recommended"}`);
	lines.push(`  ${postureBody(vm.posture)}`);

	const unmet = vm.risk.verdicts.filter((v) => v.applies && !v.met);
	if (unmet.length) {
		lines.push("", "Unmet security goals (each would raise the score):");
		for (const verdict of unmet) lines.push(`  - ${verdict.summary}`);
	}

	const na = vm.risk.verdicts.filter((v) => !v.applies);
	if (na.length) {
		lines.push("", "Not evaluated (excluded from the score — NOT the same as unprotected):");
		for (const verdict of na) lines.push(`  - ${verdict.summary}`);
	}

	lines.push("", "Access:");
	if (!vm.access.hasProfile) {
		lines.push("  No dependency graph is available for this agent, so its access could not be listed.");
	} else {
		lines.push(
			`  Permissions: ${vm.access.permissions.length}` +
				(vm.access.permissions.length === 0
					? " (no delegated grants were collected for this agent's identity plane)"
					: ` — ${vm.access.permissions.join(", ")}`),
		);
		lines.push(`  Resources: ${vm.access.resourceTotal}`);
		for (const resource of vm.access.resources.slice(0, 20)) {
			lines.push(`    - ${resource.name}${resource.severity ? ` (severity ${resource.severity})` : ""}`);
		}
		if (vm.access.resources.length > 20) {
			lines.push(`    …and ${vm.access.resources.length - 20} more`);
		}
	}

	return lines.join("\n");
}
