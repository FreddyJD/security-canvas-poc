/**
 * Boots the real inventory panel against a stubbed repository and drives it
 * over HTTP, the way the browser does. Proves the wiring the unit tests cannot:
 * the routes exist, the SSE frame carries a renderable view model, and every
 * module the page imports is actually servable.
 *
 * Run: node test/panel-smoke.mjs
 */
import assert from "node:assert/strict";
import { InventoryStore } from "../features/agent-inventory/usecases/store.mjs";
import { startInventoryServer } from "../features/agent-inventory/views/inventory-server.mjs";

process.env.SECURITY_CANVAS_TOKEN = "fake-token-for-smoke";

const AGENTS = [
	{
		agentId: "a-high",
		title: "Invoice Bot",
		publisher: "Contoso",
		platform: "Copilot Studio",
		appType: "thirdParty",
		source: "registered",
		status: "Active",
		owner: null,
		riskLevel: "high",
		publiclyExposed: true,
		unmonitored: false,
		lastActivity: new Date().toISOString(),
		protection: { defender: false, dlp: null },
		blastRadius: { available: true },
		identity: { servicePrincipalId: "sp-1", userId: null, coverageTarget: "servicePrincipal" },
	},
	{
		agentId: "a-none",
		title: "Writing Coach",
		publisher: "Microsoft Corporation",
		platform: "M365 Copilot",
		appType: "firstParty",
		source: "registry",
		status: "Active",
		owner: "Marie Methot",
		riskLevel: "none",
		publiclyExposed: false,
		unmonitored: true,
		lastActivity: null,
		protection: { defender: true, dlp: true },
		blastRadius: { available: false },
		identity: { servicePrincipalId: null, userId: null, coverageTarget: "none" },
	},
];

const repository = {
	listAgents: async () => ({
		metadata: { tenantId: "t", collectedAt: "", generation: "", schemaVersion: "3.0" },
		agents: AGENTS,
	}),
	getSummary: async () => ({
		metadata: { tenantId: "t", collectedAt: "", generation: "", schemaVersion: "3.0" },
		agents: {
			total: 789,
			atRisk: 2,
			riskSignals: { unowned: 285, publiclyExposed: 1, unmonitored: 1 },
			byRiskLevel: { high: 3, none: 786 },
			byPlatform: { "M365 Copilot": 700, "Copilot Studio": 89 },
			bySource: { registered: 2 },
		},
		protection: {
			defender: { protected: 1, unprotected: 1, notEvaluated: 0 },
			dlp: { protected: 1, unprotected: 0, notEvaluated: 1 },
		},
	}),
};

const sent = [];
const ctx = { store: new InventoryStore(), repository, getSession: () => ({ send: (m) => sent.push(m) }) };
const panel = await startInventoryServer(ctx);
const base = `http://127.0.0.1:${panel.port}`;

const post = (path, body) =>
	fetch(`${base}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body ?? {}),
	});

/** Read exactly one SSE `state` frame, then hang up. */
async function readFrame() {
	const res = await fetch(`${base}/api/inventory/events`);
	const reader = res.body.getReader();
	let buf = "";
	while (!buf.includes("\n\n")) {
		const { value, done } = await reader.read();
		if (done) break;
		buf += new TextDecoder().decode(value);
	}
	await reader.cancel();
	return JSON.parse(buf.slice(buf.indexOf("data: ") + 6, buf.indexOf("\n\n")));
}

const check = [];
const ok = (name, fn) => {
	try {
		fn();
		check.push(`  ok  ${name}`);
	} catch (err) {
		check.push(`FAIL  ${name}\n      ${err.message}`);
		process.exitCode = 1;
	}
};

// --- the shell and every module the page imports ---------------------------
const shell = await (await fetch(`${base}/`)).text();
ok("shell renders the Agents title", () => assert.match(shell, /<h1>Agents<\/h1>/));

const modulePaths = [
	"/src/features/agent-inventory/views/client.mjs",
	"/src/features/agent-inventory/views/inventory-screen.mjs",
	"/src/features/agent-inventory/components/agent-table.mjs",
	"/src/features/agent-inventory/components/filter-bar.mjs",
	"/src/features/agent-inventory/components/metric-card.mjs",
	"/src/features/agent-inventory/domain/presentation.mjs",
	"/src/platform/html.mjs",
];
for (const p of modulePaths) {
	const res = await fetch(`${base}${p}`);
	ok(`serves ${p}`, () => assert.equal(res.status, 200));
}


const denied = await fetch(`${base}/src/platform/auth.mjs`);
ok("refuses platform/auth.mjs", () => assert.equal(denied.status, 404));

// --- the risky-agents entry point ------------------------------------------
const { createInventoryActions } = await import("../features/agent-inventory/tools/canvas-actions.mjs");
const actions = createInventoryActions(ctx);
const call = (name, input = {}) => actions.find((a) => a.name === name).handler({ input });

const summary = await call("show_risky_agents");
ok("show_risky_agents reports the estate total, not the row count", () =>
	assert.equal(summary.estateTotal, 789));
ok("show_risky_agents narrows to one matching row", () => assert.equal(summary.matchedCount, 1));

const frame = await readFrame();
ok("SSE frame carries only the risky row", () => {
	assert.equal(frame.rows.length, 1);
	assert.equal(frame.rows[0].agentId, "a-high");
});
ok("SSE frame is sorted worst-first", () => assert.equal(frame.sort.column, "risk"));
ok("SSE frame keeps the headline metrics whole-estate", () => {
	const total = frame.metrics.find((m) => m.id === "all");
	assert.equal(total.value, 789);
});

// --- the rendered HTML -----------------------------------------------------
const { renderInventory } = await import("../features/agent-inventory/views/inventory-screen.mjs");
const html = renderInventory(frame);
ok("renders the risky agent as an activatable row", () => {
	assert.match(html, /data-agent-id="a-high"/);
	assert.match(html, /role="button"/);
	assert.match(html, /aria-label="Investigate Invoice Bot"/);
});
ok("does not render the clean agent", () => assert.doesNotMatch(html, /Writing Coach/));
ok("keeps the scope note", () => assert.match(html, /flagged agents of 789/));

// --- the clean-tenant empty state ------------------------------------------
await post("/api/inventory/filter", { kind: "risk", value: "high" });
await post("/api/inventory/filter", { kind: "risk", value: "medium" });
await post("/api/inventory/filter", { kind: "risk", value: "low" });
const lowOnly = renderInventory(
	await import("../features/agent-inventory/usecases/inventory-browse.mjs").then((m) =>
		m.inventoryViewModel(ctx),
	),
);
ok("says nothing to triage rather than blaming the filter", () =>
	assert.match(lowOnly, /Nothing to triage/i));

// --- investigate round-trip ------------------------------------------------
await call("show_risky_agents");
const res = await post("/api/inventory/investigate", { agentId: "a-high" });
ok("investigate returns ok", () => assert.equal(res.status, 200));
ok("investigate pushes a grounded prompt back to chat", () => {
	assert.equal(sent.length, 1);
	assert.match(sent[0].prompt, /Invoice Bot/);
	assert.match(sent[0].prompt, /explain_agent_risk/);
});

const stale = await (await post("/api/inventory/investigate", { agentId: "gone" })).json();
ok("a stale investigate click is refused, not thrown", () => assert.equal(stale.ok, false));

// --- the route that used to 404 --------------------------------------------
const connect = await post("/api/connect");
ok("/api/connect is routed", () => assert.notEqual(connect.status, 404));

panel.close();
console.log(check.join("\n"));
console.log(process.exitCode ? "\nFAILED" : "\nAll panel checks passed.");
// The sign-in attempt opens a browser and holds a listener; exit regardless.
process.exit(process.exitCode ?? 0);
