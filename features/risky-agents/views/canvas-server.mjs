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
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import * as triage from "../usecases/agent-triage.mjs";
import { requestInvestigation } from "../tools/canvas-actions.mjs";
import { STYLES } from "./styles.mjs";

const FEATURE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Only these directories are reachable from the browser. */
const SERVABLE_DIRS = new Set(["components", "views"]);

/** @type {Record<string, string>} */
const MIME = {
	".mjs": "text/javascript; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
};

/**
 * @param {{ store: CanvasStore, repository: AgentSource, getSession: () => any }} ctx
 * @returns {Promise<{ server: http.Server, port: number, close: () => void }>}
 */
export async function startCanvasServer(ctx) {
	/** @type {Set<http.ServerResponse>} */
	const clients = new Set();

	// One subscription for the process; each SSE response joins the fan-out.
	const unsubscribe = ctx.store.subscribe((state) => {
		const frame = `event: state\ndata: ${JSON.stringify(state)}\n\n`;
		for (const res of clients) {
			try {
				res.write(frame);
			} catch {
				clients.delete(res);
			}
		}
	});

	const server = http.createServer(async (req, res) => {
		const json = (/** @type {unknown} */ body, /** @type {number} */ code = 200) => {
			res.writeHead(code, { "Content-Type": "application/json" });
			res.end(JSON.stringify(body));
		};

		try {
			const url = new URL(req.url ?? "/", "http://127.0.0.1");

			if (req.method === "GET" && url.pathname === "/") {
				res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
				return res.end(shell());
			}

			if (req.method === "GET" && url.pathname === "/app.css") {
				res.writeHead(200, { "Content-Type": MIME[".css"] });
				return res.end(STYLES);
			}

			if (req.method === "GET" && url.pathname === "/api/events") {
				res.writeHead(200, {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache",
					Connection: "keep-alive",
				});
				// Send current state immediately so a reconnecting panel is never
				// blank while waiting for the next change.
				res.write(`event: state\ndata: ${JSON.stringify(ctx.store.get())}\n\n`);
				clients.add(res);
				req.on("close", () => clients.delete(res));
				return;
			}

			if (req.method === "GET" && url.pathname.startsWith("/src/")) {
				return serveModule(res, url.pathname.slice("/src/".length));
			}

			if (req.method === "POST" && url.pathname === "/api/select") {
				const { agentId } = await readJson(req);
				try {
					triage.selectAgent(ctx, agentId);
				} catch {
					// A stale click after a refresh dropped the agent. Ignoring it
					// is correct: the queue the user sees is already current.
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
		} catch (err) {
			// Never let a handler throw into the server: the panel would hang on
			// a pending fetch with no way to recover.
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
		}
	});

	const port = await new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			// Always an AddressInfo here: a TCP listen on an ephemeral port never
			// yields the string form, which is reserved for unix sockets.
			resolve(typeof address === "object" && address ? address.port : 0);
		});
	});

	return {
		server,
		port,
		close: () => {
			unsubscribe();
			for (const res of clients) {
				try {
					res.end();
				} catch {
					/* already gone */
				}
			}
			clients.clear();
			server.close();
		},
	};
}

/**
 * Serve a browser-side module from the feature directory.
 *
 * Path traversal is blocked two ways: the normalized path may not escape
 * upward, and its first segment must be an explicitly allowed directory.
 * Without both, `/src/../../platform/auth.mjs` would hand the token cache
 * logic to any page that can reach the port.
 *
 * @param {http.ServerResponse} res
 * @param {string} relative
 */
async function serveModule(res, relative) {
	const safe = normalize(relative).replace(/^(\.\.[/\\])+/, "");
	const dir = safe.split(/[/\\]/)[0] ?? "";
	const ext = extname(safe);
	const mime = MIME[ext];

	if (!SERVABLE_DIRS.has(dir) || !mime) {
		res.writeHead(404);
		return res.end("Not found");
	}

	try {
		const body = await readFile(join(FEATURE_ROOT, safe), "utf8");
		res.writeHead(200, { "Content-Type": mime });
		res.end(body);
	} catch {
		res.writeHead(404);
		res.end("Not found");
	}
}

/**
 * @param {http.IncomingMessage} req
 * @returns {Promise<Record<string, any>>}
 */
function readJson(req) {
	return new Promise((resolve) => {
		let raw = "";
		req.on("data", (/** @type {Buffer} */ c) => (raw += c));
		req.on("end", () => {
			try {
				resolve(JSON.parse(raw || "{}"));
			} catch {
				resolve({});
			}
		});
	});
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
  <script type="module" src="/src/views/client.mjs"></script>
</body>
</html>`;
}
