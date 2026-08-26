/**
 * Zero-dependency Microsoft Graph access for the canvas.
 *
 * The MCP server uses @azure/identity, but a canvas extension cannot: a plugin
 * install is a plain file copy, so node_modules never exists at runtime. This
 * module therefore shells out to the Azure CLI for a token and uses global
 * fetch — both available without any npm dependency.
 *
 * If the CLI is unavailable or not signed in, the canvas falls back to sample
 * data and says so in the UI. A security tool must never let you mistake demo
 * numbers for your tenant's real posture.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GRAPH = "https://graph.microsoft.com";

/** Acquire a delegated Graph token from the signed-in Azure CLI session. */
export async function getAzureCliToken() {
	try {
		const { stdout } = await execFileAsync(
			"az",
			["account", "get-access-token", "--resource", GRAPH, "--output", "json"],
			{ timeout: 20_000 },
		);
		const parsed = JSON.parse(stdout);
		return parsed.accessToken ?? null;
	} catch {
		return null;
	}
}

async function graphGet(token, path) {
	const res = await fetch(`${GRAPH}${path}`, {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/json",
			// Required for the agentIdentityBlueprintPrincipal enum member.
			Prefer: "include-unknown-enum-members",
		},
	});
	if (!res.ok) {
		let detail = `${res.status} ${res.statusText}`;
		try {
			const body = await res.json();
			if (body?.error?.message) detail = `${res.status} ${body.error.message}`;
		} catch {
			/* keep the status-derived message */
		}
		const err = new Error(detail);
		err.status = res.status;
		throw err;
	}
	return res.json();
}

/**
 * Load risky agents plus their detections.
 * Returns { agents, detections, live, note } so the UI can label its source.
 */
export async function loadTenantData({ limit = 25 } = {}) {
	const token = await getAzureCliToken();
	if (!token) {
		return {
			live: false,
			note: "Azure CLI not signed in — showing sample data. Run `az login` and reopen the canvas for live tenant data.",
			...SAMPLE_DATA,
		};
	}

	try {
		const filter = encodeURIComponent(
			"(riskLevel eq 'high' or riskLevel eq 'medium' or riskLevel eq 'low') and (riskState eq 'atRisk' or riskState eq 'confirmedCompromised')",
		);
		const page = await graphGet(token, `/beta/identityProtection/riskyAgents?$filter=${filter}&$top=${limit}`);
		const agents = page.value ?? [];

		const detections = {};
		for (const agent of agents) {
			try {
				const df = encodeURIComponent(`identityId eq '${String(agent.id).replace(/'/g, "''")}'`);
				const d = await graphGet(token, `/beta/identityProtection/agentRiskDetections?$filter=${df}&$top=10`);
				detections[agent.id] = d.value ?? [];
			} catch {
				detections[agent.id] = [];
			}
		}

		return {
			live: true,
			note:
				agents.length === 0
					? "Connected to your tenant. No agents currently match the risk filters."
					: `Live data from your tenant — ${agents.length} agent(s).`,
			agents,
			detections,
		};
	} catch (err) {
		const hint =
			err.status === 403
				? "Requires IdentityRiskyAgent.Read.All and a Security Reader/Operator/Administrator role."
				: err.status === 404
					? "The Graph beta agent risk APIs may not be enabled in this tenant."
					: "";
		return {
			live: false,
			note: `Graph request failed (${err.message}). ${hint} Showing sample data.`.trim(),
			...SAMPLE_DATA,
		};
	}
}

/**
 * Sample tenant used when Graph is unreachable. Clearly labeled in the UI.
 * Mirrors the real schema so the scoring path is identical either way.
 */
export const SAMPLE_DATA = {
	agents: [
		{
			id: "sample-invoice-bot",
			agentDisplayName: "Invoice Processing Bot",
			identityType: "agentIdentity",
			blueprintId: "bp-finance-001",
			riskLevel: "high",
			riskState: "atRisk",
			isEnabled: true,
		},
		{
			id: "sample-repo-agent",
			agentDisplayName: "Repo Maintenance Agent",
			identityType: "agentIdentity",
			blueprintId: "bp-devops-004",
			riskLevel: "high",
			riskState: "atRisk",
			isEnabled: true,
		},
		{
			id: "sample-support-triage",
			agentDisplayName: "Support Triage Assistant",
			identityType: "agentUser",
			riskLevel: "medium",
			riskState: "atRisk",
			isEnabled: true,
			isProcessing: true,
		},
		{
			id: "sample-doc-summarizer",
			agentDisplayName: "Document Summarizer",
			identityType: "agentIdentity",
			blueprintId: "bp-productivity-012",
			riskLevel: "low",
			riskState: "atRisk",
			isEnabled: true,
		},
	],
	detections: {
		"sample-invoice-bot": [
			{
				id: "det-1",
				riskEventType: "suspiciousCredentialUsage",
				riskLevel: "high",
				detectedDateTime: "2026-08-26T09:04:00Z",
				riskEvidence: "New client secret added to blueprint bp-finance-001 and used 4 minutes later.",
				identityId: "sample-invoice-bot",
			},
			{
				id: "det-2",
				riskEventType: "entraDirectoryReconnaissance",
				riskLevel: "medium",
				detectedDateTime: "2026-08-26T09:12:00Z",
				riskEvidence: "Enumerated 1,240 directory objects in 90 seconds.",
				identityId: "sample-invoice-bot",
			},
		],
		"sample-repo-agent": [
			{
				id: "det-3",
				riskEventType: "unfamiliarResourceAccess",
				riskLevel: "high",
				detectedDateTime: "2026-08-26T11:20:00Z",
				riskEvidence: "Accessed 3 repositories outside its established baseline.",
				identityId: "sample-repo-agent",
			},
			{
				id: "det-4",
				riskEventType: "failedAccessAttempt",
				riskLevel: "medium",
				detectedDateTime: "2026-08-26T11:25:00Z",
				riskEvidence: "17 failed token exchanges against Key Vault.",
				identityId: "sample-repo-agent",
			},
		],
		"sample-support-triage": [
			{
				id: "det-5",
				riskEventType: "signInSpike",
				riskLevel: "low",
				detectedDateTime: "2026-08-26T08:00:00Z",
				riskEvidence: "Sign-in volume 8x the 30-day baseline.",
				identityId: "sample-support-triage",
			},
		],
		"sample-doc-summarizer": [],
	},
};

/**
 * Illustrative blast-radius context for the sample agents only.
 * Never applied to live tenant data — that would fabricate evidence.
 */
export const SAMPLE_EXPOSURE = {
	"sample-invoice-bot": {
		dataExposure: { highestLabel: "Highly Confidential", labelIds: ["fin-conf"], dlpMatches: 3 },
	},
	"sample-repo-agent": {
		codeExposure: {
			writeRepos: ["contoso/payments-api", "contoso/internal-tools"],
			productionRepos: ["contoso/payments-api"],
			canApprovePullRequests: true,
		},
	},
};
