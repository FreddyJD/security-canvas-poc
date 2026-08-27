import { describe, expect, it, vi } from "vitest";
import { AgentRepository, UNWIRED_PILLARS } from "../features/risky-agents/data/agent-repository.mjs";
import type { AgentRiskDetection, RiskyAgent } from "../features/risky-agents/domain/types.js";

/**
 * The repository's contract is with the GraphClient, so a stub client is the
 * right seam: these tests pin fetch strategy and mapping without a network.
 */
function stubGraph(over: Partial<Record<string, unknown>> = {}) {
	return {
		listRiskyAgents: vi.fn(async () => [] as RiskyAgent[]),
		getRiskyAgent: vi.fn(async () => ({}) as RiskyAgent),
		listDetectionsForAgent: vi.fn(async () => [] as AgentRiskDetection[]),
		listRecentDetections: vi.fn(async () => [] as AgentRiskDetection[]),
		listAllDetections: vi.fn(async () => [] as AgentRiskDetection[]),
		dismissAgentRisk: vi.fn(async () => {}),
		confirmAgentCompromised: vi.fn(async () => {}),
		confirmAgentSafe: vi.fn(async () => {}),
		...over,
	};
}

const agent = (over: Partial<RiskyAgent> = {}): RiskyAgent => ({
	id: "agent-1",
	agentDisplayName: "Invoice Bot",
	identityType: "agentIdentity",
	riskLevel: "high",
	riskState: "atRisk",
	...over,
});

describe("AgentRepository.listAssessments", () => {
	it("fetches detections once for the whole tenant, not once per agent", async () => {
		// N+1 against a large tenant is slow and invites throttling.
		const graph = stubGraph({
			listRiskyAgents: vi.fn(async () => [agent({ id: "a" }), agent({ id: "b" }), agent({ id: "c" })]),
		});
		await new AgentRepository(graph as never).listAssessments();

		expect(graph.listAllDetections).toHaveBeenCalledTimes(1);
		expect(graph.listDetectionsForAgent).not.toHaveBeenCalled();
	});

	it("skips the detection call entirely when no agents are at risk", async () => {
		const graph = stubGraph();
		const result = await new AgentRepository(graph as never).listAssessments();

		expect(result).toEqual([]);
		expect(graph.listAllDetections).not.toHaveBeenCalled();
	});

	it("groups detections onto the right agent", async () => {
		const graph = stubGraph({
			listRiskyAgents: vi.fn(async () => [agent({ id: "a" }), agent({ id: "b" })]),
			listAllDetections: vi.fn(async () => [
				{ id: "d1", identityId: "a", riskEventType: "suspiciousCredentialUsage", riskLevel: "high" },
				{ id: "d2", identityId: "b", riskEventType: "signInSpike", riskLevel: "low" },
			]),
		});

		const result = await new AgentRepository(graph as never).listAssessments();
		const byId = Object.fromEntries(result.map((a) => [a.agentId, a]));
		expect(byId.a!.factors[0]!.code).toBe("entra.suspiciousCredentialUsage");
		expect(byId.b!.factors[0]!.code).toBe("entra.signInSpike");
	});

	it("still returns scored agents when the detection query fails", async () => {
		// An empty queue would tell the analyst there is nothing to triage,
		// which is a worse lie than a queue scored on standing risk alone.
		const graph = stubGraph({
			listRiskyAgents: vi.fn(async () => [agent()]),
			listAllDetections: vi.fn(async () => {
				throw new Error("429 throttled");
			}),
		});

		const result = await new AgentRepository(graph as never).listAssessments();
		expect(result).toHaveLength(1);
		expect(result[0]!.factors[0]!.code).toBe("entra.standingRiskLevel");
	});

	it("returns the queue most-severe-first", async () => {
		const graph = stubGraph({
			listRiskyAgents: vi.fn(async () => [agent({ id: "mild", riskLevel: "low" }), agent({ id: "severe" })]),
		});
		const result = await new AgentRepository(graph as never).listAssessments();
		expect(result[0]!.agentId).toBe("severe");
	});

	it("reports unwired pillars as gaps rather than scoring them zero", async () => {
		const graph = stubGraph({ listRiskyAgents: vi.fn(async () => [agent()]) });
		const [assessment] = await new AgentRepository(graph as never).listAssessments();
		expect(assessment!.degraded).toEqual(UNWIRED_PILLARS);
	});

	it("attaches detection detail only when asked", async () => {
		const graph = stubGraph({
			listRiskyAgents: vi.fn(async () => [agent()]),
			listAllDetections: vi.fn(async () => [{ id: "d1", identityId: "agent-1", riskEventType: "signInSpike" }]),
		});
		const repo = new AgentRepository(graph as never);

		const [lean] = await repo.listAssessments();
		expect(lean!.detectionDetail).toBeUndefined();

		const [rich] = await repo.listAssessments({ includeDetections: true });
		expect(rich!.detectionDetail?.[0]!.title).toBe("Sign-in volume spike");
	});
});

describe("AgentRepository.getAssessment", () => {
	it("clears the degraded flag for a pillar the caller supplied", async () => {
		const graph = stubGraph({ getRiskyAgent: vi.fn(async () => agent()) });
		const assessment = await new AgentRepository(graph as never).getAssessment("agent-1", {
			dataExposure: { highestLabel: "Highly Confidential" },
		});

		expect(assessment.degraded?.purview).toBeUndefined();
		// GitHub was not supplied, so it must still be declared missing.
		expect(assessment.degraded?.github).toBeDefined();
	});

	it("survives a failed detection fetch for a single agent", async () => {
		const graph = stubGraph({
			getRiskyAgent: vi.fn(async () => agent()),
			listDetectionsForAgent: vi.fn(async () => {
				throw new Error("boom");
			}),
		});
		const assessment = await new AgentRepository(graph as never).getAssessment("agent-1");
		expect(assessment.agentId).toBe("agent-1");
		expect(assessment.detectionDetail).toEqual([]);
	});
});

describe("AgentRepository.updateRiskState", () => {
	it("routes each action to its documented Graph endpoint", async () => {
		const graph = stubGraph();
		const repo = new AgentRepository(graph as never);

		await repo.updateRiskState(["a"], "dismiss");
		await repo.updateRiskState(["b"], "confirmCompromised");
		await repo.updateRiskState(["c"], "confirmSafe");

		expect(graph.dismissAgentRisk).toHaveBeenCalledWith(["a"]);
		expect(graph.confirmAgentCompromised).toHaveBeenCalledWith(["b"]);
		expect(graph.confirmAgentSafe).toHaveBeenCalledWith(["c"]);
	});
});
