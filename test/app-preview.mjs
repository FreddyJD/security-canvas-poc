#!/usr/bin/env node
/**
 * Render the Agents panel the way a host does, to look at it.
 *
 * The panel is the one part of this repository that no unit test can fully
 * judge: `renderInventory` is asserted on strings, but whether the thing paints
 * — whether the ui/initialize handshake completes, whether the sandbox lets the
 * inline module run, whether the table is readable — is a question you answer
 * with your eyes.
 *
 * This is a minimal MCP Apps *host*. It reads the ui:// resource from the real
 * bundled server over stdio, drops it into an iframe, performs the handshake,
 * and pushes a tool result in. Every message crossing the boundary is logged,
 * so a panel that stays blank tells you which step it died on rather than
 * leaving you guessing.
 *
 *   node test/app-preview.mjs        fixtures, no tenant, no sign-in
 *
 * Not a test: nothing here asserts. It exists because "it renders" was worth
 * checking before shipping, and worth re-checking after touching the client.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 3120);
const APP_URI = "ui://security-canvas/agents";

/** A small fixture estate: enough rows to sort, filter and truncate. */
const FIXTURE = {
	agents: [
		row("a1", "Contoso Deal Desk", "Contoso", "M365 Copilot", "ana@contoso.com", "high", "enabled"),
		row("a2", "Invoice Triage", "Contoso", "Copilot Studio", "", "high", "enabled"),
		row("a3", "HR Onboarding Buddy", "Fabrikam", "M365 Copilot", "sam@contoso.com", "medium", "enabled"),
		row("a4", "Endpoint Patch Advisor", "Microsoft", "Endpoint", "ops@contoso.com", "medium", "disabled"),
		row("a5", "Sales Notes Summarizer", "Northwind", "Copilot Studio", "", "low", "enabled"),
		row("a6", "Support Macro Bot", "Northwind", "M365 Copilot", "lee@contoso.com", "none", "enabled"),
	],
	matchedCount: 42,
	riskyCount: 42,
	estateTotal: 790,
	platforms: ["M365 Copilot", "Copilot Studio", "Endpoint"],
};

function row(agentId, title, publisher, platform, owner, riskLevel, status) {
	return {
		agentId,
		title,
		publisher,
		platform,
		owner,
		riskLevel,
		status,
		lastActivity: "2026-08-20T12:00:00Z",
		discoverySource: "Entra",
	};
}

/** Read the panel HTML from the real server, exactly as a host would. */
async function readPanel() {
	const client = new Client({ name: "app-preview", version: "1.0.0" });
	await client.connect(
		new StdioClientTransport({
			command: process.execPath,
			args: [join(ROOT, "mcp.mjs")],
			cwd: ROOT,
			env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
		}),
	);

	try {
		const res = await client.readResource({ uri: APP_URI });
		const html = res.contents?.[0]?.text;
		if (!html) throw new Error(`${APP_URI} returned no text`);
		return html;
	} finally {
		await client.close();
	}
}

const panel = await readPanel();

createServer((req, res) => {
	if (req.url === "/panel") {
		// srcdoc would inherit this origin; a real host uses a sandboxed frame on
		// a separate origin. Serving it as its own document is closer, and keeps
		// the module script's own CSP behaviour intact.
		res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
		return res.end(panel);
	}

	res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
	res.end(host());
}).listen(PORT, () => {
	process.stdout.write(`Agents panel preview: http://127.0.0.1:${PORT}\n`);
	process.stdout.write(`Panel document: ${(panel.length / 1024).toFixed(0)} KB\n`);
});

/**
 * The host page: an iframe, the ui/* handshake, and a message log.
 *
 * Implements only what the panel needs — initialize, initialized, the tool
 * result push, and callServerTool answered from the fixture. That is enough to
 * prove the handshake and the interaction loop without a tenant.
 */
function host() {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>MCP App host — Agents</title>
<style>
  body { margin: 0; font: 13px ui-monospace, monospace; background: #16181d; color: #d8dbe2;
         display: grid; grid-template-columns: 1fr 380px; height: 100vh; }
  #stage { padding: 24px; overflow: auto; }
  iframe { width: 100%; border: 1px solid #333; border-radius: 12px; background: #fff; min-height: 640px; }
  #log { border-left: 1px solid #333; padding: 12px; overflow: auto; background: #101216; }
  .m { padding: 4px 6px; border-bottom: 1px solid #23262d; white-space: pre-wrap; word-break: break-word; }
  .in { color: #7fd88f; } .out { color: #7fb2ff; } .err { color: #ff8a8a; }
  h1 { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #8a90a0; margin: 0 0 8px; }
</style>
</head>
<body>
<div id="stage"><iframe id="app" src="/panel" sandbox="allow-scripts"></iframe></div>
<div id="log"><h1>postMessage log</h1><div id="lines"></div></div>
<script>
const frame = document.getElementById("app");
const lines = document.getElementById("lines");

// A tiny readout of what the panel actually rendered, so an automated check (or
// a screenshot) can tell "painted six rows" from "painted an empty table"
// without reaching across the sandbox boundary, which is not permitted.
window.__panel = { rows: 0, count: "", note: "", calls: [] };

function log(dir, msg) {
  const el = document.createElement("div");
  el.className = "m " + dir;
  el.textContent = (dir === "in" ? "\\u2190 " : "\\u2192 ") + JSON.stringify(msg).slice(0, 400);
  lines.prepend(el);
}

const FIXTURE = ${JSON.stringify(FIXTURE)};

function send(msg) { log("out", msg); frame.contentWindow.postMessage(msg, "*"); }

window.addEventListener("message", (e) => {
  if (e.source !== frame.contentWindow) return;
  const msg = e.data;
  if (!msg || msg.jsonrpc !== "2.0") return;
  log("in", msg);

  if (msg.method === "ui/initialize") {
    send({ jsonrpc: "2.0", id: msg.id, result: {
      protocolVersion: "2026-01-26",
      // Required by the schema. Omitting it fails validation inside the view
      // and the handshake never completes — which is exactly the silent blank
      // panel this preview exists to catch.
      hostInfo: { name: "security-canvas-app-preview", version: "1.0.0" },
      hostCapabilities: { serverTools: {}, openLinks: {} },
      hostContext: { theme: "light", displayMode: "inline", platform: "desktop",
                     containerDimensions: { maxHeight: 800 } },
    }});
    return;
  }

  // Once the view says it is initialized, push the tool result that opened it.
  if (msg.method === "ui/notifications/initialized") {
    send({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: {
      result: { structuredContent: FIXTURE },
      toolInput: {},
    }});
    return;
  }

  // The panel refetches through the host. Answer from the fixture, applying the
  // filters so the controls visibly do something.
  if (msg.method === "ui/tools/call" || msg.method === "tools/call") {
    const args = msg.params?.arguments ?? {};
    window.__panel.calls.push(args);
    let agents = FIXTURE.agents.slice();
    if (args.search) {
      const q = String(args.search).toLowerCase();
      agents = agents.filter((a) => (a.title + a.publisher + a.owner + a.platform).toLowerCase().includes(q));
    }
    if (args.platforms?.length) agents = agents.filter((a) => args.platforms.includes(a.platform));
    if (args.risks?.length) agents = agents.filter((a) => args.risks.includes(a.riskLevel));
    if (args.unownedOnly) agents = agents.filter((a) => !a.owner);

    send({ jsonrpc: "2.0", id: msg.id, result: {
      content: [{ type: "text", text: agents.length + " agents" }],
      structuredContent: { ...FIXTURE, agents, matchedCount: agents.length },
    }});
    return;
  }

  if (msg.method === "ui/message") {
    send({ jsonrpc: "2.0", id: msg.id, result: {} });
    return;
  }

  if (msg.method === "ui/notifications/size-changed") {
    // The view reports its size after every paint. Sampling here is the only
    // way to observe what it rendered: the frame is sandboxed to a different
    // origin, so its DOM is deliberately unreachable from this page.
    window.__panel.height = msg.params?.height ?? 0;
    return;
  }

  // Size reports and anything else that expects an ack.
  if (msg.id !== undefined) send({ jsonrpc: "2.0", id: msg.id, result: {} });
});
</script>
</body>
</html>`;
}
