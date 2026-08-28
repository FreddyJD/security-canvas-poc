/**
 * Browser entry point for the Agents panel inside an MCP App.
 *
 * The canvas client talks to a loopback HTTP server: SSE in, POSTs out. Inside
 * an MCP App there is no server to talk to — the view runs in a sandboxed
 * iframe under a `connect-src 'none'` CSP by default, so `fetch` and
 * `EventSource` are not merely unavailable, they are the thing the sandbox
 * exists to prevent.
 *
 * Everything arrives over `postMessage` instead:
 *   - `ontoolresult` delivers the `list_agents` output the host just produced.
 *   - `callServerTool` runs another `list_agents` for sort, filter and search.
 *
 * That second point is what keeps this honest: the panel holds no token and
 * makes no Graph call. Every refetch goes host -> stdio server -> Graph on the
 * signed-in analyst's delegated credential, so Entra RBAC still decides what
 * comes back.
 */
import { App } from "@modelcontextprotocol/ext-apps";
import { renderInventory } from "./inventory-screen.mjs";
import { appViewModel } from "./app-view-model.mjs";

/**
 * The arguments of the current view, echoed back into every refetch.
 * @type {{ search?: string, platforms?: string[], risks?: string[], unownedOnly?: boolean, sortBy?: string }}
 */
let args = {};
/** @type {any} */
let latest = null;
let busy = false;

const root = () => /** @type {HTMLElement} */ (document.getElementById("main"));

const app = new App(
	{ name: "security-canvas-agents", version: "0.1.0" },
	// The panel is a table: it should size to its content and let the host
	// decide the viewport, rather than assuming a 100vh canvas as the standalone
	// screen does.
	{ autoResize: true },
);

/** Paint whatever we last received. */
function paint() {
	root().innerHTML = renderInventory(appViewModel(latest, args));
	root().setAttribute("aria-busy", String(busy));
}

/**
 * Re-run `list_agents` through the host with the current arguments.
 *
 * Sort and filter are server-side for the same reason they are on the canvas:
 * the tool holds the whole risky population, the panel holds one page of it.
 * Sorting locally would reorder 50 rows and call it the estate.
 */
async function refetch() {
	if (busy) return;
	busy = true;
	paint();

	try {
		const res = await app.callServerTool({ name: "list_agents", arguments: { ...args } });
		// Prefer the structured payload; the text block is for the model.
		if (res?.structuredContent) latest = res.structuredContent;
	} catch (err) {
		// A failed refetch must not blank a table the reader is using. Keep the
		// last good render and surface the reason.
		console.error("[security-canvas] list_agents failed", err);
	} finally {
		busy = false;
		paint();
	}
}

/** @param {EventTarget | null} target @param {string} selector */
function closest(target, selector) {
	return target instanceof Element ? target.closest(selector) : null;
}

document.addEventListener("click", (e) => {
	const sort = closest(e.target, "[data-sort]");
	if (sort) {
		args = { ...args, sortBy: /** @type {any} */ (sort).dataset.sort };
		return void refetch();
	}

	const pill = closest(e.target, "[data-filter]");
	if (pill) {
		const el = /** @type {HTMLElement} */ (pill);
		return void toggleFilter(el.dataset.filter ?? "", el.dataset.value ?? "");
	}

	const slice = closest(e.target, "[data-slice]");
	if (slice) {
		const value = /** @type {HTMLElement} */ (slice).dataset.slice;
		args = { ...args, unownedOnly: value === "unowned" ? !args.unownedOnly : false };
		if (value === "highRisk") args = { ...args, risks: args.risks?.includes("high") ? [] : ["high"] };
		return void refetch();
	}

	// The row opens the agent in the conversation rather than navigating: the
	// details screen is another tool, and the model should narrate what it found.
	const row = closest(e.target, "[data-agent-id]");
	if (row) {
		const id = /** @type {HTMLElement} */ (row).dataset.agentId;
		const title = /** @type {HTMLElement} */ (row).querySelector(".agent-name")?.textContent?.trim();
		return void app.sendMessage({
			message: `Tell me more about the agent ${title || id} (agentId ${id}).`,
		});
	}
});

/**
 * Filters are additive toggles, matching the canvas pills.
 * @param {string} kind @param {string} value
 */
function toggleFilter(kind, value) {
	if (kind === "platform") {
		const on = args.platforms ?? [];
		args = { ...args, platforms: on.includes(value) ? on.filter((p) => p !== value) : [...on, value] };
	} else if (kind === "risk") {
		const on = args.risks ?? [];
		args = { ...args, risks: on.includes(value) ? on.filter((r) => r !== value) : [...on, value] };
	} else if (kind === "slice") {
		args = { ...args, unownedOnly: !args.unownedOnly };
	}
	void refetch();
}

/**
 * Search, debounced — a tool call per keystroke would be a Graph round-trip per
 * keystroke.
 */
/** @type {ReturnType<typeof setTimeout> | undefined} */
let searchTimer;
document.addEventListener("input", (e) => {
	const target = /** @type {HTMLInputElement} */ (e.target);
	if (target?.id !== "agent-search") return;
	clearTimeout(searchTimer);
	const value = target.value;
	searchTimer = setTimeout(() => {
		args = { ...args, search: value };
		void refetch();
	}, 250);
});

// Keyboard parity with the canvas: the rows advertise role="button".
document.addEventListener("keydown", (e) => {
	if (e.key !== "Enter" && e.key !== " ") return;
	const row = closest(e.target, "[data-agent-id]");
	if (!row) return;
	e.preventDefault();
	/** @type {HTMLElement} */ (row).click();
});

/**
 * The host pushes the tool result that opened this panel.
 *
 * Set before `connect()`: the host may deliver the result immediately after the
 * handshake, and a listener attached afterwards can miss the first frame.
 */
app.ontoolresult = (/** @type {any} */ params) => {
	const content = params?.result?.structuredContent;
	if (content) latest = content;
	const called = params?.toolInput ?? params?.arguments;
	if (called && typeof called === "object") args = { ...args, ...called };
	paint();
};

app.ontoolinput = (/** @type {any} */ params) => {
	const called = params?.arguments;
	if (called && typeof called === "object") args = { ...args, ...called };
};

/**
 * Follow the host's light/dark preference.
 *
 * The panel is embedded in an app that already has a theme; the canvas reads
 * `prefers-color-scheme`, but inside an iframe that reports the OS setting
 * rather than Claude's. `hostContext.theme` is the authoritative answer.
 */
function applyTheme(/** @type {any} */ ctx) {
	const theme = ctx?.theme;
	if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
}

app.onhostcontextchanged = (/** @type {any} */ params) => applyTheme(params?.hostContext);

// connect() performs the ui/initialize handshake. Until it resolves the host
// keeps the container hidden, so nothing below runs against a dead channel.
app.connect()
	.then((result) => {
		applyTheme(/** @type {any} */ (result)?.hostContext);
		paint();
	})
	.catch((err) => {
		// Render anyway: a handshake failure should still show whatever the tool
		// result carried, rather than an empty frame with no explanation.
		console.error("[security-canvas] MCP App handshake failed", err);
		paint();
	});
