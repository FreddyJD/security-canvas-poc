/**
 * The playbook canvas: a local HTTP server for the protection panel.
 *
 * Mechanical only — serve the shell and the modules, map routes to use cases,
 * stream state.
 *
 * @typedef {import("../usecases/store.mjs").PlaybookStore} PlaybookStore
 * @typedef {import("../../agent-inventory/domain/types.js").InventorySource} InventorySource
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEventStream, createServer, listen, readJson, serveModule } from "../../../platform/canvas-http.mjs";
import { themeBootScript } from "../../../platform/theme-toggle.mjs";
import * as playbook from "../usecases/run-playbook.mjs";
import { PLAYBOOK_STYLES } from "./styles.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * @param {{ store: PlaybookStore, repository: InventorySource, getSession: () => any }} ctx
 */
export async function startPlaybookServer(ctx) {
	/**
	 * Validation errors live outside the store.
	 *
	 * They are a property of the last submission, not of the playbook: putting
	 * them in state would make them survive a refresh and reappear next to a
	 * value the operator already fixed.
	 *
	 * @type {string[]}
	 */
	let errors = [];

	const events = createEventStream(ctx.store, () => ({ ...playbook.playbookViewModel(ctx), errors }));

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
			return res.end(PLAYBOOK_STYLES);
		}

		if (req.method === "GET" && url.pathname === "/api/playbook/events") {
			return events.attach(req, res);
		}

		if (req.method === "GET" && url.pathname.startsWith("/src/")) {
			return serveModule(res, url.pathname.slice("/src/".length), REPO_ROOT);
		}

		if (req.method === "POST" && url.pathname === "/api/playbook/params") {
			const body = await readJson(req);
			const result = playbook.applyParams(ctx, body);
			errors = result.ok ? [] : result.errors;
			// A rejected value changes no state, so nothing would broadcast and
			// the errors would never reach the screen. Push a frame explicitly.
			if (!result.ok) events.broadcast();
			return json(result.ok ? { ok: true } : { ok: false, errors });
		}

		if (req.method === "POST" && url.pathname === "/api/playbook/step") {
			const { stepId } = await readJson(req);
			ctx.store.openStep(String(stepId));
			return json({ ok: true });
		}

		if (req.method === "POST" && url.pathname === "/api/playbook/done") {
			const { stepId } = await readJson(req);
			ctx.store.toggleDone(String(stepId));
			return json({ ok: true });
		}

		if (req.method === "POST" && url.pathname === "/api/playbook/handoff") {
			return json({ ok: playbook.sendToCopilot(ctx) });
		}

		if (req.method === "POST" && url.pathname === "/api/playbook/refresh") {
			await playbook.refreshCoverage(ctx);
			return json({ ok: true });
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

function shell() {
	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Protect agents</title>
  <link rel="stylesheet" href="/app.css"/>
  ${themeBootScript()}
</head>
<body>
  <div class="page">
    <header class="page-head">
      <h1>Protect agents from sensitive data</h1>
      <span class="spacer"></span>
      <button type="button" id="theme-toggle" class="theme-toggle" aria-label="Switch theme"></button>
    </header>
    <div class="scroll" id="main"></div>
  </div>
  <script type="module" src="/src/features/purview-protection/views/client.mjs"></script>
</body>
</html>`;
}
