/**
 * Renders the agent-details panel against fixture data, so the screen can be
 * looked at without a tenant.
 *
 * Not a test and not shipped — `package.json` does not list it in `files`. It
 * exists because the one thing the unit tests genuinely cannot assert is
 * whether the page *looks* right: the layout, the donut's arc, the graph's
 * rings, and the theme all live in a browser.
 *
 * Usage: node test/details-preview.mjs [port]
 */
import { createServer, listen } from "../platform/canvas-http.mjs";
import { buildAgentDetails } from "../features/agent-details/domain/details-adapter.mjs";
import { DETAILS_STYLES } from "../features/agent-details/views/styles.mjs";
import { themeBootScript } from "../platform/theme-toggle.mjs";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** A row shaped exactly like the inventory catalog serves one. */
const row = {
	agentId: "76d5b313-ab72-f111-ab0d-70a8a59be404",
	title: "ira-test-agent",
	publisher: "",
	platform: "Copilot Studio",
	appType: "thirdParty",
	source: "registered",
	status: "Active",
	owner: "Ira",
	riskLevel: "medium",
	publiclyExposed: null,
	unmonitored: true,
	lastActivity: null,
	protection: { defender: null, dlp: false },
	blastRadius: { available: true },
	identity: { servicePrincipalId: "sp-ira-1", userId: null, coverageTarget: "servicePrincipal" },
};

/** A detail document shaped exactly like `agents/{id}` serves one. */
const detail = {
	agentId: row.agentId,
	blastRadius: {
		total: 2,
		byCategory: [
			{ label: "group", count: 1, resources: [{ name: "Finance readers", criticalityLevel: null }] },
			{ label: "serviceprincipal", count: 1, resources: [{ name: "Payments API", criticalityLevel: 3 }] },
		],
	},
	reachability: [{ sourceId: "u-1", sourceLabel: "Ira Novak", sourceCategories: ["user"], edgeLabel: "owns" }],
	agentDetails: { platform: "Copilot Studio", status: "Active", owners: ["Ira", "Sam Reed"], entraAgentId: row.agentId },
};

const vm = buildAgentDetails(/** @type {any} */ (row), /** @type {any} */ (detail), null);

/** The same two-phase publish the real load performs, on a timer. */
const shallow = buildAgentDetails(/** @type {any} */ (row), null, null);

const server = createServer(async (req, res, url) => {
	if (url.pathname === "/") {
		res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
		return res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<title>Agent details preview</title><link rel="stylesheet" href="/app.css"/>${themeBootScript()}</head>
<body><div class="page"><header class="page-head"><span class="spacer"></span>
<button type="button" id="theme-toggle" class="theme-toggle" aria-label="Switch theme"></button></header>
<div class="scroll" id="main"></div></div>
<script type="module" src="/src/features/agent-details/views/client.mjs"></script>
<script>
// Preview-only. Call __probe() from devtools to check the canvas actually has
// ink on it -- the one thing a screenshot of a <canvas> cannot be trusted to
// show, since an unresolved token leaves the previous fill rather than erroring.
// A healthy frame reports thousands of painted pixels across many colours; a
// few hundred in one colour means a token reached fillStyle unresolved.
window.__probe = function () {
  var c = document.getElementById('graph-canvas');
  if (!c) return { ok: false, why: 'no canvas' };
  var ctx = c.getContext('2d');
  var d = ctx.getImageData(0, 0, c.width, c.height).data;
  var painted = 0, seen = {};
  for (var i = 0; i < d.length; i += 4) {
    if (d[i + 3] > 8) { painted++; seen[d[i] + ',' + d[i+1] + ',' + d[i+2]] = 1; }
  }
  return { ok: painted > 0, paintedPx: painted, distinctColors: Object.keys(seen).length };
};
</script></body></html>`);
	}

	if (url.pathname === "/app.css") {
		res.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
		return res.end(DETAILS_STYLES);
	}

	if (url.pathname === "/api/details/events") {
		res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
		const frame = (state) => res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
		// Phase one, then phase two — so the shimmer and the cross-fade are
		// actually exercised rather than skipped by arriving complete.
		frame({ status: "connected", note: "", hint: "", agentId: row.agentId, vm: shallow, graphLoading: true, lastRefresh: null });
		setTimeout(() => frame({ status: "connected", note: "", hint: "", agentId: row.agentId, vm, graphLoading: false, lastRefresh: null }), 1400);
		return;
	}

	if (url.pathname.startsWith("/src/")) {
		const safe = normalize(url.pathname.slice("/src/".length)).replace(/^(\.\.[/\\])+/, "");
		const mime = extname(safe) === ".css" ? "text/css" : "text/javascript";
		try {
			const body = await readFile(join(REPO_ROOT, safe), "utf8");
			res.writeHead(200, { "Content-Type": `${mime}; charset=utf-8` });
			return res.end(body);
		} catch {
			res.writeHead(404);
			return res.end("Not found");
		}
	}

	if (req.method === "POST") {
		res.writeHead(200, { "Content-Type": "application/json" });
		return res.end("{}");
	}

	res.writeHead(404);
	res.end("Not found");
});

const port = Number(process.argv[2]) || (await listen(server));
if (process.argv[2]) server.listen(port, "127.0.0.1");
process.stdout.write(`preview on http://127.0.0.1:${port}\n`);
