/**
 * The `list_agents` tool result, shaped into what the Agents screen renders.
 *
 * The canvas builds its view model from an InventoryStore that holds the whole
 * catalog and pages it locally. An MCP App has no store: it is handed the
 * `structuredContent` of one `list_agents` call and nothing else. This adapter
 * is the seam between the two, so `renderInventory` stays one implementation
 * and the panel in Claude cannot drift from the panel in the Copilot app.
 *
 * Pure, and deliberately in `views/` — it is browser-safe (see
 * BROWSER_SAFE_LAYERS in platform/canvas-http.mjs), so the same module is
 * bundled into the app and imported by the Node tests.
 *
 * @typedef {import("../domain/types.js").InventoryAgent} InventoryAgent
 */
import { buildMetrics } from "../domain/presentation.mjs";

/**
 * The rows the tool already filtered, sorted and truncated.
 *
 * The server did the work: `list_agents` applies the search, the platform and
 * risk filters and the sort before it returns. Re-deriving any of that here
 * would let the panel disagree with the text the model just read out.
 *
 * @typedef {object} ListAgentsResult
 * @property {InventoryAgent[]} [agents] The page of rows to display.
 * @property {number} [matchedCount] How many matched before truncation.
 * @property {number} [riskyCount] How many agents carry risk at all.
 * @property {number} [estateTotal] Agents in the whole estate.
 * @property {string[]} [platforms] Platform labels present, for the pills.
 * @property {Record<string, number>} [byRiskLevel]
 * @property {Record<string, number>} [byPlatform]
 */

/**
 * @param {ListAgentsResult | null | undefined} result `structuredContent` from `list_agents`.
 * @param {{ search?: string, platforms?: string[], risks?: string[], unownedOnly?: boolean, sortBy?: string }} [args]
 *   The arguments the tool was called with, so the filter bar and the column
 *   carets show the state the reader actually asked for.
 * @returns {ReturnType<typeof import("../usecases/inventory-browse.mjs").inventoryViewModel>}
 */
export function appViewModel(result, args = {}) {
	const rows = result?.agents ?? [];
	const matchedCount = result?.matchedCount ?? rows.length;

	// buildMetrics counts the agents it is given, and the tool returns only one
	// page of them. Feeding it `rows` would report "4 high risk" for a tenant
	// with forty. The estate total is passed through the summary shape it reads
	// so the Total card's caption stays truthful about the wider estate — and
	// omitted entirely when unknown, since buildMetrics reads a missing total as
	// "no estate figure" and says "of the whole estate" rather than "of 0".
	const risky = result?.riskyCount ?? matchedCount;
	const estateTotal = result?.estateTotal;
	const summary = typeof estateTotal === "number" ? { agents: { total: estateTotal } } : null;
	const metrics = scaleMetrics(buildMetrics(rows, /** @type {any} */ (summary)), rows.length, risky);

	return {
		status: "connected",
		rows,
		matchedCount,
		totalCount: risky,
		// One tool call is one page. A pager that cannot turn is worse than no
		// pager: the buttons would be dead, because the next page lives behind
		// another `list_agents` call the panel does not make.
		pageCount: 1,
		page: 0,
		pageSize: rows.length || 1,
		metrics,
		platforms: result?.platforms ?? [],
		filters: {
			search: args.search ?? "",
			platforms: args.platforms ?? [],
			risks: /** @type {any} */ (args.risks ?? []),
			slice: args.unownedOnly ? "unowned" : "all",
		},
		// Mirrors the tool's own default: risk first, worst at the top.
		sort: { column: /** @type {any} */ (args.sortBy ?? "risk"), descending: false },
		note: truncationNote(rows.length, matchedCount),
		hint: "",
		// The canvas stamps this when a refresh completes; one tool result has no
		// equivalent moment, and inventing one would date the panel wrongly.
		lastRefresh: null,
	};
}

/**
 * Restate each metric against the risky population rather than the page.
 *
 * `buildMetrics` divides by the number of agents handed to it. With a 50-row
 * page out of 200 risky agents every share would read as a fraction of 50 and
 * the cards would quietly overstate coverage.
 *
 * The counts themselves stay as measured — they are what this page can prove —
 * but the denominator becomes the risky total, which is what the caption claims.
 *
 * @param {ReturnType<typeof buildMetrics>} metrics
 * @param {number} pageSize
 * @param {number} risky
 */
function scaleMetrics(metrics, pageSize, risky) {
	if (risky <= pageSize) return metrics;

	return metrics.map((metric) =>
		metric.id === "all" ? metric : { ...metric, total: risky, shareLabel: `of ${risky.toLocaleString()} with risk` },
	);
}

/**
 * Say so when the table is a subset.
 *
 * `list_agents` caps its result, and a table that silently shows 50 of 200
 * invites someone to conclude the other 150 do not exist — on a security
 * console that is the expensive kind of wrong.
 *
 * @param {number} shown
 * @param {number} matched
 */
function truncationNote(shown, matched) {
	if (matched <= shown) return "";
	return `Showing ${shown.toLocaleString()} of ${matched.toLocaleString()} matching agents. Narrow the search, or ask for more.`;
}
