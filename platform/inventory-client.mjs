/**
 * Client for the ZTAI unified agent inventory (ADR-077).
 *
 * The estate aggregated across Microsoft's agent planes — M365 Copilot, Copilot
 * Studio, Endpoint and others — rather than the Entra-only view that
 * `identityProtection/riskyAgents` gives. This is what answers "what are my
 * agents?"; risky agents are the same estate narrowed to the flagged rows.
 *
 * Two reachable origins, and which one works depends on how you are signed in:
 *
 *   Graph RP      https://graph.microsoft.com/rp/zerotrustai/inventory/agents
 *                 The service's own route. Takes the same delegated Graph token
 *                 the rest of this canvas already acquires, so it works with
 *                 the existing sign-in and needs no extra consent.
 *
 *   Portal proxy  https://unifiedux.df.security.microsoft.com/apiproxy/msgraph/
 *                 rp/zerotrustai/...
 *                 What the Security-UX page calls. The proxy injects auth
 *                 server-side from an `sccauth` **session cookie** — which this
 *                 process does not have and cannot mint. Supported here because
 *                 it is the documented URL, but it only authenticates from
 *                 inside a signed-in portal browser session.
 *
 * Graph RP is therefore the default. `SECURITY_CANVAS_INVENTORY_BASE` overrides
 * it, which is how you point at a dev ring or at localhost:5105.
 *
 * @typedef {import("../features/agent-inventory/domain/types.js").AgentCatalog} AgentCatalog
 * @typedef {import("../features/agent-inventory/domain/types.js").InventorySummary} InventorySummary
 * @typedef {import("./auth.mjs").TokenProvider} TokenProvider
 */
import { GraphError } from "./graph.mjs";
import { defaultTokenProvider } from "./auth.mjs";

/** The service's own route, reachable with a plain delegated Graph token. */
export const GRAPH_RP_BASE = "https://graph.microsoft.com/rp/zerotrustai";

/** The portal proxy the Security-UX Agents page uses. Cookie-authenticated. */
export const PORTAL_PROXY_BASE = "https://unifiedux.df.security.microsoft.com/apiproxy/msgraph/rp/zerotrustai";

/**
 * The only version that serves the catalog envelope.
 *
 * Selection is an action constraint on the service side, so an unrecognized
 * value does not 400 on this route — it silently falls through to the legacy
 * unversioned action and returns a completely different body. Pinning it is
 * what keeps the response shape predictable.
 */
export const INVENTORY_API_VERSION = "2026-08-01";

/** @returns {string} */
export function inventoryBase() {
	return process.env.SECURITY_CANVAS_INVENTORY_BASE || GRAPH_RP_BASE;
}

export class InventoryClient {
	/**
	 * @param {TokenProvider} [tokenProvider]
	 * @param {string} [baseUrl]
	 */
	constructor(tokenProvider, baseUrl) {
		this.tokenProvider = tokenProvider ?? defaultTokenProvider;
		this.baseUrl = baseUrl ?? inventoryBase();
	}

	/** @returns {Promise<Record<string, string>>} */
	async headers() {
		const result = await this.tokenProvider();
		if (!result) throw new GraphError("Failed to acquire a Microsoft Graph token.", 401);
		const token = typeof result === "string" ? result : result.token;
		return {
			Authorization: `Bearer ${token}`,
			Accept: "application/json",
			// Correlates this call with the service's Geneva/Kusto telemetry.
			"client-request-id": randomGuid(),
		};
	}

	/**
	 * @param {string} path
	 * @param {Record<string, string>} [extraHeaders]
	 */
	async get(path, extraHeaders = {}) {
		const url = `${this.baseUrl}${path}`;
		const res = await fetch(url, { headers: { ...(await this.headers()), ...extraHeaders } });
		if (!res.ok) throw await InventoryError.fromResponse(res, url);
		return /** @type {Promise<any>} */ (res.json());
	}

	/**
	 * The agent catalog.
	 *
	 * Note what this returns: with no filter the service serves the **flagged**
	 * catalog — agents that are risky, unowned, publicly exposed or unmonitored.
	 * That is the stored document, not a query over the whole estate, so there
	 * is no parameter that widens it. The true estate size lives in the summary.
	 *
	 * @param {{ risk?: boolean, flagged?: boolean, maxCount?: number }} [opts]
	 * @returns {Promise<AgentCatalog>}
	 */
	async listAgents(opts = {}) {
		const params = new URLSearchParams({ "api-version": INVENTORY_API_VERSION });
		if (opts.risk !== undefined) params.set("risk", String(opts.risk));
		if (opts.flagged !== undefined) params.set("flagged", String(opts.flagged));
		// maxCount < 1 is a 400 from the service; clamp rather than provoke it.
		if (opts.maxCount !== undefined) params.set("maxCount", String(Math.max(1, opts.maxCount)));

		const body = await this.get(`/inventory/agents?${params}`);
		return { metadata: body?.metadata ?? {}, agents: Array.isArray(body?.agents) ? body.agents : [] };
	}

	/**
	 * The tenant-wide aggregate.
	 *
	 * The one content-negotiating route: `Accept: application/a2ui+json` selects
	 * a renderable surface instead. Asking for JSON explicitly is what keeps
	 * that from being selected by a stray default.
	 *
	 * @returns {Promise<InventorySummary>}
	 */
	async getSummary() {
		return this.get("/inventory/agents/summary", { Accept: "application/json" });
	}
}

/**
 * An inventory API failure, with guidance the analyst can act on.
 *
 * Separate from GraphError because the failure modes differ in kind: this
 * service answers 503 with `Retry-After` for a snapshot that has not been
 * collected yet, which is a wait-and-retry rather than a misconfiguration.
 */
export class InventoryError extends Error {
	/**
	 * @param {string} message
	 * @param {number} status
	 * @param {string} [code]
	 * @param {number} [retryAfter]
	 * @param {string} [url]
	 */
	constructor(message, status, code, retryAfter, url) {
		super(message);
		this.name = "InventoryError";
		this.status = status;
		this.code = code;
		this.retryAfter = retryAfter;
		this.url = url;
	}

	/**
	 * @param {Response} res
	 * @param {string} url
	 * @returns {Promise<InventoryError>}
	 */
	static async fromResponse(res, url) {
		let code;
		let message = `Inventory request failed with ${res.status} ${res.statusText}`;
		try {
			const body = await res.json();
			code = body?.error;
			if (body?.message) message = body.message;
		} catch {
			/* non-JSON body — keep the status-derived message */
		}
		const retryAfter = Number(res.headers.get("retry-after")) || undefined;
		return new InventoryError(message, res.status, code, retryAfter, url);
	}

	get remediation() {
		switch (this.status) {
			case 401:
				return "Not authenticated. Sign in from the canvas, or set SECURITY_CANVAS_TOKEN to a Microsoft Graph token.";
			case 403:
				// The service gates on directory role, not on a Graph scope — a
				// correctly-scoped token from a non-admin still gets 403 here.
				return "Authenticated but not authorized. The inventory API requires the Global Administrator or Security Administrator directory role in this tenant.";
			case 404:
				return "Route not found. Confirm the inventory base URL and that this tenant is onboarded to the agent inventory service.";
			case 503:
				return `The tenant's inventory snapshot has not been collected yet. This clears on the next refresh pass — retry in ${this.retryAfter ?? 5}s.`;
			default:
				return "Check the inventory base URL and that the ZeroTrustAI resource provider is reachable from this network.";
		}
	}
}

/** A v4-shaped correlation id. Not security-sensitive; readability is the point. */
function randomGuid() {
	let out = "";
	for (let i = 0; i < 32; i++) {
		out += Math.floor(Math.random() * 16).toString(16);
		if (i === 7 || i === 11 || i === 15 || i === 19) out += "-";
	}
	return out;
}
