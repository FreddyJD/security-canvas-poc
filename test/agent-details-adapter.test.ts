import { describe, expect, it } from "vitest";
import {
	buildAccess,
	buildAccessGraph,
	buildAgentDetails,
	buildGovernance,
	buildIdentityRows,
	buildPosture,
	firstAnswer,
	identityTypeLabel,
	isVerified,
	resourceKind,
	severityFromCriticality,
} from "../features/agent-details/domain/details-adapter.mjs";
import {
	BAND_TONE,
	PILLARS,
	factsFromRow,
	meetsPillar,
	pillarApplies,
	scoreBand,
	secureScore,
} from "../features/agent-details/domain/secure-score.mjs";
import type { AgentDetail, InventoryAgent } from "../features/agent-details/domain/types.js";

/**
 * The adapter is where every "do not fabricate a fact" rule actually lives, so
 * this file is mostly about the three-way distinction the page depends on:
 * a value that was measured, a value that was measured as absent, and a value
 * nobody ever measured. Collapsing the last two is the failure this feature
 * exists to prevent, and it is invisible on screen.
 */

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

const detail = (over: Partial<AgentDetail> = {}): AgentDetail =>
	({
		agentId: "agent-1",
		blastRadius: {
			total: 2,
			byCategory: [
				{ label: "group", count: 1, resources: [{ name: "Finance readers", criticalityLevel: null }] },
				{ label: "serviceprincipal", count: 1, resources: [{ name: "Payments API", criticalityLevel: 3 }] },
			],
		},
		reachability: [],
		agentDetails: { owners: ["Ira Novak"], entraAgentId: "76d5b313-ab72-f111-ab0d-70a8a59be404" },
		...over,
	}) as AgentDetail;

describe("firstAnswer", () => {
	it("skips a blank source in favour of one that actually answered", () => {
		// `??` alone would stop at the empty string and discard the real id.
		expect(firstAnswer("", "   ", "real")).toBe("real");
	});

	it("is undefined when nobody answered", () => {
		expect(firstAnswer(undefined, null, "  ")).toBeUndefined();
	});
});

describe("secure score", () => {
	it("scores out of the pillars that APPLY, never penalising an impossible goal", () => {
		// No directory identity: Conditional Access can never target this agent,
		// so PolicyGoverned drops out of the denominator rather than counting as
		// a permanent gap.
		const facts = factsFromRow(row({ identity: { servicePrincipalId: null, userId: null, coverageTarget: "none" } }));
		expect(pillarApplies(facts, "policyGoverned")).toBe(false);

		const applicable = PILLARS.filter((pillar) => pillarApplies(facts, pillar));
		expect(applicable).not.toContain("policyGoverned");
		expect(applicable).not.toContain("defenderProtected");
		expect(applicable).not.toContain("dlpProtected");
	});

	it("treats a null coverage verdict as no identity, not as an unprotected one", () => {
		// The live trap: collapsing null to false would hand VerifiedIdentity to
		// an agent that has no directory object at all.
		const none = factsFromRow(row({ identity: { servicePrincipalId: null, userId: null, coverageTarget: "none" } }));
		expect(meetsPillar(none, "verifiedIdentity")).toBe(false);

		const some = factsFromRow(row());
		expect(meetsPillar(some, "verifiedIdentity")).toBe(true);
	});

	it("never reads a directory identity as a Conditional Access verdict", () => {
		// `coverageTarget` says which object CA would be evaluated *against*.
		// Reading it as `caGoverned: true` would inflate every identity-bearing
		// agent's score with a pillar nobody measured.
		const facts = factsFromRow(row());
		expect(facts.caGoverned).toBeNull();
		expect(pillarApplies(facts, "policyGoverned")).toBe(false);
	});

	it("fails the low-risk pillar at medium and above", () => {
		expect(meetsPillar(factsFromRow(row({ riskLevel: "medium" })), "lowRisk")).toBe(false);
		expect(meetsPillar(factsFromRow(row({ riskLevel: "high" })), "lowRisk")).toBe(false);
		expect(meetsPillar(factsFromRow(row({ riskLevel: "low" })), "lowRisk")).toBe(true);
		expect(meetsPillar(factsFromRow(row({ riskLevel: "none" })), "lowRisk")).toBe(true);
	});

	it("scores a fully governed low-risk agent at 100", () => {
		const facts = factsFromRow(
			row({
				riskLevel: "none",
				lastActivity: "2026-08-01T00:00:00Z",
				protection: { defender: true, dlp: true },
			}),
		);
		expect(secureScore(facts).score).toBe(100);
		expect(secureScore(facts).band).toBe("strong");
	});

	it("bands and tones agree, so a green ring can never read 'High'", () => {
		expect(scoreBand(80)).toBe("strong");
		expect(scoreBand(79)).toBe("fair");
		expect(scoreBand(40)).toBe("fair");
		expect(scoreBand(39)).toBe("weak");
		expect(BAND_TONE.strong).toBe("success");
		expect(BAND_TONE.weak).toBe("danger");
	});

	it("says why each pillar failed, and separately why one was skipped", () => {
		const { verdicts } = secureScore(
			factsFromRow(row({ lastActivity: null, protection: { defender: false, dlp: null } })),
		);
		const activity = verdicts.find((v) => v.pillar === "activityMonitored");
		const dlp = verdicts.find((v) => v.pillar === "dlpProtected");
		const defender = verdicts.find((v) => v.pillar === "defenderProtected");

		expect(activity?.applies).toBe(true);
		expect(activity?.met).toBe(false);
		// Evaluated and failed — a finding.
		expect(defender?.applies).toBe(true);
		expect(defender?.met).toBe(false);
		// Never evaluated — NOT a finding, and worded differently.
		expect(dlp?.applies).toBe(false);
		expect(dlp?.summary).toMatch(/not evaluated/i);
	});
});

describe("identity rows", () => {
	it("draws every fact whether or not it was answered", () => {
		const rows = buildIdentityRows(row({ owner: null, lastActivity: null }), null);
		// The shape of the list is a property of the page, not of the agent — so
		// two agents always produce the same nine rows in the same order.
		expect(rows.map((r) => r.key)).toEqual([
			"status",
			"owner",
			"sponsors",
			"agentId",
			"identityType",
			"publisher",
			"platform",
			"lastUsed",
			"authentication",
		]);
		expect(rows.find((r) => r.key === "owner")?.known).toBe(false);
		expect(rows.find((r) => r.key === "lastUsed")?.known).toBe(false);
	});

	it("never invents a value for an unanswered fact", () => {
		const rows = buildIdentityRows(row({ owner: "  " }), null);
		const owner = rows.find((r) => r.key === "owner");
		expect(owner?.known).toBe(false);
		expect(owner?.value).toBeUndefined();
	});

	it("only a real Active status earns the toned check", () => {
		expect(buildIdentityRows(row({ status: "Active" }), null).find((r) => r.key === "status")?.status).toBe(
			"success",
		);
		// An unknown status must not read as a healthy one.
		expect(
			buildIdentityRows(row({ status: "Disabled" }), null).find((r) => r.key === "status")?.status,
		).toBeUndefined();
	});

	it("never repeats the owner in the sponsors facepile", () => {
		const rows = buildIdentityRows(
			row({ owner: "Ira Novak" }),
			detail({ agentDetails: { owners: ["Ira Novak", "Sam Reed"] } }),
		);
		expect(rows.find((r) => r.key === "sponsors")?.facepile).toEqual(["Sam Reed"]);
	});

	it("prefers the row's own owner, so the page does not rename it on arrival", () => {
		const rows = buildIdentityRows(row({ owner: "Ira Novak" }), detail({ agentDetails: { owner: "Someone Else" } }));
		expect(rows.find((r) => r.key === "owner")?.value).toBe("Ira Novak");
	});

	it("draws no identity type when the agent resolved onto no directory object", () => {
		// "none" is the *absence* of an identity, not a type an agent has.
		expect(identityTypeLabel(row({ identity: { servicePrincipalId: null, userId: null, coverageTarget: "none" } })))
			.toBeUndefined();
		expect(identityTypeLabel(row())).toBe("Service principal");
	});

	it("reads both spellings of the agent-user coverage target", () => {
		// The service emits "agentUser" (ThreeDocumentProjector copies
		// CoverageIdentityType through verbatim); Security-UX's row type documents
		// the same case as "user". Matching only one silently degrades a real
		// agent user to "unknown".
		expect(identityTypeLabel(row({ identity: { servicePrincipalId: null, userId: "u-1", coverageTarget: "agentUser" } })))
			.toBe("Agent user");
		expect(identityTypeLabel(row({ identity: { servicePrincipalId: null, userId: "u-1", coverageTarget: "user" } })))
			.toBe("Agent user");
	});

	it("reports authentication as known only when the identity actually resolved", () => {
		expect(isVerified(row({ identity: { servicePrincipalId: null, userId: null, coverageTarget: "none" } }), null))
			.toBe(false);
		expect(isVerified(row(), null)).toBe(true);
	});
});

describe("governance", () => {
	it("draws no pill when no control was ever evaluated", () => {
		// An unmeasured agent labelled "Ungoverned" reads as a finding rather
		// than as an absence — and the pill sits beside the agent's name, where
		// it is the first thing anyone reads.
		expect(buildGovernance(row({ protection: { defender: null, dlp: null } }))).toBeUndefined();
	});

	it("marks an agent whose evaluated controls all failed as ungoverned", () => {
		expect(buildGovernance(row({ protection: { defender: false, dlp: false } }))?.kind).toBe("ungoverned");
	});

	it("marks an agent with at least one passing control as governed", () => {
		expect(buildGovernance(row({ protection: { defender: null, dlp: true } }))?.kind).toBe("governed");
	});

	it("never infers a verdict from the mere existence of a directory identity", () => {
		// `coverageTarget` is not a Conditional Access verdict.
		expect(
			buildGovernance(row({ identity: { servicePrincipalId: "sp-1", userId: null, coverageTarget: "servicePrincipal" } })),
		).toBeUndefined();
	});
});

describe("posture", () => {
	it("keeps 'never evaluated' out of the panel entirely", () => {
		const posture = buildPosture(row({ protection: { defender: null, dlp: null } }));
		expect(posture.defenderProtected).toBeUndefined();
		expect(posture.dlpProtected).toBeUndefined();
	});

	it("preserves an evaluated failure as a real finding", () => {
		const posture = buildPosture(row({ protection: { defender: false, dlp: false } }));
		expect(posture.defenderProtected).toBe(false);
		expect(posture.dlpProtected).toBe(false);
	});

	it("requires positive evidence to call an agent secure", () => {
		// An agent nobody measured is not secure — it is unreviewed. Low risk
		// alone would let an unmeasured agent read as a clean bill of health.
		expect(buildPosture(row({ riskLevel: "none", protection: { defender: null, dlp: null } })).status).toBe("review");
		expect(buildPosture(row({ riskLevel: "none", protection: { defender: true, dlp: null } })).status).toBe("secure");
	});

	it("recommends review whenever risk is elevated, however well protected", () => {
		expect(buildPosture(row({ riskLevel: "high", protection: { defender: true, dlp: true } })).status).toBe("review");
	});

	it("never claims Conditional Access protection this wire cannot evidence", () => {
		// `coverageTarget` states which object CA would be evaluated against; it
		// is not a verdict. Filling the clause from it would put "Protected by
		// Conditional Access coverage" on screen for an agent no policy covers.
		const posture = buildPosture(row());
		expect(posture.coverage).toBeUndefined();
		expect(posture.caGoverned).toBeUndefined();
	});
});

describe("access", () => {
	it("draws the empty state rather than claiming zero reach when nothing was read", () => {
		// An empty list would read as "this agent reaches nothing", which is a
		// finding nobody measured.
		expect(buildAccess(null).hasProfile).toBe(false);
	});

	it("reports the service's own total, not the number of named examples", () => {
		const access = buildAccess(
			detail({
				blastRadius: {
					total: 40,
					byCategory: [{ label: "Storage", count: 40, resources: [{ name: "sa-payments" }] }],
				},
			}),
		);
		expect(access.resourceTotal).toBe(40);
		expect(access.resources).toHaveLength(1);
	});

	it("still lists a category the service counted but named no members for", () => {
		const access = buildAccess(detail({ blastRadius: { total: 12, byCategory: [{ label: "Storage", count: 12 }] } }));
		expect(access.resources[0]?.name).toBe("Storage · 12");
	});

	it("falls back to the exposure rollup when no detail document was read", () => {
		const access = buildAccess(null, { resolved: true, blastRadius: [{ label: "group", count: 3 }] });
		expect(access.hasProfile).toBe(true);
		expect(access.resourceTotal).toBe(3);
	});

	it("treats an unresolved exposure as no measurement, not as no access", () => {
		expect(buildAccess(null, { resolved: false, blastRadius: [] }).hasProfile).toBe(false);
	});

	it("maps criticality onto the map's severity scale, and nothing onto nothing", () => {
		expect(severityFromCriticality(null)).toBeUndefined();
		expect(severityFromCriticality(undefined)).toBeUndefined();
		expect(severityFromCriticality(0)).toBeUndefined();
		expect(severityFromCriticality(1)).toBe(1);
		expect(severityFromCriticality(3)).toBe(3);
		expect(severityFromCriticality(9)).toBe(3);
	});
});

describe("resourceKind", () => {
	it("matches on substrings, because the categories are free-form labels", () => {
		expect(resourceKind("Storage account")).toBe("app");
		expect(resourceKind("Azure SQL database")).toBe("app");
		expect(resourceKind("serviceprincipal")).toBe("people");
		expect(resourceKind("group")).toBe("cloud");
		expect(resourceKind("Microsoft Graph API")).toBe("key");
	});

	it("falls back rather than throwing on something it has never seen", () => {
		expect(resourceKind("something brand new")).toBe("cloud");
	});
});

describe("access graph", () => {
	it("puts identities left and access right, so the two sets read as columns", () => {
		const graph = buildAccessGraph(row(), detail(), "Invoice Bot");
		const identity = graph.nodes.find((n) => n.kind === "shield");
		const resources = graph.nodes.filter((n) => n.ring === "outer");
		expect(identity?.side).toBe("left");
		expect(resources.every((n) => n.side === "right")).toBe(true);
	});

	it("is a lone root when there is no depth to draw", () => {
		const graph = buildAccessGraph(
			row({ identity: { servicePrincipalId: null, userId: null, coverageTarget: "none" }, owner: null }),
			null,
			"Invoice Bot",
		);
		expect(graph.nodes).toHaveLength(1);
		expect(graph.nodes[0]?.ring).toBe("root");
		expect(graph.edges).toHaveLength(0);
	});

	it("carries the agent's risk on the identity node, which is what Entra scored", () => {
		const high = buildAccessGraph(row({ riskLevel: "high" }), null, "Invoice Bot");
		expect(high.nodes.find((n) => n.kind === "shield")?.severity).toBe(3);
		const low = buildAccessGraph(row({ riskLevel: "low" }), null, "Invoice Bot");
		expect(low.nodes.find((n) => n.kind === "shield")?.severity).toBe(0);
	});

	it("collapses the overflow categories into one pin rather than a hairball", () => {
		const many = detail({
			blastRadius: {
				total: 60,
				byCategory: Array.from({ length: 9 }, (_unused, i) => ({ label: `cat-${i}`, count: 10 - i })),
			},
		});
		const graph = buildAccessGraph(row(), many, "Invoice Bot");
		const pin = graph.nodes.find((n) => n.id.endsWith(":grouped"));
		expect(pin).toBeTruthy();
		expect(pin?.label).toMatch(/Grouped resources/);
		// The five collapsed categories ride along as children, so the reader can
		// open the one branch they care about.
		expect(pin?.children).toHaveLength(5);
	});

	it("drops an unlabelled reachability hop instead of drawing a blank disc", () => {
		const graph = buildAccessGraph(
			row(),
			detail({ reachability: [{ sourceId: "x", sourceName: null, sourceLabel: "   " }] }),
			"Invoice Bot",
		);
		expect(graph.nodes.some((n) => n.id.includes(":reach:"))).toBe(false);
	});

	it("emphasises the identity edge only when risk is actually elevated", () => {
		const risky = buildAccessGraph(row({ riskLevel: "high" }), null, "Invoice Bot");
		expect(risky.edges.find((e) => e.toId === "agent-1")?.emphasis).toBe(true);
		const calm = buildAccessGraph(row({ riskLevel: "none" }), null, "Invoice Bot");
		expect(calm.edges.find((e) => e.toId === "agent-1")?.emphasis).toBe(false);
	});
});

describe("buildAgentDetails", () => {
	it("builds a full page from the row alone, so phase one paints immediately", () => {
		const vm = buildAgentDetails(row(), null, null);
		expect(vm.name).toBe("Invoice Bot");
		expect(vm.identityRows).toHaveLength(9);
		expect(vm.risk.score).toBeGreaterThanOrEqual(0);
		expect(vm.posture.status).toBe("review");
		// The depth is honestly absent rather than reported as zero.
		expect(vm.access.hasProfile).toBe(false);
	});

	it("folds the depth in without changing anything the row already said", () => {
		const shallow = buildAgentDetails(row(), null, null);
		const full = buildAgentDetails(row(), detail(), null);
		expect(full.name).toBe(shallow.name);
		expect(full.risk.score).toBe(shallow.risk.score);
		expect(full.access.hasProfile).toBe(true);
		expect(full.access.resourceTotal).toBe(2);
	});
});
