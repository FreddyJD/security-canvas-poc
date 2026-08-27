/**
 * Microsoft Entra authentication — browser sign-in, token cache, CLI fallback.
 *
 * Token acquisition, in priority order:
 *
 *   1. SECURITY_CANVAS_TOKEN  — a Graph access token supplied directly.
 *   2. Cached token           — refreshed silently while the refresh token lives.
 *   3. Azure CLI              — `az account get-access-token`.
 *   4. Interactive sign-in    — only when a caller explicitly asks.
 *
 * Why the CLI is only a fallback: the Azure CLI is a first-party app
 * pre-authorized for a fixed set of Graph scopes, and
 * IdentityRiskyAgent.Read.All is NOT among them. An `az` token therefore
 * returns 403 on riskyAgents no matter how privileged the signed-in user is
 * (AADSTS65002). Reading real agent risk requires an app registration that
 * declares the scope. The CLI path is kept because it still works for tenants
 * that pre-authorize the scope, and it gives a better error than nothing.
 *
 * No npm dependencies: a Copilot plugin install is a plain file copy, so
 * node_modules never exists at runtime.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { CACHE_FILE, CONFIG_DIR, GRAPH_BASE, SCOPES, getConfig } from "./config.mjs";
import { themeDeclarations, themeVariables } from "./design-tokens.mjs";
import { esc } from "./html.mjs";

const execFileAsync = promisify(execFile);

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

/** @param {Record<string, unknown>} data */
function writeCache(data) {
	try {
		mkdirSync(CONFIG_DIR, { recursive: true });
		// Tokens are bearer credentials — never world-readable.
		writeFileSync(CACHE_FILE, JSON.stringify(data), { mode: 0o600 });
	} catch {
		/* cache is an optimization; failure is non-fatal */
	}
}

/**
 * @param {string} tenantId
 * @param {Record<string, string>} body
 */
async function tokenRequest(tenantId, body) {
	const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams(body),
	});
	return res.json();
}

/**
 * Exchange a cached refresh token so the user is not re-prompted each session.
 * @param {string} tenantId
 * @param {string} clientId
 * @param {string} refresh_token
 */
async function refreshToken(tenantId, clientId, refresh_token) {
	const j = /** @type {any} */ (await tokenRequest(tenantId, {
		grant_type: "refresh_token",
		client_id: clientId,
		refresh_token,
		scope: SCOPES,
	}));
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
 *
 * @returns {Promise<string>} the access token
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
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			resolve(typeof address === "object" && address ? address.port : 0);
		});
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

	/** @type {Promise<string>} */
	const codePromise = new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			server.close();
			reject(new Error("Sign-in timed out."));
		}, 300_000);

		server.on("request", (req, res) => {
			const url = new URL(req.url ?? "/", redirectUri);
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

	const j = /** @type {any} */ (await tokenRequest(tenantId, {
		grant_type: "authorization_code",
		client_id: clientId,
		code,
		redirect_uri: redirectUri,
		code_verifier: verifier,
	}));
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

/**
 * Open a URL in the user's default browser, cross-platform.
 * @param {string} url
 */
function openBrowser(url) {
	const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "rundll32" : "xdg-open";
	const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
	execFile(cmd, args, () => {
		/* if the browser cannot be launched, the timeout surfaces it */
	});
}

/**
 * Minimal page shown in the browser tab once the redirect lands.
 *
 * Themed from the same Lithium tokens as the canvas panels, because this is the
 * *first* Microsoft surface a new user sees — it renders before any panel does,
 * and a GitHub-dark sign-in page followed by a Lithium canvas reads as two
 * different products.
 *
 * It inlines the token block rather than linking `/app.css`: this page is served
 * by the throwaway loopback listener that exists only for the OAuth redirect, on
 * a different origin from the canvas, and it is destroyed the moment the code is
 * received. A stylesheet link would race that teardown and render unstyled.
 *
 * `prefers-color-scheme` rather than the canvas's `data-theme`: there is no
 * `localStorage` on this origin to read the reader's choice from, and no toggle
 * to offer on a tab that closes itself.
 *
 * @param {string | null} error
 */
function closingPage(error) {
	const ok = !error;
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><title>Security Canvas</title>
<style>${themeVariables()}
@media (prefers-color-scheme: dark) { :root { ${themeDeclarations("dark")} } }
body{font:var(--fontSizeBase300)/var(--lineHeightBase300) var(--fontFamilyBase);
background:var(--canvas-page-background);color:var(--colorNeutralForeground1);
height:100vh;margin:0;display:flex;flex-direction:column;align-items:center;
justify-content:center;gap:var(--spacingVerticalS)}
h1{font-size:var(--fontSizeBase500);font-weight:var(--fontWeightSemibold);margin:0}
p{color:var(--colorNeutralForeground2);font-size:var(--fontSizeBase200);margin:0;
max-width:32rem;text-align:center}
.e{color:var(--colorStatusDangerForeground1)}</style></head><body>
<h1 class="${ok ? "" : "e"}">${ok ? "Signed in" : "Sign-in failed"}</h1>
<p>${ok ? "You can close this tab and return to Security Canvas." : esc(String(error).slice(0, 300))}</p>
</body></html>`;
}

/** Azure CLI fallback. Cannot carry IdentityRiskyAgent.Read.All in most tenants. */
export async function getAzureCliToken() {
	try {
		const { tenantId } = getConfig();
		const args = ["account", "get-access-token", "--resource", GRAPH_BASE, "--output", "json"];
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
 *
 * @returns {Promise<string | null>}
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

/**
 * The credential shape the Graph client depends on.
 *
 * Deliberately a bare function rather than a class: it keeps the client
 * testable with a one-line fake and keeps `@azure/identity` out of the
 * dependency graph, which is what allows the canvas to run without
 * node_modules.
 *
 * A provider may return a bare token string or a token/expiry pair. The pair
 * lets the client cache until real expiry; a bare string carries no expiry, so
 * the client treats it as short-lived rather than pinning a stale credential.
 *
 * @typedef {{ token: string, expiresOnTimestamp: number }} ExpiringToken
 * @typedef {() => Promise<string | ExpiringToken | null>} TokenProvider
 *
 * @type {TokenProvider}
 */
export const defaultTokenProvider = getToken;
