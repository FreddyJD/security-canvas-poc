/**
 * Shared HTTP scaffolding for canvas panels.
 *
 * Both canvases need the same three things — serve the shell and the
 * browser-side ES modules, stream state over SSE, and route JSON POSTs to use
 * cases — and none of that is feature knowledge. Extracting it here is what
 * keeps a second canvas from being a copy of the first with the nouns changed.
 *
 * What stays in the feature is the part that differs: which modules are
 * servable, what the shell looks like, and what the routes do.
 */
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

/** @type {Record<string, string>} */
const MIME = {
	".mjs": "text/javascript; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
};

/**
 * Whether a repo-relative module path may be served to the browser.
 *
 * An allowlist by *layer*, not by directory tree. Serving all of `platform/`
 * to get the shared escaping helper would also hand out `auth.mjs` — the token
 * cache and PKCE flow — to any page that can reach the port. Serving all of a
 * feature would hand out `data/` and `usecases/`, which hold the Graph calls.
 *
 * So: inside a feature only the presentation layers are reachable, and inside
 * `platform/` only modules explicitly built to run in a browser.
 *
 * @param {string} safePath Already normalized, guaranteed not to escape upward.
 * @returns {boolean}
 */
export function isBrowserModule(safePath) {
	const parts = safePath.split(/[/\\]/);

	// platform/<file> — an explicit, short list of browser-safe modules.
	if (parts[0] === "platform") {
		return parts.length === 2 && BROWSER_SAFE_PLATFORM.has(parts[1] ?? "");
	}

	// features/<feature>/<layer>/... — presentation layers only.
	if (parts[0] === "features") {
		return parts.length >= 4 && BROWSER_SAFE_LAYERS.has(parts[2] ?? "");
	}

	return false;
}

/** Layers within a feature that contain no I/O and no credentials. */
const BROWSER_SAFE_LAYERS = new Set(["components", "views", "domain"]);

/**
 * Platform modules the browser may load.
 *
 * Deliberately tiny, and adding to it is a security decision: everything here
 * is readable by anything that can reach the loopback port.
 */
const BROWSER_SAFE_PLATFORM = new Set(["html.mjs", "design-tokens.mjs", "theme-toggle.mjs"]);

/**
 * Serve a browser-side module from a root directory.
 *
 * Path traversal is blocked first — the normalized path may not escape upward —
 * and what survives is then checked against {@link isBrowserModule}. Both are
 * needed: normalization alone would still happily serve `platform/auth.mjs`.
 *
 * @param {http.ServerResponse} res
 * @param {string} relative
 * @param {string} root
 */
export async function serveModule(res, relative, root) {
	const safe = normalize(relative).replace(/^(\.\.[/\\])+/, "");
	const mime = MIME[extname(safe)];

	if (!mime || !isBrowserModule(safe)) {
		res.writeHead(404);
		return res.end("Not found");
	}

	try {
		const body = await readFile(join(root, safe), "utf8");
		res.writeHead(200, { "Content-Type": mime });
		res.end(body);
	} catch {
		res.writeHead(404);
		res.end("Not found");
	}
}

/**
 * An SSE fan-out.
 *
 * One subscription per process; each response joins the set. A write to a dead
 * socket drops that client rather than throwing into the broadcast loop, which
 * would stop every other panel from updating.
 *
 * @template T
 * @param {{ subscribe: (fn: (state: T) => void) => () => void, get: () => T }} store
 * @param {(state: T) => unknown} [project] Shape the frame; defaults to the raw state.
 */
export function createEventStream(store, project = (s) => s) {
	/** @type {Set<http.ServerResponse>} */
	const clients = new Set();

	const frameFor = (/** @type {T} */ state) => `event: state\ndata: ${JSON.stringify(project(state))}\n\n`;

	const unsubscribe = store.subscribe((state) => {
		const frame = frameFor(state);
		for (const res of clients) {
			try {
				res.write(frame);
			} catch {
				clients.delete(res);
			}
		}
	});

	return {
		/** @param {http.IncomingMessage} req @param {http.ServerResponse} res */
		attach(req, res) {
			res.writeHead(200, {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
			});
			// Send current state immediately so a reconnecting panel is never
			// blank while waiting for the next change.
			res.write(frameFor(store.get()));
			clients.add(res);
			req.on("close", () => clients.delete(res));
		},

		/** Re-send to everyone. For changes the store itself did not make. */
		broadcast() {
			const frame = frameFor(store.get());
			for (const res of clients) {
				try {
					res.write(frame);
				} catch {
					clients.delete(res);
				}
			}
		},

		close() {
			unsubscribe();
			for (const res of clients) {
				try {
					res.end();
				} catch {
					/* already gone */
				}
			}
			clients.clear();
		},
	};
}

/**
 * Read a JSON request body, tolerating a malformed one.
 *
 * @param {http.IncomingMessage} req
 * @returns {Promise<Record<string, any>>}
 */
export function readJson(req) {
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
 * Listen on an ephemeral loopback port.
 *
 * @param {http.Server} server
 * @returns {Promise<number>}
 */
export function listen(server) {
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			// Always AddressInfo for a TCP listen; the string form is unix sockets.
			resolve(typeof address === "object" && address ? address.port : 0);
		});
	});
}

/**
 * Wrap a request handler so a thrown error becomes a 500 instead of hanging the
 * panel on a pending fetch with no way to recover.
 *
 * Handlers commonly `return res.end(...)`, so the return value is deliberately
 * unconstrained — it is never read.
 *
 * @param {(req: http.IncomingMessage, res: http.ServerResponse, url: URL) => Promise<unknown>} handler
 */
export function createServer(handler) {
	return http.createServer(async (req, res) => {
		try {
			await handler(req, res, new URL(req.url ?? "/", "http://127.0.0.1"));
		} catch (err) {
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
		}
	});
}
