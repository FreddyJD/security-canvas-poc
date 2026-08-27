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
 *
 * Returns a discriminated result rather than ever fabricating agents:
 *   { status: "needs-config" }        no client id set
 *   { status: "needs-auth" }          client id set, no usable token
 *   { status: "error", note, hint }   Graph refused
 *   { status: "connected", agents }   real tenant data
 *
 * There is deliberately no sample or demo mode. A security console that can
 * show invented agents is worse than one that shows nothing: an analyst who
 * mistakes placeholder rows for their tenant draws exactly the wrong
 * conclusion, and the failure is silent.
 */
export async function loadTenantData({ limit = 25 } = {}) {
	const { clientId } = getConfig();

	if (!clientId) {
		return {
			status: "needs-config",
			note: "Set SECURITY_CANVAS_CLIENT_ID to an app registration that declares IdentityRiskyAgent.Read.All.",
			agents: [],
			detections: {},
		};
	}

	const token = await getToken();
	if (!token) {
		return {
			status: "needs-auth",
			note: "Sign in to load risky agents from your tenant.",
			agents: [],
			detections: {},
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
			status: "connected",
			note:
				agents.length === 0
					? "Connected. No agents currently match the risk filters."
					: `${agents.length} agent(s) at risk.`,
			agents,
			detections,
		};
	} catch (err) {
		// 401 means the cached token died; treat it as a sign-in prompt rather
		// than an error the user cannot act on.
		if (err.status === 401) {
			return { status: "needs-auth", note: "Session expired. Sign in again.", agents: [], detections: {} };
		}
		const hint =
			err.status === 403
				? "The token lacks IdentityRiskyAgent.Read.All. Confirm admin consent was granted for the app registration, and that you hold a Security Reader, Security Operator, or Security Administrator role."
				: err.status === 404
					? "The Graph beta agent risk APIs may not be enabled in this tenant. Microsoft Agent 365 licensing is required."
					: err.status === 429
						? "Throttled by Microsoft Graph. Wait a moment and retry."
						: "";
		return { status: "error", note: err.message, hint, agents: [], detections: {} };
	}
}
