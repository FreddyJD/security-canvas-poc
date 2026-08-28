/**
 * Distils the agent-details view model from real sources.
 *
 * Ported from the Security-UX `agentDetailsAdapter.ts`. The distillation rules
 * are preserved; what changed is the **input**. That page reads AgentSentry's
 * enriched inventory item plus a four-provider merged dependency graph. Neither
 * exists in this repo, so this reads what ADR-077 actually serves: the catalog
 * row, the per-agent detail document, and the exposure rollup.
 *
 * Pure and framework-free, so it tests on its inputs alone. **Nothing is
 * fabricated**: every field is a real value or is omitted when its source is
 * absent. That rule is the whole reason a security page can be trusted, and it
 * is why the identity list carries a `known: false` row rather than dropping
 * the fact, and why the posture panel distinguishes `false` from absent.
 *
 * @typedef {import("./types.js").Access} Access
 * @typedef {import("./types.js").AccessResource} AccessResource
 * @typedef {import("./types.js").AgentDetail} AgentDetail
 * @typedef {import("./types.js").AgentDetailsVM} AgentDetailsVM
 * @typedef {import("./types.js").AgentExposure} AgentExposure
 * @typedef {import("./types.js").Governance} Governance
 * @typedef {import("./types.js").GraphEdge} GraphEdge
 * @typedef {import("./types.js").GraphNode} GraphNode
 * @typedef {import("./types.js").IdentityKey} IdentityKey
 * @typedef {import("./types.js").IdentityRender} IdentityRender
 * @typedef {import("./types.js").IdentityRow} IdentityRow
 * @typedef {import("./types.js").InventoryAgent} InventoryAgent
 * @typedef {import("./types.js").Posture} Posture
 * @typedef {import("./types.js").RelationshipGraph} RelationshipGraph
 * @typedef {import("./types.js").Tone} Tone
 */
import { lastUsedLabel } from "../../agent-inventory/domain/presentation.mjs";
import { factsFromRow, secureScore } from "./secure-score.mjs";

/**
 * The first source that actually answered, ignoring blank ones.
 *
 * `??` alone is not enough: a source that sends `""` or `"   "` for an unknown
 * value would win over a later source that knows the real one, and the row
 * would render as an empty cell — the one outcome the "not available" mark
 * exists to prevent, because a blank could equally be a missing value or a
 * layout bug.
 *
 * @param {...(string | null | undefined)} values
 * @returns {string | undefined}
 */
export function firstAnswer(...values) {
	return values.find((value) => (value ?? "").trim() !== "") ?? undefined;
}

/**
 * One identity row, known when its source answered with a non-blank value.
 *
 * `extra` is spread BEFORE the derived fields, so a caller cannot override
 * known-ness or the value with a decoration. The status row is the live case: a
 * caller that could set `known` alongside `status` would be one edit away from
 * putting a green check beside a hyphen.
 *
 * @param {IdentityKey} key
 * @param {IdentityRender} render
 * @param {string | null | undefined} value
 * @param {{ status?: Tone }} [extra]
 * @returns {IdentityRow}
 */
export function fact(key, render, value, extra = {}) {
	const answer = firstAnswer(value);
	return {
		...extra,
		key,
		render,
		known: answer !== undefined,
		...(answer === undefined ? {} : { value: answer.trim() }),
	};
}

/**
 * The header governance verdict — only when a verdict is actually known.
 *
 * ### Why an agent with a directory identity still gets no pill
 *
 * `coverageTarget` says which object Conditional Access *would* be evaluated
 * against; it is not a verdict about whether a policy covers the agent, and the
 * catalog carries no such verdict. So the only governance evidence on this wire
 * is the two protection flags, and the pill is drawn from those alone:
 *
 *   both evaluated and both off  -> Ungoverned. A real, measured finding.
 *   at least one evaluated and on -> Governed.
 *   neither evaluated             -> no pill at all.
 *
 * The third case is the one worth stating out loud. An agent nobody has
 * measured must not be labelled "Ungoverned", which reads as a finding rather
 * than as an absence — and on this page the pill sits directly beside the
 * agent's name, where it is the first thing anyone reads.
 *
 * @param {InventoryAgent} agent
 * @returns {Governance | undefined}
 */
export function buildGovernance(agent) {
	const defender = agent.protection?.defender;
	const dlp = agent.protection?.dlp;
	const evaluated = [defender, dlp].filter((flag) => typeof flag === "boolean");
	if (evaluated.length === 0) return undefined;
	return evaluated.some((flag) => flag === true)
		? { kind: "governed", tone: "success" }
		: { kind: "ungoverned", tone: "danger" };
}

/**
 * The identity list — EVERY fact, in a fixed order, known or not.
 *
 * Emitting a row only when its value exists would make the card's height and
 * the position of each label depend on how much the sources happened to answer.
 * Two agents would then show the same list at two different lengths, and an
 * absent fact would be indistinguishable from a fact the page does not track:
 * the reader could not tell "no owner is recorded" from "this page never says
 * who owns an agent".
 *
 * So the shape of the list is a property of the PAGE, not of the agent. An
 * unanswered fact is still not invented — it carries `known: false` and no
 * value, and the component draws it as "not available".
 *
 * @param {InventoryAgent} agent
 * @param {AgentDetail | null} detail
 * @returns {IdentityRow[]}
 */
export function buildIdentityRows(agent, detail) {
	const info = detail?.agentDetails;

	// The row's own owner first, then the detail document's — the table the
	// reader came from showed the former, and a detail page that renames the
	// owner on arrival reads as a different agent.
	const shownOwner = firstAnswer(agent.owner, info?.owner, info?.owners?.[0]);

	// Sponsors are the remaining owners, never the one already shown above, so
	// the owner is neither duplicated in the facepile nor dropped from it.
	const sponsors = (info?.owners ?? []).filter((name) => name && name !== shownOwner);

	const agentId = firstAnswer(agent.agentId, info?.entraAgentId, detail?.agentId);
	const platform = firstAnswer(agent.platform, info?.platform);
	const status = firstAnswer(agent.status, info?.status);
	const used = lastUsedLabel(agent);

	return [
		fact("status", "text", status, {
			// Only a real "Active" earns the check. An unknown status is untoned,
			// so an unanswered row cannot read as a healthy one.
			...(String(status ?? "").toLowerCase() === "active" ? { status: /** @type {Tone} */ ("success") } : {}),
		}),
		fact("owner", "avatar", shownOwner),
		// The facepile carries its own value, so this row's known-ness is the
		// presence of sponsors rather than of a `value` string.
		{ key: "sponsors", render: "facepile", known: sponsors.length > 0, facepile: sponsors },
		fact("agentId", "monoCopyable", agentId),
		fact("identityType", "text", identityTypeLabel(agent)),
		fact("publisher", "text", agent.publisher),
		fact("platform", "text", platform),
		fact("lastUsed", "text", used),
		// The authentication row's text is chrome the component owns, so it
		// states only whether the Entra identity resolved.
		{ key: "authentication", render: "text", known: isVerified(agent, detail) },
	];
}

/**
 * Which identity object the agent resolved onto, in words.
 *
 * The wire tokens are a contract rather than copy — showing `servicePrincipal`
 * raw would put an internal name in front of an admin.
 *
 * `"user"` is accepted alongside `"agentUser"`. The service projects
 * `CoverageIdentityType` verbatim and emits `agentUser`; `user` is the token the
 * ZTAI row type documents. Matching only one silently drops the other to
 * "unknown", so both are read.
 *
 * @param {InventoryAgent} agent
 * @returns {string | undefined}
 */
export function identityTypeLabel(agent) {
	switch (agent.identity?.coverageTarget) {
		case "servicePrincipal":
			return "Service principal";
		case "agentUser":
		case "user":
			return "Agent user";
		default:
			// "none" is a real answer, but it is the *absence* of a directory
			// identity — so the row is drawn as unknown rather than stating a
			// type the agent does not have.
			return undefined;
	}
}

/**
 * Whether the agent's identity resolved in Entra.
 *
 * @param {InventoryAgent} agent
 * @param {AgentDetail | null} detail
 * @returns {boolean}
 */
export function isVerified(agent, detail) {
	const target = agent.identity?.coverageTarget;
	if (target !== undefined && target !== "none") return true;
	return Boolean(firstAnswer(detail?.agentDetails?.entraAgentId));
}

/**
 * The security-posture panel, built from the real protection flags.
 *
 * `null` is preserved as "never evaluated" rather than folded into `false`. The
 * difference is the whole honesty of the panel: "Not yet protected by Microsoft
 * Purview DLP" is a finding, and saying it about an agent DLP was never asked
 * about would be a fabricated one.
 *
 * "Secure" therefore requires *positive evidence*: low risk plus at least one
 * control that was evaluated and passed. An agent nobody measured is not
 * secure — it is unreviewed, which is what "Review recommended" says.
 *
 * @param {InventoryAgent} agent
 * @returns {Posture}
 */
export function buildPosture(agent) {
	const facts = factsFromRow(agent);
	const lowRisk = agent.riskLevel === "low" || agent.riskLevel === "none";
	const anyProtection = agent.protection?.defender === true || agent.protection?.dlp === true;
	const secure = lowRisk && anyProtection;

	/** @param {boolean | null | undefined} value */
	const flag = (value) => (value === null || value === undefined ? undefined : value);

	return {
		status: secure ? "secure" : "review",
		tone: secure ? "success" : "warning",
		// `coverage` and `caGoverned` are deliberately left unset. The model
		// keeps both fields because a caller with a real Conditional Access
		// verdict should be able to state one — but this wire has none, and
		// filling them from `coverageTarget` would put "Protected by Conditional
		// Access coverage" on screen when all that was actually measured is that
		// the agent has a directory object.
		defenderProtected: flag(agent.protection?.defender),
		dlpProtected: flag(agent.protection?.dlp),
	};
}

/** Exposure-graph criticality → the map's 0..3 severity scale. */
export function severityFromCriticality(/** @type {number | null | undefined} */ level) {
	if (level === null || level === undefined) return undefined;
	if (level >= 3) return /** @type {const} */ (3);
	if (level >= 2) return /** @type {const} */ (2);
	if (level >= 1) return /** @type {const} */ (1);
	return undefined;
}

/**
 * The listed access — real permission and resource names.
 *
 * ### Why "Permissions 0" is expected, and not a bug to chase
 *
 * The catalog and the detail document carry no delegated-grant list. Reading
 * one means `servicePrincipals/{id}/oauth2PermissionGrants`, which is keyed by
 * a canonical appId and is therefore skipped outright for an agent whose
 * identifier is not one — an autonomous agent-user identity, say. So an empty
 * permission list here is the honest state of what was collected, and closing
 * that gap means teaching a provider to resolve grants for that plane, not
 * widening anything on this page.
 *
 * Resources do populate: the detail document's blast radius is exactly "what
 * this agent can reach", grouped by resource type.
 *
 * @param {AgentDetail | null} detail
 * @param {AgentExposure | null} [exposure]
 * @returns {Access}
 */
export function buildAccess(detail, exposure = null) {
	if (!detail) {
		// No detail document could be read. The exposure rollup may still answer,
		// and category counts are a real listing even without named members.
		const categories = exposure?.resolved ? (exposure.blastRadius ?? []) : [];
		return {
			permissions: [],
			resources: categories.map((entry) => ({ name: entry.label, category: entry.label })),
			resourceTotal: categories.reduce((sum, entry) => sum + entry.count, 0),
			hasProfile: categories.length > 0,
		};
	}

	const categories = detail.blastRadius?.byCategory ?? [];
	/** @type {AccessResource[]} */
	const resources = [];
	const seen = new Set();

	for (const category of categories) {
		const members = category.resources ?? [];
		if (members.length === 0) {
			// A category the service counted but named no members for. Listing it
			// by its label with its count is still a true statement about reach;
			// dropping it would under-report the agent's access.
			if (!seen.has(category.label)) {
				seen.add(category.label);
				resources.push({ name: `${category.label} · ${category.count}`, category: category.label });
			}
			continue;
		}
		for (const member of members) {
			const name = firstAnswer(member.name);
			if (!name || seen.has(name)) continue;
			seen.add(name);
			const severity = severityFromCriticality(member.criticalityLevel);
			resources.push({
				name,
				category: category.label,
				...(severity ? { severity } : {}),
			});
		}
	}

	return {
		permissions: [],
		resources,
		// The service's own total, not the length of what was named: a category
		// can report 40 and carry 3 examples, and reporting 3 would understate
		// the blast radius.
		resourceTotal: detail.blastRadius?.total ?? resources.length,
		hasProfile: true,
	};
}

/**
 * The glyph key for a resource category.
 *
 * The map is handed an opaque `kind` it never interprets, so this feature owns
 * the taxonomy. Matching is on a lower-cased substring because the categories
 * are free-form labels from the exposure graph ("Storage account", "Azure SQL
 * database"), not a closed enum — an exact-match table would silently fall
 * through to the default the first time the graph reworded one.
 *
 * @param {string} category
 * @returns {string}
 */
export function resourceKind(category) {
	const name = String(category ?? "").toLowerCase();
	if (/mail|site|sharepoint|vault|sentinel|subscription|tenant|group/.test(name)) return "cloud";
	if (/storage|database|sql|compute|vm|machine|network|logic|function|web|app/.test(name)) return "app";
	if (/api|permission|scope|graph|credential|secret|key/.test(name)) return "key";
	if (/agent|bot|copilot/.test(name)) return "agent";
	if (/user|owner|sponsor|people|person|principal/.test(name)) return "people";
	if (/alert|incident|risk|warning/.test(name)) return "warning";
	return "cloud";
}

/**
 * How many resources are drawn as individual outer-ring nodes before the rest
 * are collapsed into one pin.
 *
 * The exposure graph emits one rollup per resource type, so drawn one-to-one a
 * real agent puts a few dozen discs on the outer ring and the map reads as a
 * hairball. Collapsing past this point into a single "Resources · N" pin, whose
 * members ride along as `children`, means the reader opens the one branch they
 * care about rather than being shown all of them at once.
 */
const RESOURCE_RING_LIMIT = 4;

/**
 * Map the agent onto the relationship graph the map draws.
 *
 * Identities go **left** and access goes **right**, which turns a scan around a
 * ring into a glance across a line — the classic question here is "what can
 * reach this, and what can it reach", and two sets are far easier to compare
 * when each occupies its own half.
 *
 * @param {InventoryAgent} agent
 * @param {AgentDetail | null} detail
 * @param {string} name
 * @returns {RelationshipGraph}
 */
export function buildAccessGraph(agent, detail, name) {
	const rootId = agent.agentId || detail?.agentId || "root";
	const platform = firstAnswer(agent.platform, detail?.agentDetails?.platform) ?? "agent";

	/** @type {GraphNode[]} */
	const nodes = [{ id: rootId, label: `${name} — ${platform}`, ring: "root", kind: "agent" }];
	/** @type {GraphEdge[]} */
	const edges = [];

	// --- left: the identity plane, and who is answerable for it -------------
	const target = agent.identity?.coverageTarget;
	if (target !== undefined && target !== "none") {
		const identityId = agent.identity?.servicePrincipalId || agent.identity?.userId || `${rootId}:identity`;
		const risky = agent.riskLevel === "high" || agent.riskLevel === "medium";
		nodes.push({
			id: identityId,
			label: `${name} — ${target === "agentUser" || target === "user" ? "agent user" : "service principal"}`,
			ring: "inner",
			kind: "shield",
			side: "left",
			// The identity carries the agent's risk, because that is the object
			// Entra actually scored.
			severity: agent.riskLevel === "high" ? 3 : agent.riskLevel === "medium" ? 2 : 0,
			detail: `Entra risk: ${agent.riskLevel}`,
		});
		edges.push({ fromId: identityId, toId: rootId, emphasis: risky });
	}

	const owners = ownerNames(agent, detail);
	owners.forEach((owner, index) => {
		const id = `${rootId}:owner:${index}`;
		nodes.push({
			id,
			label: owner,
			ring: "inner",
			kind: "people",
			side: "left",
			detail: index === 0 ? "Owner" : "Sponsor",
		});
		edges.push({ fromId: id, toId: rootId });
	});

	// --- right: what the agent reaches --------------------------------------
	const categories = [...(detail?.blastRadius?.byCategory ?? [])].sort((a, b) => b.count - a.count);

	/** @param {import("./types.js").AgentDetailBlastCategory} category */
	const categoryNode = (category) => {
		const members = (category.resources ?? [])
			.map((member) => firstAnswer(member.name) && member)
			.filter(Boolean);
		/** @type {GraphNode} */
		const node = {
			id: `${rootId}:cat:${category.label}`,
			label: `${category.label}: ${category.count}`,
			ring: "outer",
			kind: resourceKind(category.label),
			side: "right",
			detail: `${category.count} reachable`,
		};
		if (members.length === 0) return node;
		return {
			...node,
			children: /** @type {GraphNode[]} */ (
				members.map((member, index) => {
					const resource = /** @type {import("./types.js").AgentDetailResource} */ (member);
					const severity = severityFromCriticality(resource.criticalityLevel);
					return {
						id: `${rootId}:res:${category.label}:${index}`,
						label: String(resource.name),
						ring: "child",
						kind: resourceKind(category.label),
						...(severity ? { severity } : {}),
						...(resource.exposedToInternet === true ? { detail: "Exposed to the internet" } : {}),
					};
				})
			),
		};
	};

	const direct = categories.slice(0, RESOURCE_RING_LIMIT).map(categoryNode);
	for (const node of direct) {
		nodes.push(node);
		edges.push({ fromId: rootId, toId: node.id });
	}

	const overflow = categories.slice(RESOURCE_RING_LIMIT);
	if (overflow.length > 0) {
		const total = overflow.reduce((sum, category) => sum + category.count, 0);
		/** @type {GraphNode} */
		const pin = {
			id: `${rootId}:grouped`,
			label: `Resources · ${total} — Grouped resources`,
			ring: "outer",
			kind: "cloud",
			side: "right",
			detail: `${overflow.length} more resource types`,
			children: overflow.map(categoryNode),
		};
		nodes.push(pin);
		edges.push({ fromId: rootId, toId: pin.id });
	}

	// --- inbound: what can reach the agent ----------------------------------
	for (const [index, hop] of (detail?.reachability ?? []).entries()) {
		const label = firstAnswer(hop.sourceLabel, hop.sourceName);
		// An unlabelled hop is a bare GUID or a literal "undefined", and drawn
		// as-is those are a wall of identical blank discs. Dropped rather than
		// rendered, exactly as the source page prunes them before layout.
		if (!label) continue;
		const id = `${rootId}:reach:${hop.sourceId || index}`;
		nodes.push({
			id,
			label,
			ring: "inner",
			kind: resourceKind((hop.sourceCategories ?? []).join(" ")),
			side: "left",
			...(hop.edgeLabel ? { detail: hop.edgeLabel } : {}),
		});
		edges.push({ fromId: id, toId: rootId, ...(hop.edgeLabel ? { label: hop.edgeLabel } : {}) });
	}

	return { rootId, nodes, edges };
}

/**
 * Every name accountable for the agent, owner first, without duplicates.
 * @param {InventoryAgent} agent
 * @param {AgentDetail | null} detail
 * @returns {string[]}
 */
function ownerNames(agent, detail) {
	const info = detail?.agentDetails;
	const all = [agent.owner, info?.owner, ...(info?.owners ?? [])];
	/** @type {string[]} */
	const out = [];
	for (const candidate of all) {
		const name = firstAnswer(candidate);
		if (name && !out.includes(name)) out.push(name);
	}
	return out;
}

/**
 * Build the page's view model from the catalog row and whatever depth was read.
 *
 * The row alone is enough to draw the header, the identity list, the donut and
 * the posture panel — which is why the page renders immediately on arrival and
 * the detail document only fills in the access card and the map.
 *
 * @param {InventoryAgent} agent
 * @param {AgentDetail | null} [detail]
 * @param {AgentExposure | null} [exposure]
 * @returns {AgentDetailsVM}
 */
export function buildAgentDetails(agent, detail = null, exposure = null) {
	const name = firstAnswer(agent.title, detail?.agentDetails?.platform, agent.agentId) ?? agent.agentId;

	return {
		agentId: agent.agentId,
		name,
		publisher: agent.publisher ?? "",
		...(buildGovernance(agent) ? { governance: buildGovernance(agent) } : {}),
		verified: isVerified(agent, detail),
		identityRows: buildIdentityRows(agent, detail),
		risk: secureScore(factsFromRow(agent)),
		posture: buildPosture(agent),
		access: buildAccess(detail, exposure),
		accessGraph: buildAccessGraph(agent, detail, name),
	};
}
