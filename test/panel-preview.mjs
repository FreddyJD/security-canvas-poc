/**
 * Serve the Agents panel against fixture data for eyeballing in a browser.
 *
 * Not a test — it exists so a change to the table can be looked at without a
 * tenant, a token, or a Copilot host. Filters, sorting, paging and the
 * investigate round-trip all work; the investigate prompt goes to stdout
 * instead of to a model.
 *
 * Run: node test/panel-preview.mjs [port]
 */
import { InventoryStore } from "../features/agent-inventory/usecases/store.mjs";
import { startInventoryServer } from "../features/agent-inventory/views/inventory-server.mjs";

process.env.SECURITY_CANVAS_TOKEN = "fake-token-for-preview";

const PLATFORMS = ["M365 Copilot", "Copilot Studio", "Endpoint", "Other"];
const RISKS = ["high", "high", "medium", "medium", "medium", "low", "low", "none", "none", "none"];
const OWNERS = [null, "Marie Methot", "Gowtham Animireddy", "Harry Nayyar", null, "Ana Maria Ruiz"];
const STATUSES = ["Active", "Active", "Disabled", "Inactive", "atRisk"];
const DAY = 86_400_000;

/** Deterministic, so a screenshot is comparable across runs. */
const pick = (arr, i) => arr[i % arr.length];

const agents = Array.from({ length: 137 }, (_, i) => {
	const risk = pick(RISKS, i * 3);
	const owner = pick(OWNERS, i * 2);
	return {
		agentId: `agent-${String(i).padStart(3, "0")}`,
		title: `${pick(["Invoice", "Support", "Writing", "Sales", "HR", "Deploy"], i)} ${pick(["Bot", "Agent", "Copilot", "Assistant"], i * 5)} ${i}`,
		publisher: pick(["Microsoft Corporation", "Contoso Ltd", "Fabrikam", "Northwind"], i),
		platform: pick(PLATFORMS, i),
		appType: i % 3 === 0 ? "firstParty" : "thirdParty",
		source: pick(["registered", "registry", "exposureGraph"], i),
		status: pick(STATUSES, i),
		owner,
		riskLevel: risk,
		publiclyExposed: i % 7 === 0 ? true : i % 5 === 0 ? false : null,
		unmonitored: i % 4 === 0,
		lastActivity: i % 4 === 0 ? null : new Date(Date.now() - (i % 300) * DAY).toISOString(),
		protection: { defender: i % 3 === 0, dlp: i % 5 === 0 ? null : i % 2 === 0 },
		blastRadius: { available: i % 6 === 0 },
		identity: {
			servicePrincipalId: owner ? `sp-${i}` : null,
			userId: null,
			coverageTarget: owner ? "servicePrincipal" : "none",
		},
	};
});

const countBy = (key) =>
	agents.reduce((acc, a) => ({ ...acc, [key(a)]: (acc[key(a)] ?? 0) + 1 }), {});

const repository = {
	listAgents: async () => ({
		metadata: { tenantId: "preview", collectedAt: new Date().toISOString(), generation: "1", schemaVersion: "3.0" },
		agents,
	}),
	getSummary: async () => ({
		metadata: { tenantId: "preview", collectedAt: new Date().toISOString(), generation: "1", schemaVersion: "3.0" },
		agents: {
			total: 789,
			atRisk: agents.length,
			riskSignals: {
				unowned: agents.filter((a) => !a.owner).length,
				publiclyExposed: agents.filter((a) => a.publiclyExposed === true).length,
				unmonitored: agents.filter((a) => a.unmonitored).length,
			},
			byRiskLevel: countBy((a) => a.riskLevel),
			byPlatform: countBy((a) => a.platform),
			bySource: countBy((a) => a.source),
		},
		protection: {
			defender: { protected: 46, unprotected: 91, notEvaluated: 0 },
			dlp: { protected: 40, unprotected: 70, notEvaluated: 27 },
		},
	}),
};

const ctx = {
	store: new InventoryStore(),
	repository,
	getSession: () => ({
		send: (m) => process.stdout.write(`\n--- prompt to model ---\n${m.prompt}\n\n`),
	}),
};

const panel = await startInventoryServer(ctx);
const { refreshInventory } = await import("../features/agent-inventory/usecases/inventory-browse.mjs");
await refreshInventory(ctx);

// Start on the risky view, which is what "show me the risky agents" produces.
if (process.argv.includes("--risky")) {
	ctx.store.setFilters({ risks: ["high", "medium"], platforms: [], search: "", slice: "all" });
	ctx.store.set({ sort: { column: "risk", descending: false } });
}

process.stdout.write(`Agents panel on http://127.0.0.1:${panel.port}\n`);
