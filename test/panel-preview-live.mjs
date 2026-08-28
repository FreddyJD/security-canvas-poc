/**
 * Serve the Agents panel against a captured `risk=true` catalog response.
 *
 * Not a test — it exists so the panel can be compared side by side with the
 * Security Unified UX Agents page without a tenant, a token, or a Copilot host.
 *
 * The seven rows below mirror the *shape and distribution* of a real
 * `GET /inventory/agents?api-version=2026-08-01&risk=true` response — three
 * high and four medium, one row on `servicePrincipal` coverage while the rest
 * are `agentUser`, one `Confirmed compromised`, `defender: null` throughout,
 * and `publiclyExposed` split across `false` and `null`. Those specifics are
 * the point: they are what the metric cards, the risk meter, the relative
 * "last used" column and the tri-state protection flags are read against.
 *
 * Identifiers, owner names and the tenant id are synthetic. This repository is
 * public, so no captured tenant data is committed to it — only the schema.
 *
 * Run: node test/panel-preview-live.mjs
 */
import { InventoryStore } from "../features/agent-inventory/usecases/store.mjs";
import { startInventoryServer } from "../features/agent-inventory/views/inventory-server.mjs";

process.env.SECURITY_CANVAS_TOKEN = "fake-token-for-preview";

const HOUR = 3_600_000;
const DAY = 86_400_000;

/**
 * Relative to now, so "Today" and "92d ago" stay true whenever this is run.
 *
 * @param {number} ms
 */
const ago = (ms) => new Date(Date.now() - ms).toISOString();

/**
 * Body of GET /inventory/agents?api-version=2026-08-01&risk=true.
 *
 * @type {import("../features/agent-inventory/domain/types.js").AgentCatalog}
 */
const RESPONSE = {
	metadata: {
		tenantId: "00000000-0000-0000-0000-000000000000",
		collectedAt: new Date().toISOString(),
		generation: "0000000000000000000000000000000f",
		schemaVersion: "3.0",
	},
	agents: [
		{
			agentId: "11111111-1111-1111-1111-111111111101",
			title: "Avery Quinn (helper - 550d)",
			publisher: "",
			platform: "Other",
			appType: "ThirdParty",
			source: "registered",
			status: "Active",
			owner: "Avery Quinn",
			riskLevel: "high",
			publiclyExposed: false,
			unmonitored: false,
			lastActivity: ago(18 * HOUR),
			protection: { defender: null, dlp: false },
			blastRadius: { available: true },
			identity: {
				servicePrincipalId: "11111111-1111-1111-1111-111111111101",
				userId: "11111111-1111-1111-1111-111111111101",
				coverageTarget: "agentUser",
			},
		},
		{
			agentId: "11111111-1111-1111-1111-111111111102",
			title: "Rowan Patel (helper - e1f1)",
			publisher: "",
			platform: "Other",
			appType: "ThirdParty",
			source: "registered",
			status: "At risk",
			owner: "Rowan Patel",
			riskLevel: "medium",
			publiclyExposed: false,
			unmonitored: false,
			lastActivity: ago(10 * HOUR),
			protection: { defender: null, dlp: false },
			blastRadius: { available: true },
			identity: {
				servicePrincipalId: "11111111-1111-1111-1111-111111111102",
				userId: "11111111-1111-1111-1111-111111111102",
				coverageTarget: "agentUser",
			},
		},
		{
			agentId: "11111111-1111-1111-1111-111111111103",
			title: "Mira Okonkwo (helper - 7976)",
			publisher: "",
			platform: "Other",
			appType: "ThirdParty",
			source: "registered",
			status: "At risk",
			owner: "Mira Okonkwo",
			riskLevel: "high",
			publiclyExposed: false,
			unmonitored: false,
			lastActivity: ago(10 * HOUR),
			protection: { defender: null, dlp: false },
			blastRadius: { available: true },
			identity: {
				servicePrincipalId: "11111111-1111-1111-1111-111111111103",
				userId: "11111111-1111-1111-1111-111111111103",
				coverageTarget: "agentUser",
			},
		},
		{
			agentId: "11111111-1111-1111-1111-111111111104",
			title: "Dev Sharma (helper - d950)",
			publisher: "",
			platform: "Other",
			appType: "ThirdParty",
			source: "registered",
			status: "At risk",
			owner: "Dev Sharma",
			riskLevel: "medium",
			publiclyExposed: false,
			unmonitored: false,
			lastActivity: ago(92 * DAY),
			protection: { defender: null, dlp: false },
			blastRadius: { available: true },
			identity: {
				servicePrincipalId: "11111111-1111-1111-1111-111111111104",
				userId: "11111111-1111-1111-1111-111111111104",
				coverageTarget: "agentUser",
			},
		},
		{
			agentId: "11111111-1111-1111-1111-111111111105",
			title: "Sasha Helper",
			publisher: "",
			platform: "Other",
			appType: "ThirdParty",
			source: "registered",
			status: "At risk",
			owner: "Sasha",
			riskLevel: "medium",
			// Never evaluated — must not render as "not exposed".
			publiclyExposed: null,
			unmonitored: false,
			lastActivity: ago(13 * DAY),
			protection: { defender: null, dlp: false },
			blastRadius: { available: false },
			identity: {
				servicePrincipalId: "11111111-1111-1111-1111-111111111105",
				userId: "11111111-1111-1111-1111-111111111105",
				coverageTarget: "agentUser",
			},
		},
		{
			agentId: "11111111-1111-1111-1111-111111111106",
			title: "Jun's agent for Bug Bash-f34d",
			publisher: "",
			platform: "Other",
			appType: "ThirdParty",
			source: "registered",
			status: "At risk",
			owner: "Jun",
			riskLevel: "medium",
			publiclyExposed: null,
			unmonitored: false,
			lastActivity: ago(14 * HOUR),
			protection: { defender: null, dlp: false },
			blastRadius: { available: false },
			identity: {
				servicePrincipalId: "11111111-1111-1111-1111-111111111106",
				userId: "11111111-1111-1111-1111-111111111106",
				coverageTarget: "agentUser",
			},
		},
		{
			agentId: "11111111-1111-1111-1111-111111111107",
			title: "OrionAAI",
			publisher: "",
			platform: "Other",
			appType: "ThirdParty",
			source: "registered",
			status: "Confirmed compromised",
			owner: "Robin Alvarez (PROTECTION) +1",
			riskLevel: "high",
			publiclyExposed: false,
			unmonitored: false,
			lastActivity: ago(58 * DAY),
			protection: { defender: null, dlp: false },
			blastRadius: { available: true },
			// The one row covered as a service principal rather than an agent user.
			identity: {
				servicePrincipalId: "11111111-1111-1111-1111-111111111107",
				userId: null,
				coverageTarget: "servicePrincipal",
			},
		},
	],
};

/**
 * The tenant-wide aggregate the seven rows are drawn from.
 *
 * The gap between `total` and the row count is the whole point of the summary
 * call: it is the only place the estate size is knowable, and it is what the
 * Total card's caption reports.
 *
 * @type {import("../features/agent-inventory/domain/types.js").InventorySummary}
 */
const SUMMARY = {
	metadata: RESPONSE.metadata,
	agents: {
		total: 789,
		atRisk: RESPONSE.agents.length,
		riskSignals: { unowned: 285, publiclyExposed: 0, unmonitored: 0 },
		byRiskLevel: { high: 3, medium: 4, low: 0, none: 782 },
		byPlatform: { "M365 Copilot": 700, Other: 89 },
		bySource: { registered: 789 },
	},
	protection: {
		defender: { protected: 0, unprotected: 0, notEvaluated: 789 },
		dlp: { protected: 0, unprotected: 789, notEvaluated: 0 },
	},
};

const repository = {
	listAgents: async () => RESPONSE,
	getSummary: async () => SUMMARY,
};

const ctx = {
	store: new InventoryStore(),
	repository,
	getSession: () => ({
		/** @param {{ prompt: string }} m */
		send: (m) => process.stdout.write(`\n--- prompt to model ---\n${m.prompt}\n\n`),
	}),
};

const panel = await startInventoryServer(ctx);
const { refreshInventory } = await import("../features/agent-inventory/usecases/inventory-browse.mjs");
await refreshInventory(ctx);

process.stdout.write(`Agents panel on http://127.0.0.1:${panel.port}\n`);
