/**
 * Zero-dependency Microsoft Graph access for the canvas.
 *
 * Token acquisition, in priority order:
 *
 *   1. SECURITY_CANVAS_TOKEN  — a Graph access token supplied directly.
 *   2. Device code            — via SECURITY_CANVAS_CLIENT_ID, cached on disk.
 *   3. Azure CLI              — `az account get-access-token`.
 *
 * Why device code is the default path: the Azure CLI is a first-party app
 * pre-authorized for only a fixed set of Graph scopes, and
 * IdentityRiskyAgent.Read.All is NOT among them. An `az` token therefore
 * returns 403 on riskyAgents no matter how privileged the signed-in user is
 * (AADSTS65002). Reading real agent risk requires an app registration that
 * declares the scope. See README "Real tenant data".
 *
 * The CLI path is kept as a fallback because it still works for tenants that
 * pre-authorize the scope, and it gives a better error than nothing.
 *
 * No npm dependencies: a Copilot plugin install is a plain file copy, so
 * node_modules never exists at runtime.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const execFileAsync = promisify(execFile);
const GRAPH = "https://graph.microsoft.com";
const SCOPES = "https://graph.microsoft.com/IdentityRiskyAgent.Read.All offline_access";

const CACHE_DIR = join(homedir(), ".copilot", "security-canvas");
const CACHE_FILE = join(CACHE_DIR, "token-cache.json");

/** Config comes from the environment so no tenant identifiers are committed. */
export function getConfig() {
	return {
		tenantId: process.env.SECURITY_CANVAS_TENANT_ID || "organizations",
		clientId: process.env.SECURITY_CANVAS_CLIENT_ID || "",
		directToken: process.env.SECURITY_CANVAS_TOKEN || "",
	};
}

// ---------------------------------------------------------------------------
// Token cache (0600, refresh-token aware)
// ---------------------------------------------------------------------------

function readCache() {
	try {
		return JSON.parse(readFileSync(CACHE_FILE, "utf8"));
	} catch {
		return null;
	}
}

function writeCache(data) {
	try {
		mkdirSync(CACHE_DIR, { recursive: true });
		// Tokens are bearer credentials — never world-readable.
		writeFileSync(CACHE_FILE, JSON.stringify(data), { mode: 0o600 });
	} catch {
		/* cache is an optimization; failure is non-fatal */
	}
}

async function tokenRequest(tenantId, body) {
	const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams(body),
	});
	return res.json();
}

/** Exchange a cached refresh token so the user is not re-prompted each session. */
async function refreshToken(tenantId, clientId, refresh_token) {
	const j = await tokenRequest(tenantId, {
		grant_type: "refresh_token",
		client_id: clientId,
		refresh_token,
		scope: SCOPES,
	});
	if (!j.access_token) return null;
	writeCache({
		accessToken: j.access_token,
		refreshToken: j.refresh_token || refresh_token,
		expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000,
		clientId,
		tenantId,
	});
	return j.access_token;
}

/**
 * Begin device-code sign-in. Returns the user-facing code immediately and a
 * promise that resolves once the user completes it, so the canvas can render
 * the code instead of blocking on a terminal prompt the user never sees.
 */
export async function beginDeviceCode(onPending) {
	const { tenantId, clientId } = getConfig();
	if (!clientId) throw new Error("SECURITY_CANVAS_CLIENT_ID is not set.");

	const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/devicecode`, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ client_id: clientId, scope: SCOPES }),
	});
	const d = await res.json();
	if (d.error) throw new Error(`${d.error}: ${d.error_description?.slice(0, 200)}`);

	onPending?.({ userCode: d.user_code, verificationUri: d.verification_uri, expiresIn: d.expires_in });

	const deadline = Date.now() + (d.expires_in ?? 900) * 1000;
	const interval = (d.interval ?? 5) * 1000;

	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, interval));
		const j = await tokenRequest(tenantId, {
			grant_type: "urn:ietf:params:oauth:grant-type:device_code",
			client_id: clientId,
			device_code: d.device_code,
		});
		if (j.access_token) {
			writeCache({
				accessToken: j.access_token,
				refreshToken: j.refresh_token,
				expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000,
				clientId,
				tenantId,
			});
			return j.access_token;
		}
		if (j.error !== "authorization_pending" && j.error !== "slow_down") {
			throw new Error(`${j.error}: ${j.error_description?.slice(0, 200)}`);
		}
	}
	throw new Error("Device code expired before sign-in completed.");
}

/** Azure CLI fallback. Cannot carry IdentityRiskyAgent.Read.All in most tenants. */
export async function getAzureCliToken() {
	try {
		const { tenantId } = getConfig();
		const args = ["account", "get-access-token", "--resource", GRAPH, "--output", "json"];
		if (tenantId && tenantId !== "organizations") args.push("--tenant", tenantId);
		const { stdout } = await execFileAsync("az", args, { timeout: 20_000 });
		return JSON.parse(stdout).accessToken ?? null;
	} catch {
		return null;
	}
}

/**
 * Best available token without prompting.
 * Returns null when interactive sign-in is required.
 */
export async function getToken() {
	const { directToken, clientId, tenantId } = getConfig();
	if (directToken) return directToken;

	const cached = readCache();
	if (cached?.accessToken && cached.expiresAt - 60_000 > Date.now()) return cached.accessToken;
	if (cached?.refreshToken) {
		const t = await refreshToken(cached.tenantId || tenantId, cached.clientId || clientId, cached.refreshToken);
		if (t) return t;
	}
	return getAzureCliToken();
}

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------

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
			if (body?.error?.message) detail = body.error.message;
		} catch {
			/* keep status-derived message */
		}
		const err = new Error(detail);
		err.status = res.status;
		throw err;
	}
	return res.json();
}

/**
 * Load risky agents plus their detections.
 * Returns { agents, detections, live, note, needsAuth } so the UI can label
 * its source and offer sign-in when required.
 */
export async function loadTenantData({ limit = 25 } = {}) {
	const { clientId } = getConfig();
	const token = await getToken();

	if (!token) {
		return {
			live: false,
			needsAuth: Boolean(clientId),
			note: clientId
				? "Not signed in. Use Connect to sign in and load live tenant data."
				: "SECURITY_CANVAS_CLIENT_ID is not set — showing sample data. See README: Real tenant data.",
			...SAMPLE_DATA,
		};
	}

	try {
		const filter = encodeURIComponent(
			"(riskLevel eq 'high' or riskLevel eq 'medium' or riskLevel eq 'low') and (riskState eq 'atRisk' or riskState eq 'confirmedCompromised')",
		);
		const page = await graphGet(token, `/beta/identityProtection/riskyAgents?$filter=${filter}&$top=${limit}`);
		const agents = page.value ?? [];

		// One tenant-wide detection query, then group locally. Far cheaper than
		// an N+1 per-agent fetch and avoids throttling on large tenants.
		const detections = {};
		try {
			const all = await graphGet(token, `/beta/identityProtection/agentRiskDetections?$top=200`);
			for (const d of all.value ?? []) {
				const key = d.identityId || d.agentId;
				if (!key) continue;
				(detections[key] ||= []).push(d);
			}
		} catch {
			/* detections are optional; agents still score on standing risk */
		}

		return {
			live: true,
			needsAuth: false,
			note:
				agents.length === 0
					? "Connected. No agents currently match the risk filters."
					: `Live tenant data — ${agents.length} agent(s).`,
			agents,
			detections,
		};
	} catch (err) {
		const hint =
			err.status === 403
				? "The token lacks IdentityRiskyAgent.Read.All. The Azure CLI cannot request this scope; use SECURITY_CANVAS_CLIENT_ID with an app registration."
				: err.status === 404
					? "The Graph beta agent risk APIs may not be enabled in this tenant."
					: err.status === 401
						? "Token expired. Use Connect to sign in again."
						: "";
		return {
			live: false,
			needsAuth: Boolean(clientId),
			note: `Graph request failed: ${err.message}. ${hint}`.trim(),
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
