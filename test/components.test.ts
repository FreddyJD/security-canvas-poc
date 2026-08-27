import { describe, expect, it } from "vitest";
import { agentDetail } from "../features/risky-agents/components/agent-detail.mjs";
import { agentList, agentRow } from "../features/risky-agents/components/agent-list.mjs";
import { connectionGate } from "../features/risky-agents/components/connection-gate.mjs";
import { esc, plural, scoreBar } from "../features/risky-agents/components/primitives.mjs";
import { renderRoute, resolveView } from "../features/risky-agents/views/registry.mjs";
import type { AgentRiskAssessment, CanvasState } from "../features/risky-agents/domain/types.js";

/**
 * Components are pure string functions, so they test in Node without a
 * browser. That is the payoff for keeping fetch and DOM wiring out of them.
 */

const assessment = (over: Partial<AgentRiskAssessment> = {}): AgentRiskAssessment =>
	({
		agentId: "agent-1",
		displayName: "Invoice Bot",
		identityType: "agentIdentity",
		entraRiskLevel: "high",
		riskState: "atRisk",
		compositeScore: 88,
		severity: "critical",
		factors: [{ pillar: "entra", code: "entra.x", summary: "Suspicious credential usage", weight: 0.8 }],
		recommendedActions: ["Disable the agent."],
		...over,
	}) as AgentRiskAssessment;

const state = (over: Partial<CanvasState> = {}): CanvasState =>
	({
		status: "connected",
		note: "",
		hint: "",
		route: { view: "triage-queue", params: {} },
		assessments: [assessment()],
		selectedId: "agent-1",
		lastRefresh: null,
		...over,
	}) as CanvasState;

describe("esc", () => {
	it("neutralizes markup in agent-controlled strings", () => {
		// Display names and riskEvidence originate from Graph, which means they
		// are ultimately attacker-influenced. An agent named with a script tag
		// must not execute inside the analyst's canvas.
		expect(esc(`<img src=x onerror="alert(1)">`)).toBe(
			"&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
		);
	});

	it("escapes single quotes so attribute interpolation cannot break out", () => {
		expect(esc("it's")).toBe("it&#39;s");
	});

	it("renders null and undefined as empty, never the literal word", () => {
		expect(esc(null)).toBe("");
		expect(esc(undefined)).toBe("");
	});
});

describe("scoreBar", () => {
	it("clamps out-of-range scores to a valid width", () => {
		expect(scoreBar(150, "critical")).toContain("width:100%");
		expect(scoreBar(-10, "low")).toContain("width:0%");
	});
});

describe("plural", () => {
	it("does not emit the '1 factors' tell", () => {
		expect(plural(1, "factor")).toBe("1 factor");
		expect(plural(2, "factor")).toBe("2 factors");
	});
});

describe("agentRow", () => {
	it("escapes a hostile display name", () => {
		const html = agentRow(assessment({ displayName: `<script>alert(1)</script>` }), false);
		expect(html).not.toContain("<script>");
		expect(html).toContain("&lt;script&gt;");
	});

	it("carries the agent id for click delegation", () => {
		expect(agentRow(assessment(), false)).toContain('data-agent-id="agent-1"');
	});

	it("marks the selected row for assistive tech, not just visually", () => {
		expect(agentRow(assessment(), true)).toContain('aria-selected="true"');
		expect(agentRow(assessment(), true)).toContain("sel");
	});

	it("flags an agent Entra is still recomputing", () => {
		expect(agentRow(assessment({ isProcessing: true }), false)).toContain("recomputing");
	});
});

describe("agentList", () => {
	it("explains an empty queue rather than rendering nothing", () => {
		expect(agentList([], null)).toContain("No agents match the risk filters.");
	});

	it("renders one row per agent", () => {
		const html = agentList([assessment({ agentId: "a" }), assessment({ agentId: "b" })], "a");
		expect(html.match(/data-agent-id=/g)).toHaveLength(2);
	});
});

describe("agentDetail", () => {
	it("prompts for a selection when nothing is focused", () => {
		expect(agentDetail(undefined)).toContain("Select an agent.");
	});

	it("shows the verdict, its reasons, and next steps", () => {
		const html = agentDetail(assessment());
		expect(html).toContain("88/100");
		expect(html).toContain("Suspicious credential usage");
		expect(html).toContain("Disable the agent.");
	});

	it("states coverage gaps so the analyst does not read the score as complete", () => {
		const html = agentDetail(assessment({ degraded: { purview: "not collected" } }));
		expect(html).toContain("Coverage gaps");
		expect(html).toContain("not collected");
	});

	it("escapes attacker-influenced detection evidence", () => {
		const html = agentDetail(
			assessment({
				detectionDetail: [
					{
						id: "d1",
						title: "Suspicious credential usage",
						meaning: "m",
						impact: "i",
						recommendedAction: "a",
						riskEvidence: `<img src=x onerror=alert(1)>`,
					},
				],
			}),
		);
		expect(html).not.toContain("<img src=x");
		expect(html).toContain("&lt;img");
	});
});

describe("connectionGate", () => {
	it("offers sign-in when unauthenticated", () => {
		expect(connectionGate(state({ status: "needs-auth" }))).toContain('data-action="connect"');
	});

	it("shows the error and its remediation hint", () => {
		const html = connectionGate(state({ status: "error", note: "403 denied", hint: "Needs Security Reader" }));
		expect(html).toContain("403 denied");
		expect(html).toContain("Needs Security Reader");
	});

	it("names the missing setting when unconfigured", () => {
		expect(connectionGate(state({ status: "needs-config" }))).toContain("SECURITY_CANVAS_CLIENT_ID");
	});
});

describe("view registry", () => {
	it("routes a known view", () => {
		expect(resolveView("triage-queue").title).toBe("Triage queue");
	});

	it("falls back rather than rendering a blank panel on a bad route", () => {
		// A model inventing a view name must not break the canvas.
		expect(resolveView("nonexistent-view").title).toBe("Triage queue");
	});

	it("renders both panes from one state, so they cannot disagree", () => {
		const { queue, detail } = renderRoute(state());
		expect(queue).toContain('data-agent-id="agent-1"');
		expect(detail).toContain("Invoice Bot");
	});

	it("shows an explicit empty state when the tenant is clean", () => {
		const { detail } = renderRoute(state({ assessments: [], selectedId: null }));
		expect(detail).toContain("Nothing to triage");
	});
});
