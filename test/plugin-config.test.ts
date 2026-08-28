import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Config resolution under a plugin host.
 *
 * These cover the two things that differ between the Copilot app and Claude
 * Code: where state is written, and the fact that Claude substitutes
 * `${user_config.*}` into the MCP env block — which means an *unset* optional
 * value can arrive as the literal placeholder text rather than as nothing.
 *
 * Both are load-bearing. Getting the first wrong silently drops the user's
 * sign-in on every plugin update; getting the second wrong sends the string
 * "${user_config.client_id}" to Entra as a client id, which fails with an
 * AADSTS error that says nothing about the real cause.
 *
 * config.mjs reads the environment at module scope for CONFIG_DIR, so each test
 * re-imports it with a fresh module registry.
 */

const ENV_KEYS = [
	"SECURITY_CANVAS_DATA_DIR",
	"SECURITY_CANVAS_CLIENT_ID",
	"SECURITY_CANVAS_TENANT_ID",
	"SECURITY_CANVAS_TOKEN",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
	saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
	for (const k of ENV_KEYS) delete process.env[k];
	vi.resetModules();
});

afterEach(() => {
	for (const k of ENV_KEYS) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
});

async function loadConfig() {
	// vi.resetModules() in beforeEach clears the registry, so this static
	// specifier re-evaluates the module and picks up the current environment.
	// A cache-busting query string would be a Vite "unknown dynamic import".
	return import("../platform/config.mjs");
}

describe("CONFIG_DIR", () => {
	it("defaults to the Copilot location when no data dir is set", async () => {
		const { CONFIG_DIR } = await loadConfig();
		expect(CONFIG_DIR).toMatch(/\.copilot[/\\]security-canvas$/);
	});

	it("uses the plugin data directory when the host provides one", async () => {
		// Claude Code passes ${CLAUDE_PLUGIN_DATA}: a directory that survives
		// plugin updates. Writing the token cache anywhere else means the user is
		// silently signed out every time the plugin updates.
		process.env.SECURITY_CANVAS_DATA_DIR = "/tmp/claude-plugin-data";
		const { CONFIG_DIR, CACHE_FILE } = await loadConfig();
		expect(CONFIG_DIR).toBe("/tmp/claude-plugin-data");
		expect(CACHE_FILE).toBe("/tmp/claude-plugin-data/token-cache.json");
	});
});

describe("getConfig", () => {
	it("falls back to the shipped app registration and any tenant", async () => {
		const { getConfig, DEFAULT_CLIENT_ID } = await loadConfig();
		const cfg = getConfig();
		expect(cfg.clientId).toBe(DEFAULT_CLIENT_ID);
		expect(cfg.tenantId).toBe("organizations");
		expect(cfg.directToken).toBe("");
	});

	it("honors an explicitly configured app registration", async () => {
		process.env.SECURITY_CANVAS_CLIENT_ID = "11111111-2222-3333-4444-555555555555";
		process.env.SECURITY_CANVAS_TENANT_ID = "contoso.onmicrosoft.com";
		const { getConfig } = await loadConfig();
		const cfg = getConfig();
		expect(cfg.clientId).toBe("11111111-2222-3333-4444-555555555555");
		expect(cfg.tenantId).toBe("contoso.onmicrosoft.com");
	});

	it("treats an unresolved ${user_config} placeholder as unset", async () => {
		// The regression this exists for: a user who left the optional plugin
		// settings blank would otherwise authenticate against an app registration
		// literally named "${user_config.client_id}".
		process.env.SECURITY_CANVAS_CLIENT_ID = "${user_config.client_id}";
		process.env.SECURITY_CANVAS_TENANT_ID = "${user_config.tenant_id}";
		const { getConfig, DEFAULT_CLIENT_ID } = await loadConfig();
		const cfg = getConfig();
		expect(cfg.clientId).toBe(DEFAULT_CLIENT_ID);
		expect(cfg.tenantId).toBe("organizations");
	});

	it("ignores an empty or whitespace-only value", async () => {
		process.env.SECURITY_CANVAS_CLIENT_ID = "   ";
		const { getConfig, DEFAULT_CLIENT_ID } = await loadConfig();
		expect(getConfig().clientId).toBe(DEFAULT_CLIENT_ID);
	});

	it("trims a value pasted with surrounding whitespace", async () => {
		process.env.SECURITY_CANVAS_CLIENT_ID = "  abc-123  ";
		const { getConfig } = await loadConfig();
		expect(getConfig().clientId).toBe("abc-123");
	});
});
