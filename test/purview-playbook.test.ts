import { describe, expect, it, vi } from "vitest";
import { validateEnum, validateName, validateParams } from "../features/purview-protection/domain/validate.mjs";
import {
	CONFIDENCE_LEVELS,
	PROTECT_AGENTS_PLAYBOOK,
	resolvePlaybook,
} from "../features/purview-protection/domain/protect-agents-playbook.mjs";
import {
	coverageSummary,
	dlpCoverage,
	shouldRecommendPlaybook,
} from "../features/purview-protection/domain/coverage.mjs";
import { PlaybookStore } from "../features/purview-protection/usecases/store.mjs";
import * as playbook from "../features/purview-protection/usecases/run-playbook.mjs";
import { scriptBlock, stepCard, progressBar } from "../features/purview-protection/components/playbook-steps.mjs";
import type {
	AgentCatalog,
	InventoryAgent,
	InventorySource,
	InventorySummary,
} from "../features/agent-inventory/domain/types.js";

const agent = (dlp: boolean | null, over: Partial<InventoryAgent> = {}): InventoryAgent =>
	({
		agentId: "a-1",
		title: "Writing Coach",
		publisher: "Microsoft",
		platform: "M365 Copilot",
		appType: "firstParty",
		source: "registered",
		status: "Active",
		owner: null,
		riskLevel: "none",
		publiclyExposed: null,
		unmonitored: true,
		lastActivity: null,
		protection: { defender: null, dlp },
		blastRadius: { available: false },
		identity: { servicePrincipalId: null, userId: null, coverageTarget: "none" },
		...over,
	}) as InventoryAgent;

// ---------------------------------------------------------------------------
// Validation — the safety-critical part.
// ---------------------------------------------------------------------------

describe("validateName", () => {
	it("accepts ordinary Purview names", () => {
		expect(validateName("AIAgentPolicy", "Policy")).toEqual({ ok: true, value: "AIAgentPolicy" });
		expect(validateName("Project Argus v1.2-beta", "SIT").ok).toBe(true);
	});

	it("trims surrounding whitespace", () => {
		expect(validateName("  AIAgentPolicy  ", "Policy")).toEqual({ ok: true, value: "AIAgentPolicy" });
	});

	it("rejects an empty or whitespace-only value", () => {
		expect(validateName("", "Policy").ok).toBe(false);
		expect(validateName("   ", "Policy").ok).toBe(false);
	});

	it("rejects a PowerShell command-injection payload", () => {
		// This is the reason the whole module exists. The value is interpolated
		// into a command a tenant administrator then runs.
		const payload = `x"; Remove-DlpCompliancePolicy -Identity "AIAgentPolicy" -Confirm:$false; "`;
		expect(validateName(payload, "SIT").ok).toBe(false);
	});

	it("rejects every character that could change a command's meaning", () => {
		// Allowlisted, not escaped: PowerShell has too many quoting contexts to
		// escape reliably across all of them.
		for (const c of ['"', "'", "$", "`", ";", "|", "&", "(", ")", "{", "}", "\n", "\r", "\\", ">", "<", "#"]) {
			expect(validateName(`Policy${c}Name`, "Policy").ok).toBe(false);
		}
	});

	it("rejects a name longer than Purview accepts", () => {
		expect(validateName("A".repeat(65), "Policy").ok).toBe(false);
		expect(validateName("A".repeat(64), "Policy").ok).toBe(true);
	});

	it("explains why, since the rule looks arbitrary otherwise", () => {
		const result = validateName("bad;name", "Policy");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toMatch(/PowerShell/);
	});
});

describe("validateEnum", () => {
	it("matches case-insensitively but returns canonical casing", () => {
		// PowerShell parameter values are case-insensitive; the docs are not.
		expect(validateEnum("low", CONFIDENCE_LEVELS, "Confidence")).toEqual({ ok: true, value: "Low" });
	});

	it("rejects a value outside the set", () => {
		expect(validateEnum("Absolute", CONFIDENCE_LEVELS, "Confidence").ok).toBe(false);
	});

	it("rejects an injection attempt in an enum field", () => {
		expect(validateEnum('Low"; whoami; "', CONFIDENCE_LEVELS, "Confidence").ok).toBe(false);
	});
});

describe("validateParams", () => {
	const params = PROTECT_AGENTS_PLAYBOOK.params;

	it("fills omitted values from the defaults", () => {
		const result = validateParams({}, params);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.values.policyName).toBe("AIAgentPolicy");
	});

	it("treats an empty string as omitted rather than as an error", () => {
		const result = validateParams({ sitName: "" }, params);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.values.sitName).toBe("ProjectArgus");
	});

	it("reports every problem at once", () => {
		const result = validateParams({ policyName: "bad;name", sitName: "also$bad" }, params);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors).toHaveLength(2);
	});

	it("ships defaults that are themselves valid", () => {
		// A playbook with an invalid default would fail the moment it loaded.
		for (const p of params) {
			const result = validateParams({ [p.id]: p.default }, params);
			expect(result.ok).toBe(true);
		}
	});
});

// ---------------------------------------------------------------------------
// The playbook definition
// ---------------------------------------------------------------------------

describe("PROTECT_AGENTS_PLAYBOOK", () => {
	const steps = PROTECT_AGENTS_PLAYBOOK.buildSteps({
		policyName: "AIAgentPolicy",
		sitName: "ProjectArgus",
		confidenceLevel: "Low",
	});

	it("interpolates the parameters into the scripts", () => {
		const custom = PROTECT_AGENTS_PLAYBOOK.buildSteps({
			policyName: "ContosoAgentDLP",
			sitName: "ContosoPII",
			confidenceLevel: "High",
		});
		const code = custom.map((s) => s.script?.code ?? "").join("\n");

		expect(code).toContain('-DisplayName "ContosoAgentDLP"');
		expect(code).toContain('Name="ContosoPII"');
		expect(code).toContain('confidenceLevel="High"');
		expect(code).not.toContain("ProjectArgus");
	});

	it("keeps the agent-scoping JSON fixed, not parameterized", () => {
		// EnforcementOverrides is what actually scopes the policy to agents;
		// mistyping it yields a policy that looks right and enforces nothing.
		const code = steps.map((s) => s.script?.code ?? "").join("\n");
		expect(code).toContain('"AgentScoping"');
		expect(code).toContain('"EnforcementMode":"Block"');
		expect(code).toContain('"Inclusions":["all"]');
	});

	it("creates both rules, since one alone leaves a path open", () => {
		const names = steps.map((s) => s.id);
		expect(names).toContain("rule-agent-and-tool");
		expect(names).toContain("rule-agent");
	});

	it("marks exactly the tenant-changing steps as destructive", () => {
		const destructive = steps.filter((s) => s.script?.destructive).map((s) => s.id);
		expect(destructive).toEqual(["create-policy", "rule-agent-and-tool", "rule-agent"]);
	});

	it("does not mark read-only steps, so the warning keeps its meaning", () => {
		const connect = steps.find((s) => s.id === "connect");
		const verify = steps.find((s) => s.id === "verify");
		expect(connect?.script?.destructive).toBe(false);
		expect(verify?.script?.destructive).toBe(false);
	});

	it("states the effect of every destructive script", () => {
		for (const step of steps.filter((s) => s.script?.destructive)) {
			expect(step.script?.effect).toBeTruthy();
		}
	});

	it("opens with the prerequisites and closes with re-checking coverage", () => {
		expect(steps[0]!.kind).toBe("prerequisite");
		expect(steps.at(-1)!.id).toBe("recheck");
	});
});

describe("resolvePlaybook", () => {
	it("falls back rather than throwing on an unknown id", () => {
		expect(resolvePlaybook("no-such-playbook").id).toBe(PROTECT_AGENTS_PLAYBOOK.id);
	});
});

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

describe("dlpCoverage", () => {
	it("keeps not-evaluated separate from uncovered", () => {
		// null means nobody measured; false means measured and unprotected.
		// Folding them together would either invent a problem or hide one.
		const c = dlpCoverage([agent(true), agent(false), agent(null)]);
		expect(c).toMatchObject({ covered: 1, uncovered: 1, notEvaluated: 1, total: 3 });
	});

	it("treats a missing protection object as not evaluated", () => {
		const c = dlpCoverage([{ ...agent(null), protection: undefined } as unknown as InventoryAgent]);
		expect(c.notEvaluated).toBe(1);
	});

	it("names a few uncovered agents rather than only counting them", () => {
		const c = dlpCoverage([agent(false, { agentId: "x", title: "Sales Bot" })]);
		expect(c.examples[0]).toMatchObject({ agentId: "x", title: "Sales Bot" });
	});

	it("caps the examples so the banner stays scannable", () => {
		const many = Array.from({ length: 20 }, (_, i) => agent(false, { agentId: `a${i}` }));
		expect(dlpCoverage(many).examples).toHaveLength(5);
	});
});

describe("coverageSummary", () => {
	it("leads with the actionable number when agents are uncovered", () => {
		expect(coverageSummary(dlpCoverage([agent(false), agent(true)]))).toMatch(/1 of 2 agents are not covered/);
	});

	it("distinguishes an unevaluated estate from a protected one", () => {
		// "0 uncovered" for a tenant nobody assessed would be true and
		// completely misleading.
		const summary = coverageSummary(dlpCoverage([agent(null), agent(null)]));
		expect(summary).toMatch(/not been evaluated/);
		expect(summary).toMatch(/not the same as being uncovered/);
	});

	it("says so plainly when everything is covered", () => {
		expect(coverageSummary(dlpCoverage([agent(true)]))).toMatch(/All 1 agents are covered/);
	});

	it("handles no inventory at all", () => {
		expect(coverageSummary(null)).toMatch(/unknown/);
	});
});

describe("shouldRecommendPlaybook", () => {
	it("recommends for uncovered and for unevaluated estates alike", () => {
		expect(shouldRecommendPlaybook(dlpCoverage([agent(false)]))).toBe(true);
		expect(shouldRecommendPlaybook(dlpCoverage([agent(null)]))).toBe(true);
		expect(shouldRecommendPlaybook(null)).toBe(true);
	});

	it("stops recommending once every agent is covered", () => {
		expect(shouldRecommendPlaybook(dlpCoverage([agent(true), agent(true)]))).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Store and use cases
// ---------------------------------------------------------------------------

describe("PlaybookStore", () => {
	it("opens the first step, so the reader has somewhere to start", () => {
		expect(new PlaybookStore().get().progress.openStepId).toBe("install-module");
	});

	it("clears progress when parameters change", () => {
		// The steps are generated from the parameters, so a ticked step would
		// claim the operator ran a command that no longer exists.
		const store = new PlaybookStore();
		store.toggleDone("connect");
		store.setParams({ policyName: "Different" });

		expect(store.get().progress.claimedDone).toEqual([]);
		expect(store.get().note).toMatch(/progress was cleared/);
	});

	it("keeps progress when a parameter is set to its current value", () => {
		const store = new PlaybookStore();
		store.toggleDone("connect");
		store.setParams({ policyName: store.get().params.policyName! });

		expect(store.get().progress.claimedDone).toEqual(["connect"]);
	});

	it("toggles a step done and undone", () => {
		const store = new PlaybookStore();
		store.toggleDone("connect");
		expect(store.get().progress.claimedDone).toEqual(["connect"]);
		store.toggleDone("connect");
		expect(store.get().progress.claimedDone).toEqual([]);
	});

	it("collapses a step that is already open", () => {
		const store = new PlaybookStore();
		store.openStep("connect");
		expect(store.get().progress.openStepId).toBe("connect");
		store.openStep("connect");
		expect(store.get().progress.openStepId).toBeNull();
	});
});

/** A stub checked against the port the use cases actually depend on. */
function stubRepository(agents: InventoryAgent[]) {
	return {
		listAgents: vi.fn(
			async (): Promise<AgentCatalog> => ({
				metadata: { tenantId: "t", collectedAt: "", generation: "", schemaVersion: "3.0" },
				agents,
			}),
		),
		getSummary: vi.fn(async (): Promise<InventorySummary | null> => null),
	} satisfies InventorySource;
}

function ctx(agents: InventoryAgent[] = [agent(false)]) {
	return {
		store: new PlaybookStore(),
		repository: stubRepository(agents),
		getSession: (): { send: (m: { prompt: string }) => void } | null => null,
	};
}

describe("refreshCoverage", () => {
	it("reads coverage from the inventory", async () => {
		const c = ctx([agent(true), agent(false)]);
		await playbook.refreshCoverage(c);
		expect(c.store.get().coverage).toMatchObject({ covered: 1, uncovered: 1 });
	});

	it("still offers the playbook when coverage cannot be read", async () => {
		// Coverage motivates the scripts; it is not a precondition for them.
		const c = ctx();
		c.repository.listAgents.mockRejectedValue(new Error("403 denied"));
		await playbook.refreshCoverage(c);

		expect(c.store.get().status).toBe("ready");
		expect(c.store.get().note).toMatch(/playbook below still applies/);
	});
});

describe("applyParams", () => {
	it("rejects an unsafe value and leaves state untouched", () => {
		const c = ctx();
		const before = c.store.get().params.sitName;
		const result = playbook.applyParams(c, { sitName: 'evil"; rm -rf /; "' });

		expect(result.ok).toBe(false);
		expect(c.store.get().params.sitName).toBe(before);
	});

	it("applies a valid value", () => {
		const c = ctx();
		expect(playbook.applyParams(c, { sitName: "ContosoPII" }).ok).toBe(true);
		expect(c.store.get().params.sitName).toBe("ContosoPII");
	});
});

describe("buildHandoff", () => {
	it("carries every step and its script", () => {
		const handoff = playbook.buildHandoff(ctx());
		expect(handoff.steps).toHaveLength(8);
		expect(handoff.steps.filter((s) => s.script).length).toBeGreaterThan(0);
	});

	it("tells the model to present rather than execute", () => {
		// A block of PowerShell in a prompt reads to a model like a task, and
		// these commands rewrite tenant DLP policy.
		const { prompt } = playbook.buildHandoff(ctx());
		expect(prompt).toMatch(/Do not attempt to run any of this yourself/);
		expect(prompt).toMatch(/wait for me to confirm/);
	});

	it("flags the tenant-changing commands inside the prompt", () => {
		const { prompt } = playbook.buildHandoff(ctx());
		expect(prompt).toMatch(/CHANGES MY TENANT/);
	});

	it("reflects the operator's claimed progress", () => {
		const c = ctx();
		c.store.toggleDone("connect");
		expect(playbook.buildHandoff(c).prompt).toMatch(/\[I have done this\]/);
	});

	it("includes the current coverage so the model has the motivation", async () => {
		const c = ctx([agent(false), agent(false)]);
		await playbook.refreshCoverage(c);
		expect(playbook.buildHandoff(c).prompt).toMatch(/2 of 2 agents are not covered/);
	});
});

describe("sendToCopilot", () => {
	it("reports failure rather than throwing when there is no session", () => {
		expect(playbook.sendToCopilot(ctx())).toBe(false);
	});

	it("sends the prompt when a session exists", () => {
		const send = vi.fn();
		const c = { ...ctx(), getSession: () => ({ send }) };
		expect(playbook.sendToCopilot(c)).toBe(true);
		expect(send).toHaveBeenCalledWith({ prompt: expect.stringMatching(/Protect agents/i) });
	});
});

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

describe("scriptBlock", () => {
	const script = { language: "powershell" as const, code: 'Get-Thing -Name "x"', destructive: false };

	it("escapes the script so quotes cannot break out of the markup", () => {
		const html = scriptBlock("s1", { ...script, code: '<img src=x onerror=alert(1)> & "quoted"' });
		expect(html).not.toContain("<img src=x");
		expect(html).toContain("&lt;img");
		expect(html).toContain("&quot;");
	});

	it("warns on a tenant-changing block and states the effect", () => {
		const html = scriptBlock("s1", { ...script, destructive: true, effect: "Creates a DLP policy." });
		expect(html).toContain("script-warning");
		expect(html).toContain("Changes your tenant: Creates a DLP policy.");
	});

	it("does not warn on a read-only block", () => {
		expect(scriptBlock("s1", script)).not.toContain("script-warning");
	});

	it("offers copy, never run", () => {
		// Nothing here may execute a command that rewrites tenant policy, and a
		// button that looked like it might would be worse than useless.
		const html = scriptBlock("s1", script);
		expect(html).toContain("data-copy");
		expect(html).not.toMatch(/data-(run|execute)/);
	});
});

describe("stepCard", () => {
	const step = {
		id: "connect",
		kind: "prerequisite" as const,
		title: "Connect",
		body: ["Sign in first."],
		done: false,
	};

	it("renders the body only when open", () => {
		expect(stepCard(step, 0, false)).not.toContain("Sign in first.");
		expect(stepCard(step, 0, true)).toContain("Sign in first.");
	});

	it("reports expansion state for assistive tech", () => {
		expect(stepCard(step, 0, true)).toContain('aria-expanded="true"');
	});

	it("labels the checkbox as a claim, since nothing watches the terminal", () => {
		expect(stepCard(step, 0, true)).toContain("I ran this");
	});

	it("escapes a hostile title", () => {
		expect(stepCard({ ...step, title: "<script>x</script>" }, 0, false)).not.toContain("<script>x");
	});
});

describe("progressBar", () => {
	it("words progress as a claim rather than as fact", () => {
		expect(progressBar(3, 8)).toContain("3 of 8 steps marked done");
	});

	it("never divides by zero", () => {
		expect(progressBar(0, 0)).toContain("width:0%");
	});
});
