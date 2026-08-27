import { describe, expect, it, vi } from "vitest";
import { InventoryStore } from "../features/agent-inventory/usecases/store.mjs";
import * as inventory from "../features/agent-inventory/usecases/inventory-browse.mjs";
import { InventoryError } from "../platform/inventory-client.mjs";
import { agentTable, initials, meterCell, statusCell } from "../features/agent-inventory/components/agent-table.mjs";
import { metricCard, sharePercent } from "../features/agent-inventory/components/metric-card.mjs";
import { filterBar, pager } from "../features/agent-inventory/components/filter-bar.mjs";
import type {
	AgentCatalog,
	InventoryAgent,
	InventorySource,
	InventorySummary,
} from "../features/agent-inventory/domain/types.js";

vi.mock("../platform/auth.mjs", () => ({
	getToken: vi.fn(async () => "token"),
	signIn: vi.fn(async () => "token"),
	defaultTokenProvider: vi.fn(async () => "token"),
}));

const { getToken } = await import("../platform/auth.mjs");

const agent = (over: Partial<InventoryAgent> = {}): InventoryAgent =>
	({
		agentId: "a-1",
		title: "Writing Coach",
		publisher: "Microsoft Corporation",
		platform: "M365 Copilot",
		appType: "firstParty",
		source: "registered",
		status: "Active",
		owner: null,
		riskLevel: "none",
		publiclyExposed: null,
		unmonitored: true,
		lastActivity: null,
		protection: { defender: null, dlp: null },
		blastRadius: { available: false },
		identity: { servicePrincipalId: null, userId: null, coverageTarget: "none" },
		...over,
	}) as InventoryAgent;

function stubRepository(agents: InventoryAgent[], summary: InventorySummary | null = null) {
	return {
		listAgents: vi.fn(
			async (): Promise<AgentCatalog> => ({
				metadata: { tenantId: "t", collectedAt: "", generation: "", schemaVersion: "3.0" },
				agents,
			}),
		),
		getSummary: vi.fn(async (): Promise<InventorySummary | null> => summary),
	} satisfies InventorySource;
}

function ctx(agents: InventoryAgent[] = [agent()], summary: InventorySummary | null = null) {
	return { store: new InventoryStore(), repository: stubRepository(agents, summary) };
}

describe("refreshInventory", () => {
	it("loads the catalog and the summary together", async () => {
		const c = ctx();
		await inventory.refreshInventory(c);

		expect(c.store.get().status).toBe("connected");
		expect(c.repository.listAgents).toHaveBeenCalled();
		expect(c.repository.getSummary).toHaveBeenCalled();
	});

	it("says the table is the flagged subset when the estate is larger", async () => {
		// Silence here would let 3 rows be read as the whole tenant.
		const summary = { agents: { total: 788 } } as unknown as InventorySummary;
		const c = ctx([agent(), agent({ agentId: "b" })], summary);
		await inventory.refreshInventory(c);

		expect(c.store.get().note).toMatch(/2 flagged agents of 788/);
	});

	it("stays quiet when the catalog already is the estate", async () => {
		const summary = { agents: { total: 1 } } as unknown as InventorySummary;
		const c = ctx([agent()], summary);
		await inventory.refreshInventory(c);

		expect(c.store.get().note).toBe("");
	});

	it("reports needs-auth rather than an error when there is no token", async () => {
		vi.mocked(getToken).mockResolvedValueOnce(null);
		const c = ctx();
		await inventory.refreshInventory(c);

		expect(c.store.get().status).toBe("needs-auth");
	});

	it("treats an expired session as a sign-in prompt", async () => {
		const c = ctx();
		c.repository.listAgents.mockRejectedValue(new InventoryError("expired", 401));
		await inventory.refreshInventory(c);

		expect(c.store.get().status).toBe("needs-auth");
	});

	it("surfaces the retry guidance for a 503 snapshot", async () => {
		// This service answers 503 for a snapshot not collected yet, which is a
		// wait-and-retry rather than a misconfiguration.
		const c = ctx();
		c.repository.listAgents.mockRejectedValue(
			new InventoryError("not available yet", 503, "inventoryUnavailable", 5),
		);
		await inventory.refreshInventory(c);

		expect(c.store.get().status).toBe("error");
		expect(c.store.get().hint).toMatch(/retry in 5s/i);
	});

	it("explains a 403 as a directory-role problem, not a scope one", async () => {
		const c = ctx();
		c.repository.listAgents.mockRejectedValue(new InventoryError("denied", 403));
		await inventory.refreshInventory(c);

		expect(c.store.get().hint).toMatch(/Security Administrator/);
	});

	it("never invents agents on failure", async () => {
		const c = ctx();
		c.repository.listAgents.mockRejectedValue(new Error("network down"));
		await inventory.refreshInventory(c);

		expect(c.store.get().agents).toEqual([]);
	});
});

describe("visibleAgents", () => {
	const many = Array.from({ length: 120 }, (_, i) =>
		agent({ agentId: `a-${String(i).padStart(3, "0")}`, title: `Agent ${i}` }),
	);

	it("pages the sorted result", async () => {
		const c = ctx(many);
		await inventory.refreshInventory(c);

		const first = inventory.visibleAgents(c);
		expect(first.rows).toHaveLength(50);
		expect(first.pageCount).toBe(3);
		expect(first.matchedCount).toBe(120);

		c.store.set({ page: 2 });
		expect(inventory.visibleAgents(c).rows).toHaveLength(20);
	});

	it("returns to page one when a filter changes", async () => {
		// Narrowing while on page 3 can leave the reader past the end of the new
		// result, staring at an empty table that looks like a failed filter.
		const c = ctx(many);
		await inventory.refreshInventory(c);
		c.store.set({ page: 2 });
		c.store.setFilters({ search: "Agent 1" });

		expect(c.store.get().page).toBe(0);
	});

	it("reports one page for an empty result rather than zero", async () => {
		const c = ctx(many);
		await inventory.refreshInventory(c);
		c.store.setFilters({ search: "no such agent" });

		expect(inventory.visibleAgents(c).pageCount).toBe(1);
	});
});

describe("store.toggleSort", () => {
	it("flips direction on the active column and resets on a new one", () => {
		const store = new InventoryStore();
		store.toggleSort("platform");
		expect(store.get().sort).toEqual({ column: "platform", descending: false });

		store.toggleSort("platform");
		expect(store.get().sort.descending).toBe(true);

		store.toggleSort("owner");
		expect(store.get().sort).toEqual({ column: "owner", descending: false });
	});
});

describe("summarizeInventory", () => {
	it("reports the estate total, not the row count", async () => {
		const summary = { agents: { total: 788, byRiskLevel: { high: 3 } } } as unknown as InventorySummary;
		const c = ctx([agent()], summary);
		await inventory.refreshInventory(c);

		const out = inventory.summarizeInventory(c);
		expect(out.estateTotal).toBe(788);
		expect(out.flaggedCount).toBe(1);
	});

	it("caps the sampled rows so the payload stays small", async () => {
		const c = ctx(Array.from({ length: 80 }, (_, i) => agent({ agentId: `a-${i}` })));
		await inventory.refreshInventory(c);

		expect(inventory.summarizeInventory(c, { sample: 5 }).agents).toHaveLength(5);
	});
});

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

describe("initials", () => {
	it("takes the first and last word", () => {
		expect(initials("Marie Methot")).toBe("MM");
		expect(initials("Ana Maria Ruiz")).toBe("AR");
	});

	it("handles a mononym and stray whitespace without emitting junk", () => {
		expect(initials("Cher")).toBe("C");
		expect(initials("  Ana  ")).toBe("A");
		expect(initials("")).toBe("?");
	});
});

describe("agent table rendering", () => {
	it("escapes an attacker-influenced agent title", () => {
		// Titles come from the tenant's registered apps, which are third-party
		// controlled.
		const html = agentTable([agent({ title: `<img src=x onerror=alert(1)>` })], {
			column: "name",
			descending: false,
		});
		expect(html).not.toContain("<img src=x");
		expect(html).toContain("&lt;img");
	});

	it("renders Unassigned and N/A as absences, not values", () => {
		const html = agentTable([agent({ owner: null, lastActivity: null })], {
			column: "name",
			descending: false,
		});
		expect(html).toContain("Unassigned");
		expect(html).toContain("N/A");
		expect(html).toContain("dim-italic");
	});

	it("marks the sorted column for assistive tech, not just with a caret", () => {
		const html = agentTable([agent()], { column: "platform", descending: true });
		expect(html).toContain('aria-sort="descending"');
	});

	it("explains an empty result instead of rendering a bare table", () => {
		const html = agentTable([], { column: "name", descending: false });
		expect(html).toContain("No agents match these filters.");
	});
});

describe("meterCell", () => {
	it("clamps an out-of-range value", () => {
		const html = meterCell(99, 4, "High", "danger");
		expect(html.match(/filled/g)).toHaveLength(4);
	});

	it("names the reading for a screen reader rather than the picture", () => {
		expect(meterCell(3, 4, "High", "danger")).toContain('aria-label="Risk: High"');
	});

	it("draws every segment as a track at zero fill", () => {
		expect(meterCell(0, 4, "None", "neutral")).not.toContain("filled");
	});
});

describe("statusCell", () => {
	it("always pairs the dot with its word", () => {
		const html = statusCell("Active");
		expect(html).toContain("status-dot");
		expect(html).toContain("Active");
		expect(html).toContain("tone-success");
	});

	it("escapes a hostile status string", () => {
		expect(statusCell("<b>x</b>")).not.toContain("<b>");
	});
});

describe("metricCard", () => {
	it("carries the pressed state for assistive tech", () => {
		const metric = { id: "highRisk" as const, label: "High", value: 3, total: 10, breakdownLabel: "Assess risk" };
		expect(metricCard(metric, true)).toContain('aria-pressed="true"');
		expect(metricCard(metric, true)).toContain("selected");
	});

	it("names the breakdown link by its metric, since the words repeat", () => {
		const metric = { id: "unowned" as const, label: "Agents without owners", value: 3, total: 10, breakdownLabel: "Review details" };
		expect(metricCard(metric, false)).toContain('aria-label="Review details for Agents without owners"');
	});

	it("says 'of the whole estate' rather than 100%", () => {
		const metric = { id: "all" as const, label: "Total agents", value: 788, total: 788, breakdownLabel: "View breakdown" };
		expect(metricCard(metric, false)).toContain("of the whole estate");
	});

	it("never renders NaN% for an empty estate", () => {
		expect(sharePercent({ id: "all", label: "x", value: 0, total: 0, breakdownLabel: "" })).toBe(0);
	});
});

describe("filterBar", () => {
	it("derives platform pills from the rows", () => {
		const html = filterBar({
			platforms: ["Copilot Studio", "Endpoint"],
			filters: { search: "", platforms: ["Endpoint"], risks: [], slice: "all" },
			matchedCount: 12,
		});
		expect(html).toContain("Copilot Studio");
		expect(html).toContain('data-value="Endpoint"');
		expect(html).toContain("12 agents");
	});

	it("does not offer a None risk pill", () => {
		// Filtering to "no risk" is not a triage question anyone asks.
		const html = filterBar({
			platforms: [],
			filters: { search: "", platforms: [], risks: [], slice: "all" },
			matchedCount: 0,
		});
		expect(html).not.toContain('data-value="none"');
	});

	it("pluralizes the count correctly", () => {
		const one = filterBar({
			platforms: [],
			filters: { search: "", platforms: [], risks: [], slice: "all" },
			matchedCount: 1,
		});
		expect(one).toContain("1 agent<");
	});

	it("escapes the current search term back into the input", () => {
		const html = filterBar({
			platforms: [],
			filters: { search: '"><script>', platforms: [], risks: [], slice: "all" },
			matchedCount: 0,
		});
		expect(html).not.toContain("<script>");
	});
});

describe("pager", () => {
	it("renders nothing for a single page", () => {
		// A pager that can never move is noise, and implies a longer table.
		expect(pager(0, 1)).toBe("");
	});

	it("disables the edges", () => {
		expect(pager(0, 3)).toMatch(/data-page="prev"\s+disabled/);
		expect(pager(2, 3)).toMatch(/data-page="next"\s+disabled/);
	});
});
