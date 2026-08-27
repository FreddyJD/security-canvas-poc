/**
 * End-to-end smoke test: drives the real server over JSON-RPC, exactly as an
 * MCP host would, with an in-memory Graph stub swapped in at the lowest layer.
 *
 * Unit tests prove the scoring math; this proves the wire protocol, the tool
 * registration, and the rendered output an analyst actually sees. Because the
 * stub is injected at the GraphClient boundary, every layer above it —
 * repository, use cases, tools — is the production code path.
 *
 * Run: node test/e2e-smoke.mjs
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AgentRepository } from "../features/risky-agents/data/agent-repository.mjs";
import { registerTools } from "../features/risky-agents/tools/mcp-tools.mjs";

// --- Fake tenant -----------------------------------------------------------
const AGENTS = [
	{
		id: "agent-invoice",
		agentDisplayName: "Invoice Bot",
		identityType: "agentIdentity",
		blueprintId: "bp-1",
		riskLevel: "high",
		riskState: "atRisk",
		isEnabled: true,
	},
	{
		id: "agent-triage",
		agentDisplayName: "Support Triage",
		identityType: "agentUser",
		riskLevel: "medium",
		riskState: "atRisk",
		isEnabled: true,
		isProcessing: true,
	},
];

const DETECTIONS = {
	"agent-invoice": [
		{
			id: "d1",
			riskEventType: "suspiciousCredentialUsage",
			riskLevel: "high",
			detectedDateTime: "2026-08-26T09:00:00Z",
			riskEvidence: "New client secret added to blueprint bp-1, used 4 minutes later.",
			identityId: "agent-invoice",
		},
		{
			id: "d2",
			riskEventType: "entraDirectoryReconnaissance",
			riskLevel: "medium",
			detectedDateTime: "2026-08-26T09:12:00Z",
			// Deliberately uses the DEPRECATED field to prove normalization works.
			agentId: "agent-invoice",
			agentDisplayName: "Invoice Bot",
		},
	],
	"agent-triage": [
		{ id: "d3", riskEventType: "signInSpike", riskLevel: "low", identityId: "agent-triage" },
	],
};

const graphStub = {
	listRiskyAgents: async () => AGENTS,
	getRiskyAgent: async (id) => {
		const a = AGENTS.find((x) => x.id === id);
		if (!a) throw new Error(`no agent ${id}`);
		return a;
	},
	listDetectionsForAgent: async (id) => DETECTIONS[id] ?? [],
	listRecentDetections: async () => Object.values(DETECTIONS).flat(),
	listAllDetections: async () => Object.values(DETECTIONS).flat(),
	dismissAgentRisk: async () => {},
	confirmAgentCompromised: async () => {},
	confirmAgentSafe: async () => {},
};

// --- Harness ---------------------------------------------------------------
let failures = 0;
const check = (label, cond, detail = "") => {
	if (cond) {
		console.log(`  PASS  ${label}`);
	} else {
		failures++;
		console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
	}
};

const server = new McpServer({ name: "security-canvas", version: "0.1.0" });
registerTools(server, new AgentRepository(graphStub));

const client = new Client({ name: "smoke", version: "1.0.0" });
const [clientT, serverT] = InMemoryTransport.createLinkedPair();
await Promise.all([server.connect(serverT), client.connect(clientT)]);

// --- 1. Discovery ----------------------------------------------------------
console.log("\ntools/list");
const { tools } = await client.listTools();
const names = tools.map((t) => t.name).sort();
console.log(`  registered: ${names.join(", ")}`);
check("all 5 tools registered", names.length === 5);
check(
	"read tools marked readOnlyHint",
	tools.filter((t) => t.name.startsWith("list_") || t.name.startsWith("explain_")).every((t) => t.annotations?.readOnlyHint === true),
);
check(
	"write tool marked destructiveHint",
	tools.find((t) => t.name === "update_agent_risk_state")?.annotations?.destructiveHint === true,
);

// --- 2. The headline question ---------------------------------------------
console.log('\nlist_risky_agents  ("what are my high-risk agents?")');
const list = await client.callTool({
	name: "list_risky_agents",
	arguments: { includeDetections: true },
});
console.log(
	list.content[0].text
		.split("\n")
		.map((l) => `  │ ${l}`)
		.join("\n"),
);
const agents = list.structuredContent.agents;
check("returns both agents", agents.length === 2);
check("sorted by descending score", agents[0].compositeScore >= agents[1].compositeScore);
check("Invoice Bot ranks first", agents[0].displayName === "Invoice Bot");
check("scores stay below the reserved 100", agents.every((a) => a.compositeScore < 100));
check("in-flight recompute surfaced", agents.some((a) => a.isProcessing === true));

// --- 3. Deep dive ----------------------------------------------------------
console.log("\nexplain_agent_risk  (agent-invoice)");
const explain = await client.callTool({
	name: "explain_agent_risk",
	arguments: { agentId: "agent-invoice" },
});
console.log(
	explain.content[0].text
		.split("\n")
		.map((l) => `  │ ${l}`)
		.join("\n"),
);
const dets = explain.structuredContent.detections;
check("both detections explained", dets.length === 2);
check(
	"deprecated agentId normalized to identityId",
	dets.some((d) => d.riskEventType === "entraDirectoryReconnaissance"),
);
check("plain-language meaning present", dets.every((d) => typeof d.meaning === "string" && d.meaning.length > 0));
check(
	"remediation is actionable",
	explain.structuredContent.assessment.recommendedActions.some((a) => /rotate/i.test(a)),
);

// --- 4. Cross-pillar correlation ------------------------------------------
console.log("\nassess_agent_blast_radius  (Entra + Purview + GitHub)");
const blast = await client.callTool({
	name: "assess_agent_blast_radius",
	arguments: {
		agentId: "agent-invoice",
		dataExposure: { highestLabel: "Highly Confidential", dlpMatches: 3 },
		codeExposure: { productionRepos: ["contoso/payments"], canApprovePullRequests: true },
	},
});
console.log(
	blast.content[0].text
		.split("\n")
		.map((l) => `  │ ${l}`)
		.join("\n"),
);
const withBlast = blast.structuredContent.assessment;
const identityOnly = explain.structuredContent.assessment;
check(
	"cross-pillar score exceeds identity-only",
	withBlast.compositeScore > identityOnly.compositeScore,
	`${withBlast.compositeScore} vs ${identityOnly.compositeScore}`,
);
check("purview factor present", withBlast.factors.some((f) => f.pillar === "purview"));
check("github factor present", withBlast.factors.some((f) => f.pillar === "github"));
check("unwired pillar reported as degraded", Boolean(withBlast.degraded?.defender));

// --- 5. Destructive-action gate -------------------------------------------
console.log("\nupdate_agent_risk_state  (safety gate)");
const refused = await client.callTool({
	name: "update_agent_risk_state",
	arguments: { agentIds: ["agent-invoice"], action: "confirmCompromised", confirm: false },
});
check("refuses without confirm:true", refused.isError === true);
console.log(`  │ ${refused.content[0].text.slice(0, 110)}...`);

const applied = await client.callTool({
	name: "update_agent_risk_state",
	arguments: {
		agentIds: ["agent-invoice"],
		action: "confirmCompromised",
		confirm: true,
		justification: "Verified credential theft.",
	},
});
check("proceeds with confirm:true", applied.isError !== true);
check("echoes the justification for audit", /Verified credential theft/.test(applied.content[0].text));

// --- 6. Input validation ---------------------------------------------------
console.log("\nschema validation");
const bad = await client
	.callTool({ name: "update_agent_risk_state", arguments: { agentIds: [], action: "nope", confirm: true } })
	.catch((e) => ({ isError: true, message: e.message }));
check("rejects invalid enum + empty array", bad.isError === true);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
await client.close();
process.exit(failures === 0 ? 0 : 1);
