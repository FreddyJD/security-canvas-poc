import { describe, expect, it } from "vitest";
import {
	COMPARATORS,
	NO_ACTIVITY_LABEL,
	RISK_SEGMENTS,
	buildMetrics,
	countSlice,
	discoveryLabel,
	filterAgents,
	hasOwner,
	lastUsedLabel,
	ownerLabel,
	platformsIn,
	riskFill,
	sortAgents,
	statusTone,
} from "../features/agent-inventory/domain/presentation.mjs";
import type {
	InventoryAgent,
	InventoryFilters,
	InventorySummary,
} from "../features/agent-inventory/domain/types.js";

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

const filters = (over: Partial<InventoryFilters> = {}): InventoryFilters => ({
	search: "",
	platforms: [],
	risks: [],
	slice: "all",
	...over,
});

describe("riskFill", () => {
	it("fills one segment for low, never zero", () => {
		// An empty meter reads as "no data", which is a different and more
		// alarming claim than "low risk".
		expect(riskFill("low")).toBe(1);
		expect(riskFill("none")).toBe(0);
	});

	it("never exceeds the segment count", () => {
		for (const band of ["none", "low", "medium", "high"] as const) {
			expect(riskFill(band)).toBeLessThanOrEqual(RISK_SEGMENTS);
		}
	});
});

describe("discoveryLabel", () => {
	it("translates wire identifiers into words", () => {
		// `exposureGraph` is a contract, not copy — showing it raw would put an
		// internal name in front of an admin.
		expect(discoveryLabel("registered")).toBe("Registered");
		expect(discoveryLabel("exposureGraph")).toBe("Exposure graph");
	});

	it("shows an unmapped source rather than hiding it", () => {
		expect(discoveryLabel("someNewPlane")).toBe("someNewPlane");
	});
});

describe("statusTone", () => {
	it("tones the values seen in practice", () => {
		expect(statusTone("Active")).toBe("success");
		expect(statusTone("At risk")).toBe("danger");
		expect(statusTone("Disabled")).toBe("neutral");
	});

	it("normalizes spacing and case before matching", () => {
		expect(statusTone("  CONFIRMED SAFE ")).toBe("success");
	});

	it("falls back to neutral for an unrecognized status", () => {
		// A closed map would collapse it to "Unknown" and hide a real state.
		expect(statusTone("Quarantined")).toBe("neutral");
	});
});

describe("owner", () => {
	it("treats whitespace as unowned", () => {
		expect(hasOwner(agent({ owner: "   " }))).toBe(false);
		expect(ownerLabel(agent({ owner: "   " }))).toBe("Unassigned");
	});

	it("uses the owner when present", () => {
		expect(ownerLabel(agent({ owner: "Marie Methot" }))).toBe("Marie Methot");
	});
});

describe("lastUsedLabel", () => {
	const now = Date.parse("2026-08-27T12:00:00Z");

	it("returns null when there is no signal, so the caller renders N/A", () => {
		// "Never" would tell an admin the agent is dormant and safe to
		// decommission — a fact nobody measured.
		expect(lastUsedLabel(agent({ lastActivity: null }), now)).toBeNull();
		expect(NO_ACTIVITY_LABEL).toBe("N/A");
	});

	it("rejects a backend sentinel timestamp", () => {
		expect(lastUsedLabel(agent({ lastActivity: "0001-01-01T00:00:00Z" }), now)).toBeNull();
	});

	it("rejects an unparseable timestamp instead of rendering NaN", () => {
		expect(lastUsedLabel(agent({ lastActivity: "not a date" }), now)).toBeNull();
	});

	it("absorbs small clock skew as Today rather than a negative age", () => {
		// The reporting plane and the browser do not share a clock.
		const soon = new Date(now + 30_000).toISOString();
		expect(lastUsedLabel(agent({ lastActivity: soon }), now)).toBe("Today");
	});

	it("rejects a timestamp beyond the skew window as a bad value", () => {
		const wayAhead = new Date(now + 5 * 86_400_000).toISOString();
		expect(lastUsedLabel(agent({ lastActivity: wayAhead }), now)).toBeNull();
	});

	it("ages in whole days", () => {
		const threeDays = new Date(now - 3 * 86_400_000).toISOString();
		expect(lastUsedLabel(agent({ lastActivity: threeDays }), now)).toBe("3d ago");
	});
});

describe("filterAgents", () => {
	const estate = [
		agent({ agentId: "a", title: "Writing Coach", platform: "M365 Copilot", riskLevel: "none" }),
		agent({ agentId: "b", title: "Sales Bot", platform: "Copilot Studio", riskLevel: "high", owner: "Ana Ruiz" }),
		agent({ agentId: "c", title: "Deploy Helper", platform: "Endpoint", riskLevel: "medium" }),
	];

	it("searches across name, publisher, owner and platform", () => {
		// An admin looking for "Ana Ruiz" wants her agents, not an agent named Ana.
		expect(filterAgents(estate, filters({ search: "ana ruiz" })).map((a) => a.agentId)).toEqual(["b"]);
		expect(filterAgents(estate, filters({ search: "endpoint" })).map((a) => a.agentId)).toEqual(["c"]);
	});

	it("treats an empty platform list as no filter, not as match-nothing", () => {
		expect(filterAgents(estate, filters({ platforms: [] }))).toHaveLength(3);
	});

	it("keeps every selected platform, so pills are additive", () => {
		const kept = filterAgents(estate, filters({ platforms: ["M365 Copilot", "Endpoint"] }));
		expect(kept.map((a) => a.agentId)).toEqual(["a", "c"]);
	});

	it("combines filters with AND", () => {
		const kept = filterAgents(estate, filters({ platforms: ["Copilot Studio"], risks: ["high"] }));
		expect(kept.map((a) => a.agentId)).toEqual(["b"]);

		// Narrowing further must never widen the result.
		const contradictory = filterAgents(estate, filters({ platforms: ["Endpoint"], risks: ["high"] }));
		expect(contradictory).toHaveLength(0);
	});

	it("applies the headline slice", () => {
		expect(filterAgents(estate, filters({ slice: "unowned" })).map((a) => a.agentId)).toEqual(["a", "c"]);
		expect(filterAgents(estate, filters({ slice: "highRisk" })).map((a) => a.agentId)).toEqual(["b"]);
	});
});

describe("slices and metrics", () => {
	const estate = [
		agent({ agentId: "a", protection: { defender: true, dlp: null } }),
		agent({ agentId: "b", protection: { defender: false, dlp: null }, riskLevel: "high" }),
		agent({ agentId: "c", protection: { defender: null, dlp: null }, owner: "Sam" }),
	];

	it("counts an unevaluated protection control as unmanaged", () => {
		// An agent whose coverage could not be evaluated is not a governed agent.
		expect(countSlice(estate, "managed")).toBe(1);
	});

	it("uses the summary's estate total rather than the row count", () => {
		// The catalog is the flagged subset: a card reading "3 total" above three
		// rows would be wrong about a tenant with 788 agents.
		const summary = {
			agents: { total: 788, byRiskLevel: { high: 12 }, riskSignals: { unowned: 284 } },
		} as unknown as InventorySummary;

		const metrics = buildMetrics(estate, summary);
		expect(metrics[0]!.value).toBe(788);
		expect(metrics[2]!.value).toBe(12);
		expect(metrics[3]!.value).toBe(284);
	});

	it("falls back to the rows when there is no summary", () => {
		const metrics = buildMetrics(estate, null);
		expect(metrics[0]!.value).toBe(3);
		expect(metrics[2]!.value).toBe(1);
		expect(metrics[3]!.value).toBe(2);
	});

	it("never divides by zero on an empty estate", () => {
		const metrics = buildMetrics([], null);
		expect(metrics.every((m) => Number.isFinite(m.value))).toBe(true);
	});
});

describe("platformsIn", () => {
	it("derives the platforms present, alphabetically and without blanks", () => {
		const found = platformsIn([
			agent({ platform: "M365 Copilot" }),
			agent({ platform: "Copilot Studio" }),
			agent({ platform: "M365 Copilot" }),
			agent({ platform: "  " }),
		]);
		expect(found).toEqual(["Copilot Studio", "M365 Copilot"]);
	});
});

describe("sortAgents", () => {
	it("orders risk worst-first rather than alphabetically", () => {
		const sorted = sortAgents(
			[agent({ agentId: "low", riskLevel: "low" }), agent({ agentId: "high", riskLevel: "high" })],
			{ column: "risk", descending: false },
		);
		expect(sorted[0]!.agentId).toBe("high");
	});

	it("is stable across repeated calls when rows tie", () => {
		// Hundreds of agents share a platform and a risk band on this data; an
		// unstable sort would reshuffle the table on every re-render.
		const tied = [
			agent({ agentId: "c-3", platform: "M365 Copilot" }),
			agent({ agentId: "a-1", platform: "M365 Copilot" }),
			agent({ agentId: "b-2", platform: "M365 Copilot" }),
		];
		const once = sortAgents(tied, { column: "platform", descending: false }).map((a) => a.agentId);
		const twice = sortAgents([...tied].reverse(), { column: "platform", descending: false }).map((a) => a.agentId);
		expect(once).toEqual(["a-1", "b-2", "c-3"]);
		expect(twice).toEqual(once);
	});

	it("does not mutate the input", () => {
		const input = [agent({ agentId: "b" }), agent({ agentId: "a" })];
		sortAgents(input, { column: "name", descending: false });
		expect(input.map((a) => a.agentId)).toEqual(["b", "a"]);
	});

	it("holds unmeasured lastUsed rows at the end in BOTH directions", () => {
		// A sentinel that sinks them ascending floats them to the top when the
		// comparator is flipped, which reads as a broken sort.
		const now = Date.now();
		const rows = [
			agent({ agentId: "unknown", lastActivity: null }),
			agent({ agentId: "old", lastActivity: new Date(now - 10 * 86_400_000).toISOString() }),
			agent({ agentId: "recent", lastActivity: new Date(now - 86_400_000).toISOString() }),
		];

		const asc = sortAgents(rows, { column: "lastUsed", descending: false }).map((a) => a.agentId);
		const desc = sortAgents(rows, { column: "lastUsed", descending: true }).map((a) => a.agentId);

		expect(asc).toEqual(["recent", "old", "unknown"]);
		expect(desc).toEqual(["old", "recent", "unknown"]);
	});
});

describe("COMPARATORS", () => {
	it("sorts owner by its displayed label, so Unassigned groups together", () => {
		const unowned = agent({ agentId: "u", owner: null });
		const owned = agent({ agentId: "o", owner: "Ana" });
		expect(COMPARATORS.owner!(owned, unowned)).toBeLessThan(0);
	});

	it("is total: equal rows still order deterministically by id", () => {
		expect(COMPARATORS.name!(agent({ agentId: "a" }), agent({ agentId: "b" }))).toBeLessThan(0);
	});
});
