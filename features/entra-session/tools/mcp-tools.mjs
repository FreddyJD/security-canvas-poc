/**
 * MCP tools for the Entra session.
 *
 * These exist only because a headless host has no canvas. In the Copilot app,
 * signing in is a button on the Agents panel and the token cache is invisible;
 * under a plain MCP client there is no panel to click, so the three things the
 * button implies — sign in, tell me who I am, forget me — have to become tools
 * the model can call.
 *
 * The sign-in flow itself is unchanged and lives in platform/auth.mjs: a
 * loopback listener plus PKCE, which works the same whether the process was
 * spawned by a canvas host or a stdio client, because it needs only a browser
 * and a free port.
 *
 * Sign-in is deliberately NOT automatic on a 401. A tool call that silently
 * opens a browser window is a surprising thing for an agent to do on your
 * behalf; the read tools instead report that sign-in is required and let the
 * model call `sign_in`, which is one extra turn and no surprises.
 */
import { getAzureCliToken, signIn, signOut, tokenStatus } from "../../../platform/auth.mjs";
import { CONFIG_DIR, getConfig, DEFAULT_CLIENT_ID } from "../../../platform/config.mjs";

/**
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 */
export function registerSessionTools(server) {
	// ---------------------------------------------------------------
	// sign_in — interactive browser sign-in
	// ---------------------------------------------------------------
	server.registerTool(
		"sign_in",
		{
			title: "Sign in to Microsoft Entra",
			description:
				"Sign in to Microsoft Entra so the agent security tools can read your tenant. Opens the system " +
				"browser for the standard Microsoft account picker and returns once you have signed in; the " +
				"credential is cached on this device, so this is normally a one-time step. " +
				"Call this when another tool reports that sign-in is required, or when the user asks to sign in or " +
				"to switch account. Requires a browser on this machine — for a headless or remote session, set the " +
				"SECURITY_CANVAS_TOKEN environment variable to a Microsoft Graph access token instead.",
			inputSchema: {},
			// Opens a browser and writes a credential to disk: not read-only, and
			// signing in twice is not the same as signing in once (the second run
			// re-prompts and can switch account), so it is not idempotent either.
			annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
		},
		async () => {
			try {
				await signIn();
				const { tenantId, clientId } = getConfig();
				const custom = clientId !== DEFAULT_CLIENT_ID ? ` using app registration ${clientId}` : "";
				return ok(
					`Signed in to Microsoft Entra${custom}. The credential is cached in ${CONFIG_DIR} and refreshes ` +
						`silently, so you should not have to sign in again on this device.`,
					{ signedIn: true, tenantId },
				);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: content(
						`Sign-in failed: ${message}\n\n${signInRemediation(message)}`,
					),
					isError: true,
				};
			}
		},
	);

	// ---------------------------------------------------------------
	// get_auth_status — "am I signed in, and with what?"
	// ---------------------------------------------------------------
	server.registerTool(
		"get_auth_status",
		{
			title: "Check Microsoft Entra sign-in status",
			description:
				"Report whether this session can read the tenant, and which credential it would use. " +
				"Call this first when a tool returns no agents or an authorization error, to tell 'signed out' " +
				"apart from 'signed in but missing a role or licence' — they look identical in the results but " +
				"need completely different fixes.",
			inputSchema: {},
			annotations: { readOnlyHint: true, openWorldHint: false },
		},
		async () => {
			const status = tokenStatus();
			const { tenantId, clientId } = getConfig();
			const app = clientId === DEFAULT_CLIENT_ID ? "the app registration shipped with the plugin" : clientId;

			if (status.state === "token") {
				return ok(
					"Signed in using a Microsoft Graph token supplied through SECURITY_CANVAS_TOKEN. " +
						"Its scopes and lifetime are whatever the issuer granted; this plugin cannot refresh it.",
					{ signedIn: true, source: "environment" },
				);
			}

			if (status.state === "cached" || status.state === "refreshable") {
				const expiry =
					status.state === "cached" && status.expiresAt
						? ` The current access token expires at ${new Date(status.expiresAt).toISOString()}, and refreshes silently.`
						: " The access token has expired but will be refreshed silently on the next call.";
				return ok(
					`Signed in to Microsoft Entra tenant '${status.tenantId ?? tenantId}' through ${app}.${expiry}\n\n` +
						"If reads still fail, the gap is authorization rather than authentication: this needs " +
						"IdentityRiskyAgent.Read.All consented in the tenant, a Security Reader-class directory role, " +
						"and Microsoft Agent 365 licensing.",
					{ signedIn: true, source: "cache", tenantId: status.tenantId ?? tenantId },
				);
			}

			// No cached credential. `az` may still work, so say so — but do not
			// oversell it: the CLI is a first-party app that is not pre-authorized
			// for IdentityRiskyAgent.Read.All in most tenants, so it typically
			// authenticates fine and then 403s on the risk data.
			const cli = await getAzureCliToken();
			if (cli) {
				return ok(
					"Not signed in to this plugin, but an Azure CLI session is available and will be used as a fallback.\n\n" +
						"That token usually cannot read agent risk: the Azure CLI is not pre-authorized for " +
						"IdentityRiskyAgent.Read.All in most tenants, so calls return 403 (AADSTS65002) however " +
						"privileged the account is. Call sign_in for a credential that carries the scope.",
					{ signedIn: false, source: "azure-cli" },
				);
			}

			return ok(
				"Not signed in. Call sign_in to open the Microsoft account picker in your browser, or set " +
					"SECURITY_CANVAS_TOKEN to a Microsoft Graph access token for a headless session.",
				{ signedIn: false, source: "none" },
			);
		},
	);

	// ---------------------------------------------------------------
	// sign_out — forget the cached credential
	// ---------------------------------------------------------------
	server.registerTool(
		"sign_out",
		{
			title: "Sign out of Microsoft Entra",
			description:
				"Forget the Microsoft Entra credential cached on this device. Use when the user asks to sign out " +
				"or to switch to a different account or tenant. Does not clear a token supplied through " +
				"SECURITY_CANVAS_TOKEN, which is controlled by the environment rather than by this plugin.",
			inputSchema: {},
			// Destructive only in the sense that it drops a credential; signing out
			// twice lands in the same place, so it is idempotent.
			annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
		},
		async () => {
			const existed = signOut();
			const { directToken } = getConfig();
			const caveat = directToken
				? "\n\nNote: SECURITY_CANVAS_TOKEN is still set in the environment and will continue to be used. " +
					"Unset it in the host configuration to fully sign out."
				: "";
			return ok(
				existed
					? `Signed out. The cached credential in ${CONFIG_DIR} has been removed.${caveat}`
					: `There was no cached credential to remove.${caveat}`,
				{ signedOut: existed },
			);
		},
	);
}

/**
 * Turn an Entra failure into the one thing the user should try next.
 *
 * Entra's error text is written for developers debugging an app registration,
 * not for an analyst who just wanted to see their agents, so the raw message is
 * kept (it is the only way to look the failure up) and a plain-language next
 * step is added under it.
 *
 * @param {string} message
 */
function signInRemediation(message) {
	const m = message.toLowerCase();

	if (m.includes("timed out")) {
		return (
			"The browser window was not completed within five minutes. Call sign_in again, and if no browser " +
			"opened — common over SSH or in a container — set SECURITY_CANVAS_TOKEN to a Microsoft Graph access " +
			"token instead."
		);
	}
	if (m.includes("aadsts65001") || m.includes("consent")) {
		return (
			"The tenant has not consented to IdentityRiskyAgent.Read.All for this application. A Global " +
			"Administrator or Privileged Role Administrator needs to grant admin consent before the risk data " +
			"can be read."
		);
	}
	if (m.includes("aadsts50020") || m.includes("aadsts50128") || m.includes("aadsts50011")) {
		return (
			"The account or redirect URI was rejected for this app registration. If you are using your own " +
			"app registration, confirm it is a public client with http://localhost registered as a redirect URI, " +
			"and that the account belongs to the configured tenant."
		);
	}
	if (m.includes("state mismatch")) {
		return (
			"The sign-in callback did not match the request that started it, so it was rejected. This is the " +
			"CSRF guard doing its job — usually a stale browser tab from an earlier attempt. Close any leftover " +
			"sign-in tabs and call sign_in again."
		);
	}
	return "Call sign_in again. If it keeps failing, get_auth_status reports which credential the plugin can see.";
}

/**
 * Wrap text in the MCP content envelope.
 *
 * The literal type annotation is load-bearing: the SDK's result type requires
 * the literal "text", and an unannotated object literal widens `type` to
 * `string`, which fails to typecheck at every registerTool call site.
 *
 * @param {string} text
 * @returns {[{ type: "text", text: string }]}
 */
function content(text) {
	return [{ type: "text", text }];
}

/**
 * @param {string} text
 * @param {Record<string, unknown>} structured
 */
function ok(text, structured) {
	return { content: content(text), structuredContent: structured };
}
