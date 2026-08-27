/**
 * The Agent details canvas: a local HTTP server for the details panel.
 *
 * Two responsibilities, both mechanical: serve the shell and the browser-side
 * ES modules, and translate HTTP requests into use-case calls and state changes
 * into SSE. No details logic lives here.
 *
 * @typedef {import("../domain/types.js").AgentDetailsSource} AgentDetailsSource
 * @typedef {import("../usecases/store.mjs").DetailsStore} DetailsStore
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEventStream, createServer, listen, readJson, serveModule } from "../../../platform/canvas-http.mjs";
import { signIn } from "../../../platform/auth.mjs";
import * as details from "../usecases/agent-details.mjs";
import { DETAILS_STYLES } from "./styles.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * @param {{ store: DetailsStore, repository: AgentDetailsSource, getSession: () => any }} ctx
 * @returns {Promise<{ port: number, close: () => void }>}
 */
export async function startDetailsServer(ctx) {
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
			return res.end(DETAILS_STYLES);
		}

		if (req.method === "GET" && url.pathname === "/api/details/events") {
			return events.attach(req, res);
		}

		if (req.method === "GET" && url.pathname.startsWith("/src/")) {
			return serveModule(res, url.pathname.slice("/src/".length), REPO_ROOT);
		}

		if (req.method === "POST" && url.pathname === "/api/details/open") {
			const { agentId } = await readJson(req);
			// Fire and forget: the load publishes its own two phases through the
			// store, and the panel already renders each of them.
			details.loadAgent(ctx, String(agentId ?? "")).catch(() => {});
			return json({ ok: true });
		}

		if (req.method === "POST" && url.pathname === "/api/details/refresh") {
			const current = ctx.store.get().agentId;
			if (current) details.loadAgent(ctx, current).catch(() => {});
			return json({ ok: Boolean(current) });
		}

		if (req.method === "POST" && url.pathname === "/api/details/back") {
			// The panel returns to its resting state rather than closing itself.
			// Closing would be the model's decision to make, not a click's.
			ctx.store.set({ status: "idle", agentId: null, vm: null, graphLoading: false, note: "", hint: "" });
			return json({ ok: true });
		}

		if (req.method === "POST" && url.pathname === "/api/details/connect") {
			const current = ctx.store.get().agentId;
			signIn()
				.then(() => (current ? details.loadAgent(ctx, current) : undefined))
				.catch((err) => {
					ctx.store.set({ status: "error", note: err instanceof Error ? err.message : String(err), hint: "" });
				});
			return json({ ok: true });
		}

		res.writeHead(404);
		res.end("Not found");
	});

	const port = await listen(server);
	return {
		port,
		close: () => {
			events.close();
			server.close();
		},
	};
}

/**
 * The HTML shell. Static: every dynamic region is filled by client.mjs from SSE
 * state, so there is no server-side templating to keep in sync.
 *
 * The inline script runs before first paint and sets `data-theme` from storage
 * or the OS preference. Without it the page renders light for one frame and
 * then flips — a flash of the wrong theme on every open, and on this page it
 * would also mean the graph's first paint resolves the wrong ink.
 */
function shell() {
	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Agent details</title>
  <link rel="stylesheet" href="/app.css"/>
  <script>
    (function () {
      try {
        var stored = localStorage.getItem('security-canvas-theme');
        if (stored === 'light' || stored === 'dark') { document.documentElement.dataset.theme = stored; return; }
      } catch (e) { /* storage unavailable in some webviews */ }
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.documentElement.dataset.theme = 'dark';
      }
    })();
  </script>
</head>
<body>
  <div class="page">
    <header class="page-head">
      <span class="spacer"></span>
      <button type="button" id="theme-toggle" class="theme-toggle" aria-label="Switch theme"></button>
    </header>
    <div class="scroll" id="main"></div>
  </div>
  <script type="module" src="/src/features/agent-details/views/client.mjs"></script>
</body>
</html>`;
}
