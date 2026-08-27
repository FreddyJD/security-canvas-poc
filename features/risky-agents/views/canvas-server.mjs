/**
 * The canvas surface: a local HTTP server for the Copilot panel.
 *
 * Two responsibilities, both mechanical:
 *   - serve the shell and the browser-side ES modules
 *   - translate HTTP requests into use-case calls, and state changes into SSE
 *
 * No triage logic lives here. Adding a screen means adding a view and a route
 * name, not editing this file.
 *
 * @typedef {import("../usecases/store.mjs").CanvasStore} CanvasStore
 * @typedef {import("../domain/types.js").AgentSource} AgentSource
 */
import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEventStream, createServer, listen, readJson, serveModule } from "../../../platform/canvas-http.mjs";
import * as triage from "../usecases/agent-triage.mjs";
import { requestInvestigation } from "../tools/canvas-actions.mjs";
import { STYLES } from "./styles.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * @param {{ store: CanvasStore, repository: AgentSource, getSession: () => any }} ctx
 * @returns {Promise<{ server: http.Server, port: number, close: () => void }>}
 */
export async function startCanvasServer(ctx) {
	const events = createEventStream(ctx.store);

	const server = createServer(async (req, res, url) => {
		const json = (/** @type {unknown} */ body, code = 200) => {
			res.writeHead(code, { "Content-Type": "application/json" });
			res.end(JSON.stringify(body));
		};

		if (req.method === "GET" && url.pathname === "/") {
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			return res.end(shell());
		}

		if (req.method === "GET" && url.pathname === "/app.css") {
			res.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
			return res.end(STYLES);
		}

		if (req.method === "GET" && url.pathname === "/api/events") {
			return events.attach(req, res);
		}

		if (req.method === "GET" && url.pathname.startsWith("/src/")) {
			return serveModule(res, url.pathname.slice("/src/".length), REPO_ROOT);
		}

		if (req.method === "POST" && url.pathname === "/api/select") {
			const { agentId } = await readJson(req);
			try {
				triage.selectAgent(ctx, agentId);
			} catch {
				// A stale click after a refresh dropped the agent. Ignoring it is
				// correct: the queue the user sees is already current.
			}
			return json({ ok: true });
		}

		if (req.method === "POST" && url.pathname === "/api/refresh") {
			await triage.refreshQueue(ctx);
			return json({ ok: true });
		}

		if (req.method === "POST" && url.pathname === "/api/connect") {
			// Fire and forget: sign-in waits on a browser round-trip, and the
			// panel already renders progress from the store.
			triage.connect(ctx).catch(() => {});
			return json({ ok: true });
		}

		if (req.method === "POST" && url.pathname === "/api/investigate") {
			const { agentId } = await readJson(req);
			return json({ ok: requestInvestigation(ctx, agentId) });
		}

		res.writeHead(404);
		res.end("Not found");
	});

	const port = await listen(server);

	return {
		server,
		port,
		close: () => {
			events.close();
			server.close();
		},
	};
}

/**
 * The HTML shell. Static: every dynamic region is filled by client.mjs from
 * SSE state, so there is no server-side templating to keep in sync.
 */
function shell() {
	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Security Canvas</title>
  <link rel="stylesheet" href="/app.css"/>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>Security Canvas</h1>
      <span id="count" class="badge" style="display:none"></span>
      <span class="spacer"></span>
      <button id="refresh" data-action="refresh" style="display:none">Refresh</button>
    </header>
    <div class="note" id="note" style="display:none"></div>
    <div id="gate" class="gate"></div>
    <div class="cols" id="cols" style="display:none">
      <div class="queue" id="queue"></div>
      <div class="detail" id="detail"></div>
    </div>
  </div>
  <script type="module" src="/src/features/risky-agents/views/client.mjs"></script>
</body>
</html>`;
}
