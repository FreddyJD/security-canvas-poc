import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, copyFileSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { appViewModel } from "../features/agent-inventory/views/app-view-model.mjs";
import { renderInventory } from "../features/agent-inventory/views/inventory-screen.mjs";
import { AGENTS_APP_URI, APP_MIME_TYPE } from "../features/agent-inventory/views/app-resource.mjs";
import type { InventoryAgent } from "../features/agent-inventory/domain/types.js";

/**
 * The Agents panel as an MCP App.
 *
 * Two things are worth testing and one is not. The markup is `renderInventory`,
 * already covered by inventory-presentation.test.ts, so it is not re-asserted
 * here. What is new is the adapter — one tool result reshaped into a view model
 * the screen can render — and the resource the host actually fetches.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE = join(ROOT, "dist", "mcp.mjs");
const APP_HTML = join(ROOT, "dist", "app-html.mjs");

/**
 * A catalog row, defaulted the way the service serves one.
 *
 * Fully typed rather than a loose object literal: `owner` is `string | null`,
 * and a fixture using `""` for "no owner" would quietly disagree with the code
 * that decides whether an agent is unowned.
 */
const agent = (over: Partial<InventoryAgent> = {}): InventoryAgent => ({
	agentId: "a1",
	title: "Contoso Helper",
	publisher: "Contoso",
	platform: "M365 Copilot",
	appType: "firstParty",
	source: "registered",
	status: "enabled",
	owner: "ana@contoso.com",
	riskLevel: "high",
	publiclyExposed: null,
	unmonitored: false,
	lastActivity: "2026-08-01T00:00:00Z",
	protection: { defender: null, dlp: null },
	blastRadius: { available: false },
	identity: { servicePrincipalId: null, userId: null, coverageTarget: "none" },
	...over,
});

describe("the Agents panel view model", () => {
	it("renders the rows the tool returned, in the order it returned them", () => {
		const vm = appViewModel({
			agents: [agent({ agentId: "a1", title: "First" }), agent({ agentId: "a2", title: "Second" })],
			matchedCount: 2,
			riskyCount: 2,
			estateTotal: 790,
		});

		expect(vm.status).toBe("connected");
		expect(vm.rows.map((r: any) => r.title)).toEqual(["First", "Second"]);

		// The screen must accept it without throwing — this is the contract the
		// adapter exists to satisfy.
		const html = renderInventory(vm);
		expect(html).toContain("First");
		expect(html).toContain("Second");
	});

	it("counts metrics over the page but states shares against the risky total", () => {
		// One high-risk row out of a page of one, drawn from 40 risky agents in an
		// estate of 790. The count is what this page can prove; the denominator is
		// the risky population. Dividing by the page would claim 100% high risk.
		const vm = appViewModel({
			agents: [agent({ riskLevel: "high" })],
			matchedCount: 40,
			riskyCount: 40,
			estateTotal: 790,
		});

		const high = vm.metrics.find((m: any) => m.id === "highRisk");
		expect(high?.value).toBe(1);
		expect(high?.total).toBe(40);
		expect(high?.shareLabel).toBe("of 40 with risk");
	});

	it("says the estate is larger than the flagged set", () => {
		const vm = appViewModel({ agents: [agent()], matchedCount: 7, riskyCount: 7, estateTotal: 790 });
		const total = vm.metrics.find((m: any) => m.id === "all");

		expect(total?.shareLabel).toBe("with risk, of 790 in the estate");
	});

	it("never claims an estate of zero when the total is unknown", () => {
		// buildMetrics reads a missing total as "no estate figure". Passing
		// `{ total: undefined }` through would have rendered "of 0 in the estate"
		// on a tenant whose size simply was not reported.
		const vm = appViewModel({ agents: [agent()], matchedCount: 1, riskyCount: 1 });
		const total = vm.metrics.find((m: any) => m.id === "all");

		expect(total?.shareLabel).toBe("of the whole estate");
		expect(renderInventory(vm)).not.toContain("of 0 in the estate");
	});

	it("discloses truncation rather than implying the page is everything", () => {
		const vm = appViewModel({ agents: [agent()], matchedCount: 50, riskyCount: 50 });

		expect(vm.note).toContain("Showing 1 of 50");
		expect(renderInventory(vm)).toContain("Showing 1 of 50");
	});

	it("says nothing when the page is the whole result", () => {
		const vm = appViewModel({ agents: [agent(), agent({ agentId: "a2" })], matchedCount: 2, riskyCount: 2 });
		expect(vm.note).toBe("");
	});

	it("shows one page, because one tool call is one page", () => {
		// A pager rendered here could not turn: the next page lives behind another
		// list_agents call. Dead controls are worse than absent ones.
		const vm = appViewModel({ agents: [agent()], matchedCount: 200, riskyCount: 200 });

		expect(vm.pageCount).toBe(1);
		expect(renderInventory(vm)).not.toContain("class=\"pager\"");
	});

	it("reflects the arguments the tool was called with, so the controls match the data", () => {
		const vm = appViewModel(
			{ agents: [agent()], matchedCount: 1, riskyCount: 1, platforms: ["M365 Copilot", "Copilot Studio"] },
			{ search: "contoso", risks: ["high"], platforms: ["M365 Copilot"], unownedOnly: true, sortBy: "owner" },
		);

		expect(vm.filters).toMatchObject({ search: "contoso", risks: ["high"], slice: "unowned" });
		expect(vm.sort).toEqual({ column: "owner", descending: false });

		const html = renderInventory(vm);
		// The search box shows the term that produced these rows.
		expect(html).toContain('value="contoso"');
	});

	it("defaults to the same sort the tool defaults to", () => {
		// list_agents sorts by risk when no column is given. A panel defaulting to
		// name would draw carets over rows ordered by something else.
		const vm = appViewModel({ agents: [agent()], matchedCount: 1, riskyCount: 1 });
		expect(vm.sort.column).toBe("risk");
	});

	it("survives an empty or absent result instead of throwing", () => {
		expect(() => renderInventory(appViewModel(null))).not.toThrow();
		expect(() => renderInventory(appViewModel({}))).not.toThrow();

		const vm = appViewModel({ agents: [], matchedCount: 0, riskyCount: 0 });
		expect(renderInventory(vm)).toContain("No agents");
	});
});

describe("the bundled server's UI resource", () => {
	it("serves the panel as a self-contained MCP App document", async () => {
		if (!existsSync(BUNDLE) || !existsSync(APP_HTML)) {
			throw new Error("dist is missing. Run: npm run build");
		}

		// Same isolation as bundle.test.ts: no node_modules on any parent path.
		// The panel must travel inside dist/mcp.mjs, because a host copies the
		// bundle and runs it from wherever it lands.
		const sandbox = mkdtempSync(join(tmpdir(), "security-canvas-app-"));
		copyFileSync(BUNDLE, join(sandbox, "mcp.mjs"));

		const client = new Client({ name: "app-test", version: "1.0.0" });
		await client.connect(
			new StdioClientTransport({
				command: "node",
				args: [join(sandbox, "mcp.mjs")],
				cwd: sandbox,
				env: {
					PATH: process.env.PATH ?? "",
					HOME: process.env.HOME ?? "",
					SECURITY_CANVAS_DATA_DIR: join(sandbox, "data"),
				},
			}),
		);

		try {
			const { resources } = await client.listResources();
			const panel = resources.find((r) => r.uri === AGENTS_APP_URI);

			expect(panel).toBeDefined();
			expect(panel?.mimeType).toBe(APP_MIME_TYPE);

			const read = await client.readResource({ uri: AGENTS_APP_URI });
			const html = (read.contents as Array<{ text?: string; mimeType?: string }>)[0];

			expect(html?.mimeType).toBe(APP_MIME_TYPE);
			expect(html?.text).toContain("<!doctype html>");

			// The sandbox applies `default-src 'none'` unless the resource declares
			// domains, and this one declares none. Anything the document tries to
			// fetch would be blocked and the panel would render empty.
			expect(html?.text).not.toMatch(/<script[^>]+src=/i);
			expect(html?.text).not.toMatch(/<link[^>]+rel=["']?stylesheet/i);

			// The handshake is not optional: without ui/initialize the host leaves
			// the container hidden and shows an empty box with no error anywhere.
			expect(html?.text).toContain("ui/initialize");
		} finally {
			await client.close();
			rmSync(sandbox, { recursive: true, force: true });
		}
	}, 60_000);

	it("advertises the panel on the tool that renders it", async () => {
		const sandbox = mkdtempSync(join(tmpdir(), "security-canvas-app-meta-"));
		copyFileSync(BUNDLE, join(sandbox, "mcp.mjs"));

		const client = new Client({ name: "app-meta-test", version: "1.0.0" });
		await client.connect(
			new StdioClientTransport({
				command: "node",
				args: [join(sandbox, "mcp.mjs")],
				cwd: sandbox,
				env: {
					PATH: process.env.PATH ?? "",
					HOME: process.env.HOME ?? "",
					SECURITY_CANVAS_DATA_DIR: join(sandbox, "data"),
				},
			}),
		);

		try {
			const { tools } = await client.listTools();
			const listAgents = tools.find((t) => t.name === "list_agents");

			// Nested under `ui`. The flat `ui/resourceUri` form is deprecated and
			// slated for removal before GA.
			expect((listAgents?._meta as any)?.ui?.resourceUri).toBe(AGENTS_APP_URI);

			// Every other tool stays plain text: a host that renders one panel per
			// tool call would otherwise open one for questions that are answers,
			// not tables.
			const others = tools.filter((t) => t.name !== "list_agents");
			for (const tool of others) {
				expect((tool._meta as any)?.ui?.resourceUri).toBeUndefined();
			}
		} finally {
			await client.close();
			rmSync(sandbox, { recursive: true, force: true });
		}
	}, 60_000);
});

describe("the plugin data directory", () => {
	it("ignores an unexpanded ${CLAUDE_PLUGIN_DATA} instead of taking it literally", async () => {
		// Claude's desktop bridge logs "the desktop host bridge has no project or
		// plugin-data directory; left unexpanded" and passes the placeholder
		// through. Taking it at face value would create a directory named
		// "${CLAUDE_PLUGIN_DATA}" and split the token cache, so a sign-in in
		// Claude Code would read as signed-out in Cowork.
		const sandbox = mkdtempSync(join(tmpdir(), "security-canvas-datadir-"));
		const fakeHome = join(sandbox, "home");
		mkdirSync(fakeHome, { recursive: true });
		copyFileSync(BUNDLE, join(sandbox, "mcp.mjs"));

		const client = new Client({ name: "datadir-test", version: "1.0.0" });
		await client.connect(
			new StdioClientTransport({
				command: "node",
				args: [join(sandbox, "mcp.mjs")],
				cwd: sandbox,
				env: {
					PATH: process.env.PATH ?? "",
					HOME: fakeHome,
					SECURITY_CANVAS_DATA_DIR: "${CLAUDE_PLUGIN_DATA}",
				},
			}),
		);

		try {
			const res = await client.callTool({ name: "get_auth_status", arguments: {} });
			expect(res.isError).toBeFalsy();

			const text = (res.content as Array<{ type: string; text: string }>)[0]!.text;
			expect(text).not.toContain("${CLAUDE_PLUGIN_DATA}");

			// The fallback is the shared default under HOME, not a directory named
			// after the placeholder in the working directory.
			expect(existsSync(join(sandbox, "${CLAUDE_PLUGIN_DATA}"))).toBe(false);
		} finally {
			await client.close();
			rmSync(sandbox, { recursive: true, force: true });
		}
	}, 60_000);
});
