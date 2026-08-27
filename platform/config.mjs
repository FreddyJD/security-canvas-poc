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

export const CONFIG_DIR = join(homedir(), ".copilot", "security-canvas");
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
 * Effective configuration: disk first, environment second.
 * @returns {{ tenantId: string, clientId: string, directToken: string }}
 */
export function getConfig() {
	const file = readConfigFile();
	return {
		// "organizations" lets any work or school account sign in.
		tenantId: process.env.SECURITY_CANVAS_TENANT_ID || file.tenantId || "organizations",
		clientId: process.env.SECURITY_CANVAS_CLIENT_ID || file.clientId || DEFAULT_CLIENT_ID,
		directToken: process.env.SECURITY_CANVAS_TOKEN || "",
	};
}
