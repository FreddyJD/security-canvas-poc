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
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";

const execFileAsync = promisify(execFile);
const GRAPH = "https://graph.microsoft.com";
const SCOPES = "https://graph.microsoft.com/IdentityRiskyAgent.Read.All offline_access";

const CONFIG_DIR = join(homedir(), ".copilot", "security-canvas");
const CACHE_FILE = join(CONFIG_DIR, "token-cache.json");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const CACHE_DIR = CONFIG_DIR;

/**
 * Configuration, resolved from disk first and environment second.
 *
 * Disk matters because the Copilot app launches extensions without the user's
 * shell environment: variables exported in a terminal are simply not visible
 * here. Requiring env vars would mean the canvas can never be configured from
 * inside the app. The Azure DevOps plugin persists its connection the same way
 * (~/.copilot/azure-devops-canvas/connection.json).
 *
 * Environment still wins for CI and scripted use.
 */
export function readConfigFile() {
	try {
		return JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
	} catch {
		return {};
	}
}

export function writeConfigFile(patch) {
	const merged = { ...readConfigFile(), ...patch };
	mkdirSync(CONFIG_DIR, { recursive: true });
	writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), { mode: 0o600 });
	return merged;
}

/**
 * Default app registration shipped with the canvas.
 *
 * A public client holds no secret, so publishing the id is safe and standard —
 * it is what makes "click Sign in" possible instead of asking every user to
 * paste a GUID. Organizations that want their own registration override it
 * with SECURITY_CANVAS_CLIENT_ID or the config file.
 */
export const DEFAULT_CLIENT_ID = "6a1c8299-2186-4524-b93c-fdcb3f5d5ba7";

export function getConfig() {
	const file = readConfigFile();
	return {
		// "organizations" lets any work or school account sign in.
		tenantId: process.env.SECURITY_CANVAS_TENANT_ID || file.tenantId || "organizations",
		clientId: process.env.SECURITY_CANVAS_CLIENT_ID || file.clientId || DEFAULT_CLIENT_ID,
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
 * Interactive browser sign-in (authorization code + PKCE).
 *
 * Opens the system browser, listens on a loopback port for the redirect, and
 * closes the loop itself. The user clicks one button and signs in with the
 * account picker they already know — no codes to copy, nothing to paste.
 *
 * Entra ignores the port for http://localhost redirect URIs on public clients,
 * so a single registered "http://localhost" works with an ephemeral port.
 * PKCE means no client secret is needed, which is what lets this ship as a
 * public client.
 */
export async function signIn() {
	const { tenantId, clientId } = getConfig();

	const verifier = randomBytes(32).toString("base64url");
	const challenge = createHash("sha256").update(verifier).digest("base64url");
	const expectedState = randomBytes(16).toString("base64url");

	// Bind to a free port first: the redirect URI must include it.
	const server = http.createServer();
	const port = await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => resolve(server.address().port));
	});
	const redirectUri = `http://localhost:${port}`;

	const authUrl =
		`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?` +
		new URLSearchParams({
			client_id: clientId,
			response_type: "code",
			redirect_uri: redirectUri,
			response_mode: "query",
			scope: SCOPES,
			state: expectedState,
			code_challenge: challenge,
			code_challenge_method: "S256",
			// Always show the picker: a security tool should never silently
			// reuse whichever account happens to be cached in the browser.
			prompt: "select_account",
		});

	const codePromise = new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			server.close();
			reject(new Error("Sign-in timed out."));
		}, 300_000);

		server.on("request", (req, res) => {
			const url = new URL(req.url, redirectUri);
			const code = url.searchParams.get("code");
			const error = url.searchParams.get("error");
			const state = url.searchParams.get("state");

			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			res.end(closingPage(error ? url.searchParams.get("error_description") || error : null));

			clearTimeout(timer);
			server.close();

			if (error) return reject(new Error(url.searchParams.get("error_description") || error));
			// Reject a mismatched state: this is the CSRF guard for the callback.
			if (state !== expectedState) return reject(new Error("State mismatch on sign-in callback."));
			if (!code) return reject(new Error("No authorization code returned."));
			resolve(code);
		});
	});

	openBrowser(authUrl);
	const code = await codePromise;

	const j = await tokenRequest(tenantId, {
		grant_type: "authorization_code",
		client_id: clientId,
		code,
		redirect_uri: redirectUri,
		code_verifier: verifier,
	});
	if (!j.access_token) {
		throw new Error(j.error_description?.split("\n")[0] || j.error || "Token exchange failed.");
	}

	writeCache({
		accessToken: j.access_token,
		refreshToken: j.refresh_token,
		expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000,
		clientId,
		tenantId,
	});
	return j.access_token;
}

/** Open a URL in the user's default browser, cross-platform. */
function openBrowser(url) {
	const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "rundll32" : "xdg-open";
	const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
	execFile(cmd, args, () => {
		/* if the browser cannot be launched, the timeout surfaces it */
	});
}

/** Minimal page shown in the browser tab once the redirect lands. */
function closingPage(error) {
	const ok = !error;
	return `<!doctype html><html><head><meta charset="utf-8"/><title>Security Canvas</title>
<style>body{font:15px/1.6 ui-sans-serif,system-ui,-apple-system,sans-serif;background:#0d1117;
color:#e6edf3;height:100vh;margin:0;display:flex;flex-direction:column;align-items:center;
justify-content:center;gap:10px}h1{font-size:17px;font-weight:600}p{color:#8b949e;font-size:13px}
.e{color:#f85149}</style></head><body>
<h1 class="${ok ? "" : "e"}">${ok ? "Signed in" : "Sign-in failed"}</h1>
<p>${ok ? "You can close this tab and return to Security Canvas." : String(error).slice(0, 300)}</p>
</body></html>`;
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
			note: "",
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
