import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DetailsStore } from "../features/agent-details/usecases/store.mjs";
import * as details from "../features/agent-details/usecases/agent-details.mjs";
import { InventoryError } from "../platform/inventory-client.mjs";
import type {
	AgentDetail,
	AgentDetailsSource,
	AgentExposure,
	InventoryAgent,
} from "../features/agent-details/domain/types.js";

/**
 * The middle layer. Every failure mode on the way to the screen is resolved
 * here into a `status` the UI renders without branching on HTTP codes, so this
 * is where those cases can be covered without a browser or a network.
 */

vi.mock("../platform/auth.mjs", () => ({
	getToken: vi.fn(async () => "token"),
	signIn: vi.fn(async () => undefined),
}));

const { getToken } = await import("../platform/auth.mjs");

const row = (over: Partial<InventoryAgent> = {}): InventoryAgent =>
	({
		agentId: "agent-1",
		title: "Invoice Bot",
		publisher: "Contoso",
		platform: "Copilot Studio",
		appType: "thirdParty",
		source: "registered",
		status: "Active",
		owner: "Ira Novak",
		riskLevel: "medium",
		publiclyExposed: null,
		unmonitored: false,
		lastActivity: null,
		protection: { defender: null, dlp: null },
		blastRadius: { available: true },
		identity: { servicePrincipalId: "sp-1", userId: null, coverageTarget: "servicePrincipal" },
		...over,
	}) as InventoryAgent;

const detailDoc: AgentDetail = {
	agentId: "agent-1",
	blastRadius: { total: 2, byCategory: [{ label: "group", count: 2, resources: [{ name: "Finance readers" }] }] },
	agentDetails: { owners: ["Ira Novak"] },
};

/** A four-method stub. The use cases depend on the port, never on the class. */
function source(over: Partial<AgentDetailsSource> = {}): AgentDetailsSource {
	return {
		getAgentRow: async () => row(),
		getAgentDetail: async () => detailDoc,
		getAgentExposure: async (): Promise<AgentExposure | null> => null,
		...over,
	};
}

let store: DetailsStore;

beforeEach(() => {
	store = new DetailsStore();
	vi.mocked(getToken).mockResolvedValue("token");
});

afterEach(() => vi.clearAllMocks());

describe("loadAgent", () => {
	it("publishes what the row knows before the depth lands", async () => {
		// The whole reason the page has no full-page spinner: blocking on the
		// cold read would hide facts already in hand.
		const frames: { graphLoading: boolean; name?: string }[] = [];
		store.subscribe((s) => frames.push({ graphLoading: s.graphLoading, name: s.vm?.name }));

		await details.loadAgent({ store, repository: source() }, "agent-1");

		const populated = frames.filter((f) => f.name);
		expect(populated[0]?.graphLoading).toBe(true);
		expect(populated[populated.length - 1]?.graphLoading).toBe(false);
	});

	it("ends connected with the depth folded in", async () => {
		await details.loadAgent({ store, repository: source() }, "agent-1");
		const state = store.get();
		expect(state.status).toBe("connected");
		expect(state.vm?.access.hasProfile).toBe(true);
		expect(state.vm?.access.resourceTotal).toBe(2);
	});

	it("clears the previous agent rather than showing two agents' facts at once", async () => {
		await details.loadAgent({ store, repository: source() }, "agent-1");
		store.focus("agent-2");
		// The single worst thing a security detail page can do is show one
		// agent's name above another's score.
		expect(store.get().vm).toBeNull();
	});

	it("prompts for sign-in rather than erroring when there is no token", async () => {
		vi.mocked(getToken).mockResolvedValue(null as never);
		await details.loadAgent({ store, repository: source() }, "agent-1");
		expect(store.get().status).toBe("needs-auth");
		expect(store.get().vm).toBeNull();
	});

	it("treats an expired session as a sign-in prompt, not an error screen", async () => {
		await details.loadAgent(
			{
				store,
				repository: source({
					getAgentRow: async () => {
						throw new InventoryError("nope", 401);
					},
				}),
			},
			"agent-1",
		);
		expect(store.get().status).toBe("needs-auth");
	});

	it("carries the remediation hint on a real failure", async () => {
		await details.loadAgent(
			{
				store,
				repository: source({
					getAgentRow: async () => {
						throw new InventoryError("snapshot missing", 503, "inventoryUnavailable", 5);
					},
				}),
			},
			"agent-1",
		);
		expect(store.get().status).toBe("error");
		expect(store.get().hint).toMatch(/retry in 5s/);
	});

	it("states a miss as 'no row held', not as 'no such agent'", async () => {
		// The catalog indexes only flagged agents, so absence is genuinely the
		// weaker claim — telling an analyst the agent does not exist would send
		// them looking for a deletion that never happened.
		await details.loadAgent({ store, repository: source({ getAgentRow: async () => null }) }, "ghost");
		expect(store.get().status).toBe("not-found");
		expect(store.get().note).toMatch(/No inventory row/);
		expect(store.get().note).toMatch(/risky, unowned, publicly exposed, or unmonitored/);
	});

	it("refuses a blank id without calling anything", async () => {
		const getAgentRow = vi.fn(async () => row());
		await details.loadAgent({ store, repository: source({ getAgentRow }) }, "   ");
		expect(getAgentRow).not.toHaveBeenCalled();
		expect(store.get().status).toBe("not-found");
	});

	it("still finishes the page when the depth reads fail", async () => {
		// A missing blast radius must not take down a page that has an owner, a
		// platform, a risk band and a posture.
		await details.loadAgent(
			{
				store,
				repository: source({
					getAgentDetail: async () => {
						throw new Error("503");
					},
					getAgentExposure: async () => {
						throw new Error("503");
					},
				}),
			},
			"agent-1",
		);
		expect(store.get().status).toBe("connected");
		expect(store.get().graphLoading).toBe(false);
		expect(store.get().vm?.access.hasProfile).toBe(false);
	});

	it("does not publish a slow agent's graph under a newer agent's name", async () => {
		// The race that would otherwise be invisible and wrong.
		let release: (value: AgentDetail) => void = () => undefined;
		const slow = new Promise<AgentDetail>((resolve) => (release = resolve));

		const pending = details.loadAgent(
			{ store, repository: source({ getAgentDetail: () => slow }) },
			"agent-1",
		);

		// A second focus lands while the first read is still outstanding.
		store.focus("agent-2");
		release(detailDoc);
		await pending;

		expect(store.get().agentId).toBe("agent-2");
		expect(store.get().vm).toBeNull();
	});
});

describe("describeAgent", () => {
	it("serves the store's copy so the analyst and the model discuss one number", async () => {
		await details.loadAgent({ store, repository: source() }, "agent-1");
		const getAgentRow = vi.fn(async () => row());
		const vm = await details.describeAgent({ store, repository: source({ getAgentRow }) }, "agent-1");
		expect(getAgentRow).not.toHaveBeenCalled();
		expect(vm?.name).toBe("Invoice Bot");
	});

	it("refuses to serve a half-loaded copy, which would report a fabricated zero", async () => {
		// The phase-one view model says "no connected resources" for an agent
		// whose graph simply had not arrived yet.
		store.focus("agent-1");
		const getAgentRow = vi.fn(async () => row());
		await details.describeAgent({ store, repository: source({ getAgentRow }) }, "agent-1");
		expect(getAgentRow).toHaveBeenCalled();
	});

	it("reads through for an agent nobody has opened", async () => {
		const vm = await details.describeAgent({ repository: source() }, "agent-1");
		expect(vm?.access.resourceTotal).toBe(2);
	});

	it("matches an id case-insensitively, since it travels through a tool call", async () => {
		await details.loadAgent({ store, repository: source() }, "agent-1");
		expect(await details.describeAgent({ store, repository: source() }, "AGENT-1")).toBeTruthy();
	});

	it("is null for an agent the catalog does not hold", async () => {
		expect(await details.describeAgent({ repository: source({ getAgentRow: async () => null }) }, "ghost")).toBeNull();
	});
});
