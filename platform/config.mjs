/**
 * Where the canvas and the MCP server persist configuration.
 *
 * Disk matters because the Copilot app launches extensions without the user's
 * shell environment: variables exported in a terminal are simply not visible
 * here. Requiring env vars would mean the canvas can never be configured from
 * inside the app. The Azure DevOps plugin persists its connection the same way
 * (~/.copilot/azure-devops-canvas/connection.json).
 *
 * Environment still wins for CI and scripted use.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The directory the token cache and config file live in.
 *
 * Claude Code copies a plugin into a *versioned* cache directory and installs a
 * fresh copy on every update, so anything written next to the code is lost the
 * next time the plugin updates. It passes `${CLAUDE_PLUGIN_DATA}` for exactly
 * this: a directory that outlives any single version. The plugin's MCP config
 * forwards it as SECURITY_CANVAS_DATA_DIR.
 *
 * The desktop host bridge does *not* expand it — it logs "the desktop host
 * bridge has no project or plugin-data directory; left unexpanded" and passes
 * the literal `${CLAUDE_PLUGIN_DATA}` through. Taking that at face value would
 * create a directory with that name in the process's cwd and, worse, split the
 * sign-in: Claude Code would cache a token in one place and Cowork in another,
 * so signing in on one would look like being signed out on the other. Anything
 * still carrying `${` therefore falls back to the shared default.
 *
 * Unset everywhere else, so the Copilot app and a plain `node mcp.mjs` keep
 * using ~/.copilot/security-canvas and an existing sign-in survives.
 */
export const CONFIG_DIR = resolveDataDir();

function resolveDataDir() {
	const raw = process.env.SECURITY_CANVAS_DATA_DIR;
	if (!raw || raw.includes("${")) return join(homedir(), ".copilot", "security-canvas");
	return raw;
}
export const CONFIG_FILE = join(CONFIG_DIR, "config.json");
export const CACHE_FILE = join(CONFIG_DIR, "token-cache.json");

/**
 * Default app registration shipped with the canvas.
 *
 * A public client holds no secret, so publishing the id is safe and standard —
 * it is what makes "click Sign in" possible instead of asking every user to
 * paste a GUID. Organizations that want their own registration override it
 * with SECURITY_CANVAS_CLIENT_ID or the config file.
 */
export const DEFAULT_CLIENT_ID = "6a1c8299-2186-4524-b93c-fdcb3f5d5ba7";

export const GRAPH_BASE = process.env.GRAPH_BASE_URL || "https://graph.microsoft.com";
export const SCOPES = "https://graph.microsoft.com/IdentityRiskyAgent.Read.All offline_access";

/** @returns {Record<string, string>} */
export function readConfigFile() {
	try {
		return JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
	} catch {
		return {};
	}
}

/**
 * @param {Record<string, string>} patch
 * @returns {Record<string, string>}
 */
export function writeConfigFile(patch) {
	const merged = { ...readConfigFile(), ...patch };
	mkdirSync(CONFIG_DIR, { recursive: true });
	writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), { mode: 0o600 });
	return merged;
}

/**
 * Read an environment variable, treating an unresolved placeholder as unset.
 *
 * Claude Code substitutes `${user_config.KEY}` in the plugin's MCP `env` block.
 * A blank optional value can arrive as an empty string or, depending on the
 * client version, as the literal placeholder text. Passing "${user_config.
 * client_id}" to Entra as a client id fails with an opaque AADSTS error, so
 * anything still carrying `${` is treated as absent and the default applies.
 *
 * @param {string} name
 * @returns {string}
 */
function env(name) {
	const raw = process.env[name];
	if (!raw || raw.includes("${")) return "";
	return raw.trim();
}

/**
 * Effective configuration: disk first, environment second.
 * @returns {{ tenantId: string, clientId: string, directToken: string }}
 */
export function getConfig() {
	const file = readConfigFile();
	return {
		// "organizations" lets any work or school account sign in.
		tenantId: env("SECURITY_CANVAS_TENANT_ID") || file.tenantId || "organizations",
		clientId: env("SECURITY_CANVAS_CLIENT_ID") || file.clientId || DEFAULT_CLIENT_ID,
		directToken: env("SECURITY_CANVAS_TOKEN"),
	};
}
