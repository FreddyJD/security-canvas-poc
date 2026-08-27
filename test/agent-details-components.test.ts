import { describe, expect, it } from "vitest";
import { agentAccess } from "../features/agent-details/components/agent-access.mjs";
import { detailHeader } from "../features/agent-details/components/detail-header.mjs";
import { identityGrid } from "../features/agent-details/components/identity-grid.mjs";
import { glyphForKind } from "../features/agent-details/components/map-glyphs.mjs";
import { initials } from "../features/agent-details/components/primitives.mjs";
import { joinClauses, postureBody, riskDonut } from "../features/agent-details/components/risk-score.mjs";
import { renderAgentDetails } from "../features/agent-details/tools/render-text.mjs";
import { detailsGate, renderDetails } from "../features/agent-details/views/details-screen.mjs";
import { summarizeAgent } from "../features/agent-details/usecases/agent-details.mjs";
import type {
	Access,
	AgentDetailsVM,
	DetailsState,
	IdentityRow,
	Posture,
	SecureScore,
} from "../features/agent-details/domain/types.js";

/**
 * Components are pure string functions, so they test in Node without a browser.
 * That is the payoff for keeping fetch and DOM wiring out of them.
 */

const risk = (over: Partial<SecureScore> = {}): SecureScore => ({
	score: 50,
	band: "fair",
	tone: "warning",
	verdicts: [
		{ pillar: "verifiedIdentity", applies: true, met: true, summary: "The agent has a verified Entra directory identity." },
		{ pillar: "owned", applies: true, met: false, summary: "No accountable owner is recorded for this agent." },
		{ pillar: "dlpProtected", applies: false, met: false, summary: "Purview DLP scope was not evaluated for this agent." },
	],
	...over,
});

const posture = (over: Partial<Posture> = {}): Posture => ({
	status: "review",
	tone: "warning",
	coverage: false,
	caGoverned: false,
	dlpProtected: false,
	...over,
});

const access = (over: Partial<Access> = {}): Access => ({
	permissions: [],
	resources: [{ name: "Payments API", category: "serviceprincipal", severity: 3 }],
	resourceTotal: 2,
	hasProfile: true,
	...over,
});

const rows: IdentityRow[] = [
	{ key: "status", render: "text", known: true, value: "Active", status: "success" },
	{ key: "owner", render: "avatar", known: false },
	{ key: "sponsors", render: "facepile", known: true, facepile: ["Ira Novak", "Sam Reed"] },
	{ key: "agentId", render: "monoCopyable", known: true, value: "76d5b313-ab72-f111-ab0d-70a8a59be404" },
	{ key: "authentication", render: "text", known: true },
];

const vm = (over: Partial<AgentDetailsVM> = {}): AgentDetailsVM => ({
	agentId: "agent-1",
	name: "ira-test-agent",
	publisher: "Contoso",
	governance: { kind: "ungoverned", tone: "danger" },
	verified: true,
	identityRows: rows,
	risk: risk(),
	posture: posture(),
	access: access(),
	accessGraph: { rootId: "agent-1", nodes: [{ id: "agent-1", label: "ira-test-agent", ring: "root" }], edges: [] },
	...over,
});

const state = (over: Partial<DetailsState> = {}): DetailsState => ({
	status: "connected",
	note: "",
	hint: "",
	agentId: "agent-1",
	vm: vm(),
	graphLoading: false,
	lastRefresh: null,
	...over,
});

describe("escaping", () => {
	it("neutralizes markup in every agent-controlled string", () => {
		// Titles, publishers and resource names come from third-party app
		// registrations, so they are ultimately attacker-influenced. An agent
		// named with a script tag must not execute inside the analyst's canvas.
		const hostile = "<img src=x onerror=alert(1)>";
		const html = renderDetails(state({ vm: vm({ name: hostile }) }));
		expect(html).not.toContain("<img src=x");
		expect(html).toContain("&lt;img src=x");
	});

	it("escapes a hostile resource name in the access card", () => {
		const html = agentAccess(access({ resources: [{ name: `"><script>x</script>` }] }));
		expect(html).not.toContain("<script>");
	});

	it("escapes a hostile value inside a copy attribute, so it cannot break out", () => {
		const html = identityGrid([{ key: "agentId", render: "monoCopyable", known: true, value: `a" onclick="x` }]);
		expect(html).not.toMatch(/data-copy="a" onclick=/);
		expect(html).toContain("&quot;");
	});
});

describe("identityGrid", () => {
	it("draws every row, so the list is the same shape for every agent", () => {
		const html = identityGrid(rows);
		for (const label of ["Status", "Owner", "Sponsors", "Agent ID", "Authentication"]) {
			expect(html).toContain(label);
		}
	});

	it("marks an unanswered fact and says so for a screen reader", () => {
		// A bare hyphen is announced as silence, which reads as "is this empty or
		// broken?" — exactly the ambiguity drawing the row was meant to remove.
		const html = identityGrid([{ key: "owner", render: "avatar", known: false }]);
		expect(html).toContain("Not available");
		expect(html).toContain('class="missing"');
	});

	it("draws no avatar or copy button for an unanswered fact", () => {
		// A facepile of nobody and a copy button with nothing to copy are
		// affordances for content that is not there.
		const html = identityGrid([{ key: "agentId", render: "monoCopyable", known: false }]);
		expect(html).not.toContain("data-copy");
	});

	it("owns the authentication row's wording rather than reading a value", () => {
		expect(identityGrid([{ key: "authentication", render: "text", known: true }])).toContain("Entra required");
	});

	it("caps the facepile and counts the remainder", () => {
		const html = identityGrid([
			{ key: "sponsors", render: "facepile", known: true, facepile: ["A B", "C D", "E F", "G H", "I J", "K L"] },
		]);
		expect(html).toContain("+2");
	});
});

describe("initials", () => {
	it("takes the first and last word", () => {
		expect(initials("Ira Novak")).toBe("IN");
		expect(initials("Marie Anne Methot")).toBe("MM");
	});

	it("never renders an empty circle or a stray undefined", () => {
		expect(initials("")).toBe("?");
		expect(initials("   ")).toBe("?");
		expect(initials("Ira  ")).toBe("I");
	});
});

describe("riskDonut", () => {
	it("puts the reading in the accessible name, since two circles announce nothing", () => {
		expect(riskDonut(risk({ score: 50, band: "fair" }))).toContain("Unified risk score 50 out of 100, Medium risk");
	});

	it("inverts the score band into a risk word, so hue and word always agree", () => {
		// A strong secure score is LOW risk. A green ring captioned "High" would
		// be the worst possible reading.
		expect(riskDonut(risk({ score: 95, band: "strong", tone: "success" }))).toContain("Low risk");
		expect(riskDonut(risk({ score: 10, band: "weak", tone: "danger" }))).toContain("High risk");
	});

	it("clamps a score outside 0..100 rather than drawing past the ring", () => {
		expect(riskDonut(risk({ score: 140 }))).toContain(">100<");
		expect(riskDonut(risk({ score: -20 }))).toContain(">0<");
	});
});

describe("postureBody", () => {
	it("states a measured gap as a finding", () => {
		expect(postureBody(posture({ coverage: false, caGoverned: false, dlpProtected: false }))).toBe(
			"Not yet protected by Conditional Access coverage, Conditional Access governance, and Microsoft Purview DLP.",
		);
	});

	it("never mentions a control that was never evaluated", () => {
		// The whole honesty of the panel: saying "not protected by Defender"
		// about an agent Defender was never asked about is a fabricated finding.
		const body = postureBody(posture({ coverage: true, caGoverned: true, defenderProtected: undefined, dlpProtected: undefined }));
		expect(body).not.toMatch(/Defender/);
		expect(body).not.toMatch(/DLP/);
		expect(body).toBe("Protected by Conditional Access coverage and Conditional Access governance.");
	});

	it("says nothing was evaluated rather than reporting a clean bill of health", () => {
		expect(postureBody({ status: "review", tone: "warning" })).toMatch(/No protection signals have been evaluated/);
	});

	it("states both halves when some controls passed and others failed", () => {
		const body = postureBody(posture({ coverage: true, caGoverned: false, dlpProtected: undefined }));
		expect(body).toContain("Protected by Conditional Access coverage.");
		expect(body).toContain("Not yet protected by Conditional Access governance.");
	});
});

describe("joinClauses", () => {
	it("reads as a sentence rather than a list", () => {
		expect(joinClauses(["a"])).toBe("a");
		expect(joinClauses(["a", "b"])).toBe("a and b");
		expect(joinClauses(["a", "b", "c"])).toBe("a, b, and c");
	});
});

describe("agentAccess", () => {
	it("shows an empty state rather than claiming zero reach", () => {
		// An empty list reads as "this agent reaches nothing", which is a finding
		// nobody measured.
		const html = agentAccess(access({ hasProfile: false }));
		expect(html).toContain("No access data yet");
		expect(html).not.toContain("No connected resources found.");
	});

	it("reports the service's total, not the number of names it could show", () => {
		const html = agentAccess(access({ resourceTotal: 40, resources: [{ name: "sa-1" }] }));
		expect(html).toContain(">40<");
	});

	it("says permissions are zero honestly, without hiding the group", () => {
		expect(agentAccess(access({ permissions: [] }))).toContain("No delegated permissions found.");
	});

	it("tags a resource the exposure graph rated", () => {
		expect(agentAccess(access())).toContain("High");
	});
});

describe("detailHeader", () => {
	it("draws the governance verdict when one is known", () => {
		expect(detailHeader(vm())).toContain("Ungoverned");
	});

	it("draws no pill at all when no verdict exists", () => {
		// "Ungoverned" on an out-of-scope agent would read as a finding.
		const html = detailHeader(vm({ governance: undefined }));
		expect(html).not.toContain("Ungoverned");
		expect(html).not.toContain("Governed");
	});
});

describe("detailsGate", () => {
	it("says nothing is selected rather than spinning forever", () => {
		expect(detailsGate(state({ status: "idle", vm: null }))).toContain("No agent selected");
	});

	it("offers sign-in, not an error, when the session is gone", () => {
		expect(detailsGate(state({ status: "needs-auth", vm: null }))).toContain("Sign in with Microsoft");
	});

	it("shows the remediation hint alongside an error", () => {
		const html = detailsGate(state({ status: "error", vm: null, note: "boom", hint: "check the base url" }));
		expect(html).toContain("boom");
		expect(html).toContain("check the base url");
	});

	it("states a miss as the weaker claim it is", () => {
		const html = detailsGate(
			state({ status: "not-found", vm: null, note: "No inventory row for agent x. The catalog lists agents that are risky…" }),
		);
		expect(html).toContain("Agent not found");
		expect(html).toContain("The catalog lists agents");
	});
});

describe("renderDetails", () => {
	it("draws the graph section from the first frame, before the depth arrives", () => {
		// Withholding it means the page grows a whole section under the reader at
		// whatever moment the fetch happens to land.
		const html = renderDetails(state({ graphLoading: true }));
		expect(html).toContain("Agent's access graph");
		expect(html).toContain("Pan and zoom to inspect ownership, roles, and high-risk edges.");
	});

	it("carries the affordance hint the map's gesture depends on", () => {
		expect(renderDetails(state())).toContain("Scroll to zoom in");
	});

	it("falls through to the gate when there is no view model", () => {
		expect(renderDetails(state({ status: "loading", vm: null }))).toContain("Loading");
	});
});

describe("glyphForKind", () => {
	it("resolves the taxonomy the adapter emits", () => {
		expect(glyphForKind("agent")).toBe("bot");
		expect(glyphForKind("people")).toBe("people");
		expect(glyphForKind("shield")).toBe("shield");
		expect(glyphForKind("app")).toBe("app");
		expect(glyphForKind("cloud")).toBe("cloud");
	});

	it("is undefined for an unmapped kind rather than guessing a shape", () => {
		expect(glyphForKind("something-else")).toBeUndefined();
		expect(glyphForKind(undefined)).toBeUndefined();
	});
});

describe("renderAgentDetails", () => {
	it("names an unanswered fact instead of dropping the row", () => {
		// Dropping it lets a model report "this agent has no owner" for an agent
		// nobody measured.
		expect(renderAgentDetails(vm())).toContain("Owner: not available");
	});

	it("separates an unmet goal from one that was never evaluated", () => {
		const text = renderAgentDetails(vm());
		expect(text).toContain("Unmet security goals");
		expect(text).toContain("Not evaluated");
		expect(text).toContain("NOT the same as unprotected");
	});

	it("explains a zero permission count rather than leaving it to be read as a gap", () => {
		expect(renderAgentDetails(vm())).toMatch(/Permissions: 0 \(no delegated grants were collected/);
	});

	it("reports the service's resource total", () => {
		expect(renderAgentDetails(vm())).toContain("Resources: 2");
	});

	it("says the graph is absent rather than listing nothing", () => {
		expect(renderAgentDetails(vm({ access: access({ hasProfile: false }) }))).toContain(
			"No dependency graph is available",
		);
	});
});

describe("summarizeAgent", () => {
	it("gives a model the counts, not the picture", () => {
		// The positioned graph is a large payload that says nothing a model can
		// reason about; the counts it encodes are what matter.
		const summary = summarizeAgent(vm());
		expect(summary.graph).toEqual({ nodes: 1, edges: 0 });
		expect(summary.access.resources).toBe(2);
		expect(summary.score).toBe(50);
	});

	it("reports an unanswered fact as null, never as a plausible value", () => {
		expect(summarizeAgent(vm()).facts.owner).toBeNull();
		expect(summarizeAgent(vm()).facts.status).toBe("Active");
	});

	it("keeps the unmet and not-evaluated lists apart", () => {
		const summary = summarizeAgent(vm());
		expect(summary.unmetGoals).toHaveLength(1);
		expect(summary.notEvaluated).toHaveLength(1);
	});
});
