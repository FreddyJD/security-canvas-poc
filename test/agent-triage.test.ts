import { describe, expect, it, vi } from "vitest";
import * as triage from "../features/risky-agents/usecases/agent-triage.mjs";
import { GraphError } from "../platform/graph.mjs";
import { InventoryError } from "../platform/inventory-client.mjs";
import type {
	AgentRiskAssessment,
	AgentRiskDetection,
	AgentSource,
} from "../features/risky-agents/domain/types.js";

/**
 * These use cases no longer own a canvas, so there is no store and no status
 * machine to pin. What is left is the part a stateless MCP tool call depends
 * on: the defaults applied to a query, and the shape of what comes back.
 */

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
	return { repository: stubRepository(assessments) };
}

describe("listRiskyAgents", () => {
	it("defaults to the agents an analyst is actually triaging", async () => {
		// Without these defaults the tool returns every scored agent including
		// the dismissed and confirmed-safe ones, which is not a triage queue.
		const c = ctx();
		await triage.listRiskyAgents(c);

		expect(c.repository.listAssessments).toHaveBeenCalledWith({
			riskLevels: ["high", "medium"],
			riskStates: ["atRisk", "confirmedCompromised"],
			includeDetections: false,
			limit: 25,
		});
	});

	it("passes an explicit query through unchanged", async () => {
		const c = ctx();
		await triage.listRiskyAgents(c, { riskLevels: ["low"], limit: 5, includeDetections: true });

		expect(c.repository.listAssessments).toHaveBeenCalledWith(
			expect.objectContaining({ riskLevels: ["low"], limit: 5, includeDetections: true }),
		);
	});

	it("returns an empty queue rather than throwing on a clean tenant", async () => {
		await expect(triage.listRiskyAgents(ctx([]))).resolves.toEqual([]);
	});
});

describe("explainAgent", () => {
	it("fetches the agent by id", async () => {
		const c = ctx();
		const result = await triage.explainAgent(c, "not-in-queue");

		expect(result.agentId).toBe("not-in-queue");
		expect(c.repository.getAssessment).toHaveBeenCalledWith("not-in-queue", {});
	});

	it("forwards exposure data so the score reflects blast radius", async () => {
		const c = ctx();
		await triage.explainAgent(c, "a", { dataExposure: { highestLabel: "Confidential" } });

		expect(c.repository.getAssessment).toHaveBeenCalledWith(
			"a",
			expect.objectContaining({ dataExposure: { highestLabel: "Confidential" } }),
		);
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

	it("buckets a detection with no type rather than dropping it", async () => {
		// A detection Graph could not classify still happened, and silently
		// discarding it would undercount the window.
		const c = ctx();
		c.repository.listRecentDetections.mockResolvedValue([{ id: "1" }] as AgentRiskDetection[]);

		const activity = await triage.recentActivity(c);
		expect(activity.groups).toEqual([{ riskEventType: "unknown", count: 1 }]);
	});
});

describe("updateRiskState", () => {
	it("applies the transition and reports what it did", async () => {
		const c = ctx();
		const result = await triage.updateRiskState(c, ["agent-1"], "confirmSafe");

		expect(c.repository.updateRiskState).toHaveBeenCalledWith(["agent-1"], "confirmSafe");
		expect(result).toEqual({ action: "confirmSafe", agentIds: ["agent-1"], applied: true });
	});
});

describe("isAuthFailure", () => {
	it("singles out an expired session, which the analyst can fix", () => {
		expect(triage.isAuthFailure(new GraphError("token expired", 401))).toBe(true);
	});

	it("does not treat a permissions problem as a sign-in prompt", () => {
		// Re-authenticating as the same user cannot fix a 403, so offering
		// sign-in would send the analyst round a loop that never resolves.
		expect(triage.isAuthFailure(new GraphError("Insufficient privileges.", 403))).toBe(false);
		expect(triage.isAuthFailure(new InventoryError("expired", 401))).toBe(false);
		expect(triage.isAuthFailure(new Error("network down"))).toBe(false);
	});
});
