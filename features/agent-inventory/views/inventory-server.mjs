/**
 * The Agents canvas: a local HTTP server for the inventory panel.
 *
 * Mechanical only — serve the shell and the modules, map routes to use cases,
 * stream state. No inventory logic lives here.
 *
 * The SSE frame carries the *view model*, not the raw state. The browser then
 * renders a pure function of what it receives, and filtering, sorting and
 * paging stay in one implementation on the Node side rather than being
 * reimplemented in the client.
 *
 * @typedef {import("../usecases/store.mjs").InventoryStore} InventoryStore
 * @typedef {import("../domain/types.js").InventorySource} InventorySource
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEventStream, createServer, listen, readJson, serveModule } from "../../../platform/canvas-http.mjs";
import * as inventory from "../usecases/inventory-browse.mjs";
import { INVENTORY_STYLES } from "./styles.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * @param {{ store: InventoryStore, repository: InventorySource, getSession: () => any }} ctx
 */
export async function startInventoryServer(ctx) {
	const events = createEventStream(ctx.store, () => inventory.inventoryViewModel(ctx));

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
			return res.end(INVENTORY_STYLES);
		}

		if (req.method === "GET" && url.pathname === "/api/inventory/events") {
			return events.attach(req, res);
		}

		if (req.method === "GET" && url.pathname.startsWith("/src/")) {
			return serveModule(res, url.pathname.slice("/src/".length), REPO_ROOT);
		}

		if (req.method === "POST" && url.pathname === "/api/inventory/refresh") {
			await inventory.refreshInventory(ctx);
			return json({ ok: true });
		}

		if (req.method === "POST" && url.pathname === "/api/inventory/sort") {
			const { column } = await readJson(req);
			ctx.store.toggleSort(String(column));
			return json({ ok: true });
		}

		if (req.method === "POST" && url.pathname === "/api/inventory/slice") {
			const { slice } = await readJson(req);
			// Pressing the active card releases it — the only obvious way back to
			// the whole estate once you have narrowed to one of the other three.
			applyFilter(ctx.store, "slice", slice);
			return json({ ok: true });
		}

		if (req.method === "POST" && url.pathname === "/api/inventory/filter") {
			const { kind, value } = await readJson(req);
			applyFilter(ctx.store, kind, value);
			return json({ ok: true });
		}

		if (req.method === "POST" && url.pathname === "/api/inventory/page") {
			const { direction } = await readJson(req);
			const { page } = ctx.store.get();
			const { pageCount } = inventory.visibleAgents(ctx);
			const next = direction === "next" ? page + 1 : page - 1;
			ctx.store.set({ page: Math.max(0, Math.min(pageCount - 1, next)) });
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

/**
 * Apply one filter change.
 *
 * Pills toggle rather than replace: a reader narrowing to "M365 Copilot" and
 * then "Copilot Studio" means both, not the second one only.
 *
 * Values arrive from an HTTP body, so they are untrusted. Risk and slice are
 * closed sets and are checked against them — an unrecognized value is dropped
 * rather than stored, because a filter the domain cannot interpret would match
 * nothing and silently blank the table. Platform is free-form on the wire, so
 * it is taken as given; a platform nobody has simply matches no rows.
 *
 * @param {InventoryStore} store
 * @param {unknown} kind
 * @param {unknown} value
 */
function applyFilter(store, kind, value) {
	const { filters } = store.get();

	if (kind === "search") return store.setFilters({ search: String(value ?? "") });

	if (kind === "platform") {
		const platform = String(value ?? "");
		if (!platform) return;
		const platforms = filters.platforms.includes(platform)
			? filters.platforms.filter((p) => p !== platform)
			: [...filters.platforms, platform];
		return store.setFilters({ platforms });
	}

	if (kind === "risk") {
		const band = asRiskLevel(value);
		if (!band) return;
		const risks = filters.risks.includes(band)
			? filters.risks.filter((r) => r !== band)
			: [...filters.risks, band];
		return store.setFilters({ risks });
	}

	if (kind === "slice") {
		const slice = asSlice(value);
		if (!slice) return;
		return store.setFilters({ slice: filters.slice === slice ? "all" : slice });
	}
}

const RISK_LEVELS = /** @type {const} */ (["none", "low", "medium", "high"]);
const SLICES = /** @type {const} */ (["all", "managed", "highRisk", "unowned"]);

/**
 * @param {unknown} value
 * @returns {import("../domain/types.js").InventoryRiskLevel | null}
 */
function asRiskLevel(value) {
	return RISK_LEVELS.includes(/** @type {any} */ (value)) ? /** @type {any} */ (value) : null;
}

/**
 * @param {unknown} value
 * @returns {import("../domain/types.js").AgentSlice | null}
 */
function asSlice(value) {
	return SLICES.includes(/** @type {any} */ (value)) ? /** @type {any} */ (value) : null;
}

/**
 * The HTML shell.
 *
 * The inline script runs before first paint and sets `data-theme` from storage
 * or the OS preference. Without it the page renders light for one frame and
 * then flips — a flash of the wrong theme on every open, which is exactly the
 * kind of detail that makes a panel feel unfinished.
 */
function shell() {
	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Agents</title>
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
      <h1>Agents</h1>
      <span class="spacer"></span>
      <button type="button" id="theme-toggle" class="theme-toggle" aria-label="Switch theme"></button>
    </header>
    <div class="scroll" id="main"></div>
  </div>
  <script type="module" src="/src/features/agent-inventory/views/client.mjs"></script>
</body>
</html>`;
}
