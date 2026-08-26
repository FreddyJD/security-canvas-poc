import { describe, expect, it } from "vitest";
import { assessAgent, computeComposite, normalizeDetection, severityFor } from "../src/correlate.js";
import type { AgentRiskDetection, RiskFactor, RiskyAgent } from "../src/types.js";

const agent = (over: Partial<RiskyAgent> = {}): RiskyAgent => ({
	id: "agent-1",
	agentDisplayName: "Invoice Bot",
	identityType: "agentIdentity",
	riskLevel: "high",
	riskState: "atRisk",
	...over,
});

const detection = (over: Partial<AgentRiskDetection> = {}): AgentRiskDetection => ({
	id: `d-${Math.random()}`,
	riskEventType: "signInSpike",
	riskLevel: "medium",
	...over,
});

describe("normalizeDetection", () => {
	it("maps deprecated agentId/agentDisplayName onto supported fields", () => {
		const d = normalizeDetection(detection({ agentId: "a-9", agentDisplayName: "Legacy" }));
		expect(d.identityId).toBe("a-9");
		expect(d.displayName).toBe("Legacy");
	});

	it("prefers the modern fields when both are present", () => {
		const d = normalizeDetection(
			detection({ agentId: "old", identityId: "new", agentDisplayName: "Old", displayName: "New" }),
		);
		expect(d.identityId).toBe("new");
		expect(d.displayName).toBe("New");
	});
});

describe("computeComposite", () => {
	it("returns 0 with no factors", () => {
		expect(computeComposite([])).toBe(0);
	});

	it("never exceeds 100", () => {
		const many: RiskFactor[] = Array.from({ length: 40 }, (_, i) => ({
			pillar: "entra",
			code: `entra.f${i}`,
			summary: "x",
			weight: 1,
		}));
		expect(computeComposite(many)).toBeLessThanOrEqual(100);
	});

	it("reserves 100 for human confirmation — computed scores stay below it", () => {
		const maxed: RiskFactor[] = Array.from({ length: 20 }, (_, i) => ({
			pillar: "entra",
			code: `entra.f${i}`,
			summary: "",
			weight: 1,
		}));
		expect(computeComposite(maxed)).toBeLessThan(100);
	});

	it("keeps additional evidence visible even past a maximum-weight factor", () => {
		// Regression: a single weight-1.0 factor used to pin the score to exactly
		// 100, so every further finding became invisible and severe agents all
		// tied — destroying triage ordering.
		const justMax: RiskFactor[] = [{ pillar: "entra", code: "a", summary: "", weight: 1.0 }];
		const maxPlus: RiskFactor[] = [
			...justMax,
			{ pillar: "purview", code: "b", summary: "", weight: 0.85 },
		];
		expect(computeComposite(maxPlus)).toBeGreaterThan(computeComposite(justMax));
	});

	it("increases across the meaningful range, then saturates honestly", () => {
		// Probabilistic OR converges exponentially, so beyond a handful of severe
		// factors the score genuinely plateaus — 8 vs 12 severe findings differ by
		// ~4e-7. That is correct: both are "drop everything". We assert a strict
		// increase where it is meaningful and non-decreasing thereafter, rather
		// than inventing precision the model would over-read.
		const score = (n: number) =>
			computeComposite(
				Array.from({ length: n }, (_, i) => ({
					pillar: "entra" as const,
					code: `f${i}`,
					summary: "",
					weight: 0.8,
				})),
			);
		expect(score(3)).toBeGreaterThan(score(1));
		expect(score(5)).toBeGreaterThan(score(3));
		expect(score(12)).toBeGreaterThanOrEqual(score(8));
	});

	it("saturates rather than sums: one severe factor outranks many trivial ones", () => {
		const severe = computeComposite([
			{ pillar: "entra", code: "entra.adminConfirmedAgentCompromised", summary: "", weight: 1.0 },
		]);
		const trivial = computeComposite(
			Array.from({ length: 5 }, (_, i) => ({
				pillar: "github" as const,
				code: `github.f${i}`,
				summary: "",
				weight: 0.2,
			})),
		);
		expect(severe).toBeGreaterThan(trivial);
	});

	it("is monotonic — adding a factor never lowers the score", () => {
		const base: RiskFactor[] = [{ pillar: "entra", code: "a", summary: "", weight: 0.5 }];
		const more: RiskFactor[] = [...base, { pillar: "purview", code: "b", summary: "", weight: 0.4 }];
		expect(computeComposite(more)).toBeGreaterThanOrEqual(computeComposite(base));
	});

	it("weights pillars: identical weight scores higher from entra than github", () => {
		const e = computeComposite([{ pillar: "entra", code: "a", summary: "", weight: 0.6 }]);
		const g = computeComposite([{ pillar: "github", code: "a", summary: "", weight: 0.6 }]);
		expect(e).toBeGreaterThan(g);
	});

	it("clamps out-of-range and NaN weights instead of producing garbage", () => {
		const score = computeComposite([
			{ pillar: "entra", code: "a", summary: "", weight: 99 },
			{ pillar: "entra", code: "b", summary: "", weight: -5 },
			{ pillar: "entra", code: "c", summary: "", weight: Number.NaN },
		]);
		expect(Number.isFinite(score)).toBe(true);
		expect(score).toBeGreaterThanOrEqual(0);
		expect(score).toBeLessThanOrEqual(100);
	});
});

describe("severityFor", () => {
	it("bands scores", () => {
		expect(severityFor(0)).toBe("info");
		expect(severityFor(10)).toBe("low");
		expect(severityFor(45)).toBe("medium");
		expect(severityFor(65)).toBe("high");
		expect(severityFor(85)).toBe("critical");
	});

	it("lets a human confirmation override a low computed score", () => {
		expect(severityFor(1, "confirmedCompromised")).toBe("critical");
	});
});

describe("assessAgent", () => {
	it("explains a standing risk level when detections have aged out", () => {
		const a = assessAgent({ agent: agent({ riskLevel: "high" }), detections: [] });
		expect(a.factors).toHaveLength(1);
		expect(a.factors[0]!.code).toBe("entra.standingRiskLevel");
		expect(a.compositeScore).toBeGreaterThan(0);
	});

	it("produces no factors for a clean agent", () => {
		const a = assessAgent({ agent: agent({ riskLevel: "none", riskState: "none" }), detections: [] });
		expect(a.factors).toHaveLength(0);
		expect(a.compositeScore).toBe(0);
		expect(a.severity).toBe("info");
		expect(a.recommendedActions).toContain("No action required. Continue monitoring.");
	});

	it("ranks a confirmed compromise as critical", () => {
		const a = assessAgent({
			agent: agent({ riskState: "confirmedCompromised" }),
			detections: [detection({ riskEventType: "adminConfirmedAgentCompromised", riskLevel: "high" })],
		});
		expect(a.severity).toBe("critical");
		expect(a.recommendedActions.join(" ")).toMatch(/rotate all blueprint credentials/i);
	});

	it("orders factors by descending weight", () => {
		const a = assessAgent({
			agent: agent(),
			detections: [
				detection({ riskEventType: "signInSpike", riskLevel: "low" }),
				detection({ riskEventType: "suspiciousCredentialUsage", riskLevel: "high" }),
			],
		});
		expect(a.factors[0]!.code).toBe("entra.suspiciousCredentialUsage");
	});

	it("scales a detection's weight by its own risk level", () => {
		const high = assessAgent({
			agent: agent(),
			detections: [detection({ riskEventType: "entraDirectoryReconnaissance", riskLevel: "high" })],
		});
		const low = assessAgent({
			agent: agent(),
			detections: [detection({ riskEventType: "entraDirectoryReconnaissance", riskLevel: "low" })],
		});
		expect(high.compositeScore).toBeGreaterThan(low.compositeScore);
	});

	it("handles unknown detection types without dropping them", () => {
		const a = assessAgent({
			agent: agent(),
			detections: [detection({ riskEventType: "someFutureDetection2027" })],
		});
		expect(a.factors[0]!.code).toBe("entra.someFutureDetection2027");
		expect(a.factors[0]!.summary).toMatch(/Unrecognized detection/);
	});

	it("raises the score when Purview and GitHub exposure are present", () => {
		const identityOnly = assessAgent({ agent: agent(), detections: [detection()] });
		const withBlast = assessAgent({
			agent: agent(),
			detections: [detection()],
			dataExposure: { highestLabel: "Highly Confidential", dlpMatches: 3 },
			codeExposure: { productionRepos: ["contoso/payments"], canApprovePullRequests: true },
		});
		expect(withBlast.compositeScore).toBeGreaterThan(identityOnly.compositeScore);
		expect(withBlast.recommendedActions.join(" ")).toMatch(/production repositories/i);
	});

	it("treats a severe label as riskier than a benign one", () => {
		const mk = (highestLabel: string) =>
			assessAgent({ agent: agent(), detections: [], dataExposure: { highestLabel } });
		expect(mk("Highly Confidential").compositeScore).toBeGreaterThan(mk("General").compositeScore);
	});

	it("surfaces coverage gaps so the model can caveat its answer", () => {
		const a = assessAgent({
			agent: agent(),
			detections: [],
			degraded: { purview: "not wired" },
		});
		expect(a.degraded?.purview).toBe("not wired");
	});

	it("warns when Entra is still recomputing risk", () => {
		const a = assessAgent({ agent: agent({ isProcessing: true }), detections: [detection()] });
		expect(a.recommendedActions.join(" ")).toMatch(/still recomputing/i);
	});

	it("falls back to a placeholder name rather than emitting undefined", () => {
		const a = assessAgent({ agent: agent({ agentDisplayName: undefined }), detections: [] });
		expect(a.displayName).toBe("(unnamed agent)");
	});

	it("de-duplicates recommended actions from repeated detection types", () => {
		const a = assessAgent({
			agent: agent(),
			detections: [detection({ riskEventType: "signInSpike" }), detection({ riskEventType: "signInSpike" })],
		});
		expect(new Set(a.recommendedActions).size).toBe(a.recommendedActions.length);
	});
});
