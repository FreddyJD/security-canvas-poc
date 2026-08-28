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
			env: {
				PATH: process.env.PATH ?? "",
				HOME: process.env.HOME ?? "",
				// Keep the test off the developer's real token cache.
				SECURITY_CANVAS_DATA_DIR: join(sandbox, "data"),
			},
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

	it("answers a tool call that needs no tenant", async () => {
		// The playbook is pure text generation, so it exercises the tool layer
		// and zod validation without a Graph call or a credential.
		const res = await client.callTool({ name: "get_protect_agents_playbook", arguments: {} });
		expect(res.isError).toBeFalsy();

		const text = (res.content as Array<{ type: string; text: string }>)[0]!.text;
		expect(text.length).toBeGreaterThan(0);
		// Guided is the default, and the bundle must not quietly change that:
		// auto mode returns one script for the agent to run, and it has to stay
		// something the user asks for by name.
		expect(res.structuredContent).toMatchObject({ mode: "guided" });
	});

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
				env: {
					PATH: process.env.PATH ?? "",
					HOME: process.env.HOME ?? "",
					SECURITY_CANVAS_DATA_DIR: join(sandbox, "data-placeholder"),
					SECURITY_CANVAS_CLIENT_ID: "${user_config.client_id}",
					SECURITY_CANVAS_TENANT_ID: "${user_config.tenant_id}",
				},
			}),
		);

		const res = await probe.callTool({ name: "get_auth_status", arguments: {} });
		expect(res.isError).toBeFalsy();
		const text = (res.content as Array<{ type: string; text: string }>)[0]!.text;
		expect(text).not.toContain("${user_config");
		await probe.close();
	}, 30_000);
});
