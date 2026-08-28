/**
 * Derivations over an inventory row: its labels, its meter fill, its tone, and
 * how it matches the filter bar.
 *
 * Pure and dependency-free, so the canvas, the tests and the MCP tools all
 * compute the same answer. These rules are ported from the Security-UX Agents
 * page (`Assets/hooks/agentPresentation.ts`) — deliberately, because the two
 * surfaces describe the same estate and would otherwise disagree about what
 * "high risk" or "unowned" means.
 *
 * @typedef {import("./types.js").AgentMetric} AgentMetric
 * @typedef {import("./types.js").AgentSlice} AgentSlice
 * @typedef {import("./types.js").InventoryAgent} InventoryAgent
 * @typedef {import("./types.js").InventoryFilters} InventoryFilters
 * @typedef {import("./types.js").InventoryRiskLevel} InventoryRiskLevel
 * @typedef {import("./types.js").Tone} Tone
 */

/** Segments in the risk meter. */
export const RISK_SEGMENTS = 4;

/**
 * How many segments each band fills.
 *
 * Low fills one rather than none: an empty meter reads as "no data", which is a
 * different and more alarming claim than "low risk".
 *
 * @type {Record<InventoryRiskLevel, number>}
 */
const BAND_FILL = { high: 3, medium: 2, low: 1, none: 0 };

/**
 * @param {InventoryRiskLevel} band
 * @returns {number}
 */
export function riskFill(band) {
	return BAND_FILL[band] ?? 0;
}

/** @type {Record<InventoryRiskLevel, string>} */
export const RISK_LABEL = { high: "High", medium: "Medium", low: "Low", none: "None" };

/** @type {Record<InventoryRiskLevel, Tone>} */
export const RISK_TONE = { high: "danger", medium: "warning", low: "success", none: "neutral" };

/** Bands worst-first, so risk sorts by urgency rather than alphabetically. */
export const RISK_ORDER = /** @type {InventoryRiskLevel[]} */ (["high", "medium", "low", "none"]);

/**
 * How the wire's `source` reads in the Discovery column.
 *
 * The wire values are camelCase identifiers, which are a contract rather than
 * copy — showing `exposureGraph` raw would put an internal name in front of an
 * admin.
 *
 * @type {Record<string, string>}
 */
export const DISCOVERY_LABEL = {
	registered: "Registered",
	registry: "Registry",
	exposureGraph: "Exposure graph",
};

/** @param {string} source */
export function discoveryLabel(source) {
	return DISCOVERY_LABEL[source] ?? source;
}

/** What an agent with no accountable owner is called. */
export const UNOWNED_LABEL = "Unassigned";

/**
 * What the Last used column shows when there is no activity signal.
 *
 * "N/A" rather than "Never", and the distinction is the whole point. The
 * inventory reports activity only where a sign-in signal exists: M365 Copilot
 * packages never carry one, and no plane carries one until the tenant's sign-in
 * collection is switched on. "Never" would tell an admin these agents are
 * dormant and safe to decommission — a fact nobody measured. This says only
 * what is true: we do not know.
 */
export const NO_ACTIVITY_LABEL = "N/A";

/**
 * Status label → tone.
 *
 * Deliberately an open map with a neutral fallback: `status` is free-form from
 * the source, and an unrecognized value must still render its own words rather
 * than collapsing to "Unknown", which would hide a real state.
 *
 * @type {Record<string, Tone>}
 */
const STATUS_TONE = {
	active: "success",
	enabled: "success",
	confirmedsafe: "success",
	atrisk: "danger",
	compromised: "danger",
	confirmedcompromised: "danger",
	disabled: "neutral",
	dismissed: "neutral",
	inactive: "warning",
	idle: "warning",
};

/**
 * @param {string} status
 * @returns {Tone}
 */
export function statusTone(status) {
	return STATUS_TONE[String(status).trim().toLowerCase().replace(/\s+/g, "")] ?? "neutral";
}

/** @param {InventoryAgent} agent */
export function hasOwner(agent) {
	return (agent.owner ?? "").trim() !== "";
}

/** @param {InventoryAgent} agent */
export function ownerLabel(agent) {
	return hasOwner(agent) ? /** @type {string} */ (agent.owner) : UNOWNED_LABEL;
}

const DAY_MS = 86_400_000;

/**
 * How far ahead of the reader's clock a timestamp may sit and still be believed.
 *
 * The reporting plane and the browser do not share a clock, so a just-now
 * sign-in routinely lands a few seconds in the future. A day absorbs that. Past
 * it, the value is not skew — it is a bad timestamp, and aging it would put an
 * invented fact on screen.
 */
const MAX_SKEW_MS = DAY_MS;

/**
 * The instant an agent was last used, or `NaN` when there is no believable one.
 *
 * `NaN` rather than null so callers test it with one `Number.isNaN` and never
 * treat a missing value as epoch zero — which a `?? 0` would silently do.
 *
 * @param {InventoryAgent} agent
 * @param {number} now
 * @returns {number}
 */
function activityTime(agent, now) {
	if (!agent.lastActivity) return Number.NaN;
	const used = new Date(agent.lastActivity).getTime();
	// Backend sentinels (0001-01-01) and far-future values are both unusable.
	if (Number.isNaN(used) || used <= 0 || used - now > MAX_SKEW_MS) return Number.NaN;
	return used;
}

/**
 * How long ago an agent was last used — `Today`, `3d ago`, `256d ago`.
 *
 * Days are the only honest unit: the underlying signal is a sign-in report that
 * refreshes on the order of hours, so rendering minutes would put a precision on
 * screen that the data does not have. Returns null when there is no believable
 * instant, so the caller renders NO_ACTIVITY_LABEL rather than inventing one.
 *
 * @param {InventoryAgent} agent
 * @param {number} [now]
 * @returns {string | null}
 */
export function lastUsedLabel(agent, now = Date.now()) {
	const used = activityTime(agent, now);
	if (Number.isNaN(used)) return null;
	const days = Math.floor((now - used) / DAY_MS);
	return days <= 0 ? "Today" : `${days}d ago`;
}

/**
 * What each headline slice means, as a predicate over a row.
 *
 * The count and the filter are the *same* predicate, defined once. A card
 * cannot report a number and then reveal a different set of rows, because there
 * is only one rule and both sides call it.
 *
 * `managed` reads the Defender protection flag, because that is the only
 * governance verdict this endpoint carries. The Security-UX page counts
 * Conditional Access coverage instead (`coveredByPolicy`), which it computes by
 * joining each agent's identity against the tenant's CA policies — a separate
 * read this canvas does not make. So the two surfaces can legitimately disagree
 * on this one card: a tenant whose agents are CA-covered but whose Defender
 * state was never evaluated reads 1 there and 0 here. Both are honest about
 * what they measured; neither infers the other.
 *
 * `null` counts as unmanaged, which is the honest reading: an agent whose
 * protection could not be evaluated is not a governed agent. Deriving `true`
 * from the presence of a directory identity would be the fabrication this
 * canvas exists to avoid — it would claim a control nobody ran.
 *
 * @type {Record<AgentSlice, (agent: InventoryAgent) => boolean>}
 */
export const SLICE_PREDICATE = {
	all: () => true,
	managed: (agent) => agent.protection?.defender === true,
	highRisk: (agent) => agent.riskLevel === "high",
	unowned: (agent) => !hasOwner(agent),
};

/**
 * @param {readonly InventoryAgent[]} agents
 * @param {AgentSlice} slice
 */
export function countSlice(agents, slice) {
	return agents.filter(SLICE_PREDICATE[slice]).length;
}

/**
 * The four headline counts.
 *
 * Every card counts the rows the table holds, and the share is out of that same
 * number. This is not a display choice — a card *is* a filter (`SLICE_PREDICATE`
 * backs both the count and the narrowing), so a card that reports a number it
 * cannot then reveal rows for is broken. Sourcing "high risk" or "unowned" from
 * the tenant-wide summary did exactly that: it put 285 unowned above a table
 * that could only ever show the agents actually loaded, and pressing the card
 * revealed a handful. The same rule as the Security-UX Agents page, and the same
 * reason.
 *
 * The Total card is the one place the estate is named, and it is named in the
 * caption rather than the value: the value stays the row count so the card still
 * describes the table, and the caption says what those rows are out of. Putting
 * 789 in the value over 7 rows is what made this screen contradict itself.
 *
 * @param {readonly InventoryAgent[]} agents
 * @param {import("./types.js").InventorySummary | null} [summary] Supplies the
 *   estate total for the Total card's caption only. Never a count.
 * @returns {AgentMetric[]}
 */
export function buildMetrics(agents, summary = null) {
	const total = agents.length;
	const estateTotal = summary?.agents?.total;

	return [
		{
			id: "all",
			label: "Total agents",
			value: total,
			total,
			breakdownLabel: "View breakdown",
			// "of the whole estate" would be a false claim here: these rows are
			// the ones carrying risk, and the estate is larger.
			shareLabel:
				typeof estateTotal === "number" && estateTotal > total
					? `with risk, of ${estateTotal.toLocaleString()} in the estate`
					: "of the whole estate",
		},
		{
			id: "managed",
			label: "Managed agents",
			value: countSlice(agents, "managed"),
			total,
			breakdownLabel: "Review details",
		},
		{
			id: "highRisk",
			label: "Agents with high risk",
			value: countSlice(agents, "highRisk"),
			total,
			breakdownLabel: "Assess risk",
		},
		{
			id: "unowned",
			label: "Agents without owners",
			value: countSlice(agents, "unowned"),
			total,
			breakdownLabel: "Review details",
		},
	];
}

/**
 * Why the table is empty, in the reader's terms.
 *
 * "No agents match these filters" is the right answer for a search that found
 * nothing, and the wrong one for a tenant with no risky agents — the first says
 * "try again", the second is the good news the reader asked for. Getting this
 * wrong on a security console reads as a broken filter and sends someone
 * hunting for agents that genuinely are not there.
 *
 * Only claims the tenant is clean when risk is the *sole* narrowing. With a
 * search term or a platform pill also active, "no risky agents" would be a
 * statement about the whole tenant made from a narrowed view.
 *
 * @param {InventoryFilters} filters
 * @returns {string}
 */
export function emptyMessage(filters) {
	const risks = filters.risks ?? [];
	const onlyRisk =
		risks.length > 0 &&
		!(filters.search ?? "").trim() &&
		(filters.platforms ?? []).length === 0 &&
		(filters.slice ?? "all") === "all";

	if (!onlyRisk) return "No agents match these filters.";

	const bands = risks.map((r) => RISK_LABEL[r]?.toLowerCase() ?? r);
	const list =
		bands.length === 1
			? bands[0]
			: `${bands.slice(0, -1).join(", ")} or ${bands[bands.length - 1]}`;

	return `No agents are currently at ${list} risk. Nothing to triage.`;
}

/**
 * The agents matching every active filter.
 *
 * Filters combine with AND, which is what a reader expects: narrowing by
 * platform and then by risk should show fewer rows, not more.
 *
 * The search spans title, publisher, owner and platform. One box that searches
 * the row is more useful on an inventory than one that searches a single
 * column — an admin looking for "Marie Methot" is looking for her agents, not
 * for an agent called Marie.
 *
 * @param {readonly InventoryAgent[]} agents
 * @param {InventoryFilters} filters
 * @returns {InventoryAgent[]}
 */
export function filterAgents(agents, filters) {
	const search = (filters.search ?? "").trim().toLowerCase();
	const platforms = filters.platforms ?? [];
	const risks = filters.risks ?? [];
	const slice = filters.slice ?? "all";

	return agents.filter((agent) => {
		if (search) {
			const haystack = [agent.title, agent.publisher, agent.owner ?? "", agent.platform]
				.join(" ")
				.toLowerCase();
			if (!haystack.includes(search)) return false;
		}

		// An empty list is the state after clearing the last option, which reads
		// as "no filter" — not as "nothing can match", which would blank the
		// table with no visible reason.
		if (platforms.length > 0 && !platforms.includes(agent.platform)) return false;
		if (risks.length > 0 && !risks.includes(agent.riskLevel)) return false;
		if (!SLICE_PREDICATE[slice](agent)) return false;

		return true;
	});
}

/**
 * The platforms present in the estate, alphabetical.
 *
 * Derived from the rows rather than hardcoded: the service reports whatever
 * platforms the tenant actually has, and a fixed list would offer filters that
 * match nothing while hiding one that matters.
 *
 * @param {readonly InventoryAgent[]} agents
 * @returns {string[]}
 */
export function platformsIn(agents) {
	const seen = new Set();
	for (const agent of agents) {
		const platform = (agent.platform ?? "").trim();
		if (platform) seen.add(platform);
	}
	return [...seen].sort((a, b) => String(a).localeCompare(String(b)));
}

/**
 * Comparators, one per sortable column.
 *
 * Every one is total and deterministic: rows tie constantly on this data (300
 * agents can share `platform: "M365 Copilot"` and `risk: none`), so an unstable
 * sort would reshuffle the table on every re-render. Ties fall through to
 * agentId, which is unique.
 *
 * Unmeasured `lastUsed` rows are held to the end rather than given a sentinel:
 * a sentinel that sinks them ascending floats them to the top when the
 * comparator is flipped, which reads as a broken sort.
 *
 * @type {Record<string, (a: InventoryAgent, b: InventoryAgent) => number>}
 */
export const COMPARATORS = {
	name: (a, b) => cmp(a.title, b.title) || cmp(a.agentId, b.agentId),
	discovery: (a, b) => cmp(discoveryLabel(a.source), discoveryLabel(b.source)) || cmp(a.agentId, b.agentId),
	platform: (a, b) => cmp(a.platform, b.platform) || cmp(a.agentId, b.agentId),
	owner: (a, b) => cmp(ownerLabel(a), ownerLabel(b)) || cmp(a.agentId, b.agentId),
	risk: (a, b) => RISK_ORDER.indexOf(a.riskLevel) - RISK_ORDER.indexOf(b.riskLevel) || cmp(a.agentId, b.agentId),
	status: (a, b) => cmp(a.status, b.status) || cmp(a.agentId, b.agentId),
	lastUsed: (a, b) => {
		const now = Date.now();
		const left = activityTime(a, now);
		const right = activityTime(b, now);
		const leftKnown = !Number.isNaN(left);
		const rightKnown = !Number.isNaN(right);
		if (!leftKnown || !rightKnown) {
			if (leftKnown === rightKnown) return cmp(a.agentId, b.agentId);
			return leftKnown ? -1 : 1;
		}
		return right - left || cmp(a.agentId, b.agentId);
	},
};

/**
 * Sort a filtered set.
 *
 * Unmeasured `lastUsed` rows stay at the end in both directions — reversing
 * "we do not know" is meaningless, and floating unknowns to the top of a
 * descending sort looks like a bug.
 *
 * @param {readonly InventoryAgent[]} agents
 * @param {import("./types.js").InventorySort} sort
 * @returns {InventoryAgent[]}
 */
export function sortAgents(agents, sort) {
	const compare = COMPARATORS[sort.column] ?? COMPARATORS.name;
	const sorted = [...agents].sort(compare);
	if (!sort.descending) return sorted;

	if (sort.column === "lastUsed") {
		const now = Date.now();
		const known = sorted.filter((a) => !Number.isNaN(activityTime(a, now)));
		const unknown = sorted.filter((a) => Number.isNaN(activityTime(a, now)));
		return [...known.reverse(), ...unknown];
	}
	return sorted.reverse();
}

/**
 * Locale-aware string compare that tolerates null.
 * @param {unknown} a
 * @param {unknown} b
 */
function cmp(a, b) {
	return String(a ?? "").localeCompare(String(b ?? ""));
}
