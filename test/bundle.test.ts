import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFileSync } from "node:child_process";
import { mkdtempSync, copyFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The committed bundle, exercised the way a host runs it.
 *
 * Every other test imports from features/ and platform/, so they all pass
 * against source that no host executes: the Copilot app and Claude both run
 * dist/mcp.mjs. That gap is not theoretical — Cowork copied the plugin without
 * installing dependencies, mcp.mjs died on its first import of the MCP SDK, and
 * the session reported the tools as simply unavailable while every test stayed
 * green.
 *
 * So this runs the real binary as a subprocess, over stdio, from a temp
 * directory with no node_modules on any parent path. If the bundle is missing a
 * dependency, this is what catches it.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE = join(ROOT, "dist", "mcp.mjs");

let sandbox: string;
let client: Client;

/**
 * Environment for a server under test.
 *
 * PATH is reduced to the directory holding the Node binary and nothing else.
 * The credential chain falls back to `az account get-access-token` when no
 * token is cached, and that call has a 20-second timeout, so on a machine with
 * the Azure CLI installed any tool that reads the tenant blocks for 20s while
 * on a machine without it the same call returns in milliseconds. Hiding `az`
 * makes both machines behave like the second one.
 *
 * This is about determinism, not speed: a test whose result depends on whether
 * the developer happens to have the Azure CLI is not testing the bundle.
 */
function serverEnv(dataDir: string, extra: Record<string, string> = {}) {
	return {
		PATH: dirname(process.execPath),
		HOME: process.env.HOME ?? "",
		// Keep the test off the developer's real token cache.
		SECURITY_CANVAS_DATA_DIR: join(sandbox, dataDir),
		...extra,
	};
}

beforeAll(async () => {
	if (!existsSync(BUNDLE)) {
		execFileSync("node", [join(ROOT, "scripts", "build-mcp.mjs")], { cwd: ROOT });
	}

	// Copy the bundle somewhere with no node_modules above it. Running it from
	// the repository would let Node resolve the real dependencies and prove
	// nothing about whether they are bundled.
	sandbox = mkdtempSync(join(tmpdir(), "security-canvas-bundle-"));
	copyFileSync(BUNDLE, join(sandbox, "mcp.mjs"));

	client = new Client({ name: "bundle-test", version: "1.0.0" });
	await client.connect(
		new StdioClientTransport({
			command: "node",
			args: [join(sandbox, "mcp.mjs")],
			cwd: sandbox,
			env: serverEnv("data"),
		}),
	);
}, 60_000);

afterAll(async () => {
	await client?.close();
	if (sandbox) rmSync(sandbox, { recursive: true, force: true });
});

describe("the bundled MCP server", () => {
	it("starts with no node_modules and registers every tool", async () => {
		const { tools } = await client.listTools();
		const names = tools.map((t) => t.name).sort();

		expect(names).toEqual(
			[
				"assess_agent_blast_radius",
				"explain_agent_risk",
				"get_agent_details",
				"get_agent_estate_summary",
				"get_auth_status",
				"get_protect_agents_playbook",
				"list_agents",
				"list_recent_agent_detections",
				"list_risky_agents",
				"sign_in",
				"sign_out",
				"update_agent_risk_state",
			].sort(),
		);
	});

	it("answers a tool call without reaching the network", async () => {
		// get_protect_agents_playbook refreshes DLP coverage before it builds the
		// handoff, and that read goes through the same credential chain as every
		// other tool: cached token, then `az account get-access-token`, which has
		// a 20-second timeout of its own. On a developer machine with the Azure
		// CLI installed this call therefore blocks for 20s and this test fails,
		// while on a machine without it the chain gives up immediately and the
		// call takes 5ms. That is a real difference in environment, not flake.
		//
		// SECURITY_CANVAS_TOKEN short-circuits the chain: the token is never
		// validated locally, so a fake one keeps the call off the CLI path
		// entirely. Coverage still fails — there is no tenant behind it — and the
		// tool is built to survive that, which is the behaviour worth asserting.
		const offline = new Client({ name: "bundle-offline", version: "1.0.0" });
		await offline.connect(
			new StdioClientTransport({
				command: "node",
				args: [join(sandbox, "mcp.mjs")],
				cwd: sandbox,
				env: serverEnv("data-offline", { SECURITY_CANVAS_TOKEN: "not-a-real-token" }),
			}),
		);

		const started = Date.now();
		const res = await offline.callTool({ name: "get_protect_agents_playbook", arguments: {} });
		const elapsed = Date.now() - started;

		expect(res.isError).toBeFalsy();

		const text = (res.content as Array<{ type: string; text: string }>)[0]!.text;
		expect(text.length).toBeGreaterThan(0);
		// Guided is the default, and the bundle must not quietly change that:
		// auto mode returns one script for the agent to run, and it has to stay
		// something the user asks for by name.
		expect(res.structuredContent).toMatchObject({ mode: "guided" });

		// The playbook is text generation. If this ever takes seconds, something
		// has put a network round trip in front of it again.
		expect(elapsed).toBeLessThan(5_000);

		await offline.close();
	}, 30_000);

	it("reports signed-out rather than failing when there is no credential", async () => {
		const res = await client.callTool({ name: "get_auth_status", arguments: {} });
		expect(res.isError).toBeFalsy();
		expect(res.structuredContent).toMatchObject({ signedIn: false });
	});

	it("treats an unresolved user_config placeholder as unset", async () => {
		// Claude substitutes ${user_config.*} into the MCP env block, and a blank
		// optional setting can arrive as the literal placeholder. This asserts the
		// guard survives bundling: a server that took it literally would try to
		// authenticate against an app registration named "${user_config.client_id}".
		const probe = new Client({ name: "bundle-placeholder", version: "1.0.0" });
		await probe.connect(
			new StdioClientTransport({
				command: "node",
				args: [join(sandbox, "mcp.mjs")],
				cwd: sandbox,
				env: serverEnv("data-placeholder", {
					SECURITY_CANVAS_CLIENT_ID: "${user_config.client_id}",
					SECURITY_CANVAS_TENANT_ID: "${user_config.tenant_id}",
				}),
			}),
		);

		const res = await probe.callTool({ name: "get_auth_status", arguments: {} });
		expect(res.isError).toBeFalsy();
		const text = (res.content as Array<{ type: string; text: string }>)[0]!.text;
		expect(text).not.toContain("${user_config");
		await probe.close();
	}, 30_000);
});
