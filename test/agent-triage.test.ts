import { beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasStore } from "../features/risky-agents/usecases/store.mjs";
import * as triage from "../features/risky-agents/usecases/agent-triage.mjs";
import { GraphError } from "../platform/graph.mjs";
import type {
	AgentRiskAssessment,
	AgentRiskDetection,
	AgentSource,
} from "../features/risky-agents/domain/types.js";

/**
 * Use cases resolve auth and failure modes, so those modules are mocked at the
 * boundary. Everything below (scoring, ordering) stays real — the point is to
 * pin how failures become renderable state, not to re-test the domain.
 */
vi.mock("../platform/auth.mjs", () => ({
	getToken: vi.fn(async () => "token"),
	signIn: vi.fn(async () => "token"),
	defaultTokenProvider: vi.fn(async () => "token"),
}));
vi.mock("../platform/config.mjs", async (importOriginal) => ({
	...(await importOriginal<typeof import("../platform/config.mjs")>()),
	getConfig: vi.fn(() => ({ clientId: "client", tenantId: "organizations", directToken: "" })),
}));

const { getToken, signIn } = await import("../platform/auth.mjs");
const { getConfig } = await import("../platform/config.mjs");

const assessment = (over: Partial<AgentRiskAssessment> = {}): AgentRiskAssessment =>
	({
		agentId: "agent-1",
		displayName: "Invoice Bot",
		identityType: "agentIdentity",
		entraRiskLevel: "high",
		riskState: "atRisk",
		compositeScore: 80,
		severity: "critical",
		factors: [{ pillar: "entra", code: "entra.x", summary: "Suspicious credential usage", weight: 0.8 }],
		recommendedActions: ["Disable the agent."],
		...over,
	}) as AgentRiskAssessment;

/**
 * A stub that satisfies the `AgentSource` port.
 *
 * `satisfies` is the point: the use cases depend on the interface, so this
 * fake is checked against the same contract the real repository implements. A
 * signature change breaks the build here rather than silently at runtime.
 */
function stubRepository(assessments: AgentRiskAssessment[]) {
	return {
		listAssessments: vi.fn(async (): Promise<AgentRiskAssessment[]> => assessments),
		getAssessment: vi.fn(async (id: string): Promise<AgentRiskAssessment> => assessment({ agentId: id })),
		listRecentDetections: vi.fn(async (): Promise<AgentRiskDetection[]> => []),
		updateRiskState: vi.fn(async (): Promise<void> => {}),
	} satisfies AgentSource;
}

function ctx(assessments: AgentRiskAssessment[] = [assessment()]) {
	return { store: new CanvasStore(), repository: stubRepository(assessments) };
}


beforeEach(() => {
	vi.mocked(getToken).mockResolvedValue("token");
	vi.mocked(getConfig).mockReturnValue({ clientId: "client", tenantId: "organizations", directToken: "" });
});

describe("refreshQueue", () => {
	it("loads the queue and selects the top agent", async () => {
		const c = ctx([assessment({ agentId: "worst" }), assessment({ agentId: "other" })]);
		await triage.refreshQueue(c);

		expect(c.store.get().status).toBe("connected");
		expect(c.store.get().selectedId).toBe("worst");
		expect(c.store.get().lastRefresh).toBeTruthy();
	});

	it("keeps the analyst's selection across a refresh", async () => {
		// Re-focusing the top of the list mid-investigation would yank the detail
		// pane out from under whoever is reading it.
		const c = ctx([assessment({ agentId: "a" }), assessment({ agentId: "b" })]);
		await triage.refreshQueue(c);
		c.store.navigate("agent-detail", { agentId: "b" });
		await triage.refreshQueue(c);

		expect(c.store.get().selectedId).toBe("b");
	});

	it("re-selects the top agent when the previous selection disappeared", async () => {
		const c = ctx([assessment({ agentId: "gone" })]);
		await triage.refreshQueue(c);
		c.repository.listAssessments.mockResolvedValue([assessment({ agentId: "fresh" })]);
		await triage.refreshQueue(c);

		expect(c.store.get().selectedId).toBe("fresh");
	});

	it("reports needs-config when no client id is set", async () => {
		vi.mocked(getConfig).mockReturnValue({ clientId: "", tenantId: "organizations", directToken: "" });
		const c = ctx();
		await triage.refreshQueue(c);
		expect(c.store.get().status).toBe("needs-config");
	});

	it("reports needs-auth when there is no usable token", async () => {
		vi.mocked(getToken).mockResolvedValue(null);
		const c = ctx();
		await triage.refreshQueue(c);
		expect(c.store.get().status).toBe("needs-auth");
	});

	it("treats an expired session as a sign-in prompt, not an error", async () => {
		// A 401 is actionable by the analyst; an error screen is not.
		const c = ctx();
		c.repository.listAssessments.mockRejectedValue(new GraphError("token expired", 401));
		await triage.refreshQueue(c);

		expect(c.store.get().status).toBe("needs-auth");
		expect(c.store.get().note).toMatch(/sign in again/i);
	});

	it("surfaces Graph remediation as an actionable hint", async () => {
		const c = ctx();
		c.repository.listAssessments.mockRejectedValue(new GraphError("Insufficient privileges.", 403));
		await triage.refreshQueue(c);

		expect(c.store.get().status).toBe("error");
		expect(c.store.get().hint).toMatch(/Security Reader/);
	});

	it("says so explicitly when the tenant is clean", async () => {
		const c = ctx([]);
		await triage.refreshQueue(c);
		expect(c.store.get().status).toBe("connected");
		expect(c.store.get().note).toMatch(/No agents currently match/);
	});

	it("never invents agents on failure", async () => {
		const c = ctx();
		c.repository.listAssessments.mockRejectedValue(new Error("network down"));
		await triage.refreshQueue(c);
		expect(c.store.get().assessments).toEqual([]);
	});
});

describe("connect", () => {
	it("shows progress before the browser round-trip completes", async () => {
		const c = ctx();
		const seen: string[] = [];
		c.store.subscribe((s) => seen.push(s.status));
		await triage.connect(c);

		expect(seen).toContain("signing-in");
		expect(c.store.get().status).toBe("connected");
	});

	it("reports a failed sign-in instead of hanging on the spinner", async () => {
		vi.mocked(signIn).mockRejectedValueOnce(new Error("State mismatch on sign-in callback."));
		const c = ctx();
		await triage.connect(c);

		expect(c.store.get().status).toBe("error");
		expect(c.store.get().note).toMatch(/State mismatch/);
	});
});

describe("selectAgent", () => {
	it("navigates to the detail route and records the selection", async () => {
		const c = ctx([assessment({ agentId: "a" }), assessment({ agentId: "b" })]);
		await triage.refreshQueue(c);
		triage.selectAgent(c, "b");

		expect(c.store.get().route).toEqual({ view: "agent-detail", params: { agentId: "b" } });
		expect(c.store.get().selectedId).toBe("b");
	});

	it("throws on an unknown id rather than blanking the pane", async () => {
		const c = ctx();
		await triage.refreshQueue(c);
		expect(() => triage.selectAgent(c, "nope")).toThrow(/No agent nope/);
	});
});

describe("summarizeQueue", () => {
	it("flattens factors to summaries and drops evidence", async () => {
		// The model picking what to investigate needs reasons, not timestamps.
		const c = ctx();
		await triage.refreshQueue(c);
		const summary = triage.summarizeQueue(c);

		expect(summary.count).toBe(1);
		expect(summary.agents[0]!.factors).toEqual(["Suspicious credential usage"]);
		expect(JSON.stringify(summary)).not.toMatch(/weight/);
	});
});

describe("explainAgent", () => {
	it("serves the queue's copy so the analyst and the model see one number", async () => {
		const c = ctx([assessment({ agentId: "a", detectionDetail: [] })]);
		await triage.refreshQueue(c);
		const result = await triage.explainAgent(c, "a");

		expect(result.agentId).toBe("a");
		expect(c.repository.getAssessment).not.toHaveBeenCalled();
	});

	it("fetches an agent outside the current queue", async () => {
		const c = ctx([assessment({ agentId: "a", detectionDetail: [] })]);
		await triage.refreshQueue(c);
		const result = await triage.explainAgent(c, "not-in-queue");

		expect(result.agentId).toBe("not-in-queue");
		expect(c.repository.getAssessment).toHaveBeenCalled();
	});

	it("always refetches when the caller supplies exposure data", async () => {
		// The cached assessment was scored without it, so reusing it would
		// silently ignore the blast-radius the caller just provided.
		const c = ctx([assessment({ agentId: "a", detectionDetail: [] })]);
		await triage.refreshQueue(c);
		await triage.explainAgent(c, "a", { dataExposure: { highestLabel: "Confidential" } });

		expect(c.repository.getAssessment).toHaveBeenCalled();
	});
});

describe("recentActivity", () => {
	it("groups detections by type, most frequent first", async () => {
		const c = ctx();
		c.repository.listRecentDetections.mockResolvedValue([
			{ id: "1", riskEventType: "signInSpike" },
			{ id: "2", riskEventType: "signInSpike" },
			{ id: "3", riskEventType: "failedAccessAttempt" },
		] as AgentRiskDetection[]);

		const activity = await triage.recentActivity(c, { hours: 24 });
		expect(activity.count).toBe(3);
		expect(activity.groups[0]).toEqual({ riskEventType: "signInSpike", count: 2 });
	});
});

describe("updateRiskState", () => {
	it("re-syncs the canvas so it cannot show a stale verdict", async () => {
		const c = ctx();
		await triage.refreshQueue(c);
		c.repository.listAssessments.mockClear();

		await triage.updateRiskState(c, ["agent-1"], "confirmSafe");

		expect(c.repository.updateRiskState).toHaveBeenCalledWith(["agent-1"], "confirmSafe");
		expect(c.repository.listAssessments).toHaveBeenCalled();
	});

	it("works without a store, for the MCP host", async () => {
		const c = ctx();
		const result = await triage.updateRiskState({ repository: c.repository }, ["a"], "dismiss");
		expect(result).toEqual({ action: "dismiss", agentIds: ["a"], applied: true });
	});
});
