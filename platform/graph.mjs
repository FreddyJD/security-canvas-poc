/**
 * Microsoft Graph client for the ID Protection agent surface.
 *
 * Delegated-only. Deliberately NO client-secret / app-only path: a security
 * triage tool must act strictly as the signed-in analyst so that Entra RBAC
 * remains the authority on what can be read or changed. An app-only token
 * would let the server return data the analyst is not cleared to see — that is
 * privilege escalation wearing a helpful hat.
 *
 * The token provider is injected (see platform/auth.mjs). That single seam is
 * what lets one client serve both hosts and stay testable with a one-line
 * fake, without pulling `@azure/identity` — and therefore node_modules — into
 * the canvas, which is installed as a plain file copy.
 *
 * @typedef {import("../features/risky-agents/domain/types.js").AgentRiskDetection} AgentRiskDetection
 * @typedef {import("../features/risky-agents/domain/types.js").RiskyAgent} RiskyAgent
 * @typedef {import("./auth.mjs").TokenProvider} TokenProvider
 */
import { GRAPH_BASE } from "./config.mjs";
import { defaultTokenProvider } from "./auth.mjs";

export class GraphClient {
	/** @param {TokenProvider} [tokenProvider] */
	constructor(tokenProvider) {
		/** @type {TokenProvider} */
		this.tokenProvider = tokenProvider ?? defaultTokenProvider;
		/** @type {{ token: string, expiresAt: number } | undefined} */
		this.cached = undefined;
	}

	/** @returns {Promise<string>} */
	async getToken() {
		const now = Date.now();
		// Refresh 60s early to avoid racing expiry mid-request.
		if (this.cached && this.cached.expiresAt - 60_000 > now) return this.cached.token;

		const result = await this.tokenProvider();
		if (!result) throw new GraphError("Failed to acquire a Microsoft Graph token.", 401);

		// A provider may return a bare string or a token/expiry pair. Callers
		// that know an expiry let us cache; a bare string is treated as
		// short-lived so we never serve a stale credential.
		const token = typeof result === "string" ? result : result.token;
		const expiresAt = typeof result === "string" ? now + 60_000 : result.expiresOnTimestamp;
		this.cached = { token, expiresAt };
		return token;
	}

	/**
	 * Headers every Graph call needs.
	 * `Prefer` is required to receive `agentIdentityBlueprintPrincipal` in the
	 * evolvable identityType enum — without it that value is silently coerced
	 * to `unknownFutureValue`.
	 */
	async headers(/** @type {Record<string, string>} */ extra = {}) {
		return {
			Authorization: `Bearer ${await this.getToken()}`,
			Accept: "application/json",
			Prefer: "include-unknown-enum-members",
			...extra,
		};
	}

	/**
	 * Single GET. `path` is relative, e.g. "/beta/identityProtection/riskyAgents".
	 * @param {string} path
	 */
	async get(path) {
		const url = path.startsWith("http") ? path : `${GRAPH_BASE}${path}`;
		const res = await fetch(url, { headers: await this.headers() });
		if (!res.ok) throw await GraphError.fromResponse(res, url);
		return /** @type {Promise<any>} */ (res.json());
	}

	/**
	 * GET across @odata.nextLink pages.
	 * `maxItems` bounds the result because an unbounded tenant-wide pull can
	 * blow the model's context window and the analyst's patience alike.
	 *
	 * @param {string} path
	 * @param {number} [maxItems]
	 */
	async getAllPages(path, maxItems = 200) {
		/** @type {any[]} */
		const items = [];
		let next = path;
		while (next && items.length < maxItems) {
			const page = await this.get(next);
			items.push(...(page.value ?? []));
			next = page["@odata.nextLink"];
		}
		return items.slice(0, maxItems);
	}

	/**
	 * POST returning no body (Graph actions answer 204).
	 * @param {string} path
	 * @param {unknown} body
	 */
	async post(path, body) {
		const url = path.startsWith("http") ? path : `${GRAPH_BASE}${path}`;
		const res = await fetch(url, {
			method: "POST",
			headers: await this.headers({ "Content-Type": "application/json" }),
			body: JSON.stringify(body),
		});
		if (!res.ok) throw await GraphError.fromResponse(res, url);
	}

	// -------------------------------------------------------------------
	// ID Protection: agents
	// -------------------------------------------------------------------

	/**
	 * @param {{ riskLevels?: string[], riskStates?: string[], top?: number }} [opts]
	 * @returns {Promise<RiskyAgent[]>}
	 */
	async listRiskyAgents(opts = {}) {
		/** @type {string[]} */
		const filters = [];
		if (opts.riskLevels?.length) {
			filters.push(`(${opts.riskLevels.map((l) => `riskLevel eq '${odataEscape(l)}'`).join(" or ")})`);
		}
		if (opts.riskStates?.length) {
			filters.push(`(${opts.riskStates.map((s) => `riskState eq '${odataEscape(s)}'`).join(" or ")})`);
		}
		const params = new URLSearchParams();
		if (filters.length) params.set("$filter", filters.join(" and "));
		params.set("$top", String(Math.min(opts.top ?? 50, 200)));

		return this.getAllPages(`/beta/identityProtection/riskyAgents?${params}`, opts.top ?? 50);
	}

	/**
	 * @param {string} agentId
	 * @returns {Promise<RiskyAgent>}
	 */
	async getRiskyAgent(agentId) {
		return this.get(`/beta/identityProtection/riskyAgents/${encodeURIComponent(agentId)}`);
	}

	/**
	 * Detections for one agent.
	 *
	 * Filters on `identityId`. The older `agentId` property is deprecated
	 * (Graph removal after 2027-04-28) and is normalized in domain/scoring.mjs.
	 *
	 * @param {string} agentId
	 * @param {number} [top]
	 * @returns {Promise<AgentRiskDetection[]>}
	 */
	async listDetectionsForAgent(agentId, top = 50) {
		const params = new URLSearchParams({
			$filter: `identityId eq '${odataEscape(agentId)}'`,
			$top: String(Math.min(top, 200)),
		});
		return this.getAllPages(`/beta/identityProtection/agentRiskDetections?${params}`, top);
	}

	/**
	 * @param {string} sinceIso
	 * @param {number} [top]
	 * @returns {Promise<AgentRiskDetection[]>}
	 */
	async listRecentDetections(sinceIso, top = 100) {
		const params = new URLSearchParams({
			$filter: `detectedDateTime ge ${sinceIso}`,
			$top: String(Math.min(top, 200)),
		});
		return this.getAllPages(`/beta/identityProtection/agentRiskDetections?${params}`, top);
	}

	/**
	 * All detections in the tenant, unfiltered.
	 *
	 * One tenant-wide query the caller groups locally is far cheaper than an
	 * N+1 per-agent fetch, and avoids throttling on large tenants.
	 *
	 * @param {number} [top]
	 * @returns {Promise<AgentRiskDetection[]>}
	 */
	async listAllDetections(top = 200) {
		return this.getAllPages(`/beta/identityProtection/agentRiskDetections?$top=${Math.min(top, 200)}`, top);
	}

	// -------------------------------------------------------------------
	// Write actions — gated at the tool layer, never called implicitly.
	// -------------------------------------------------------------------

	/** @param {string[]} agentIds */
	async dismissAgentRisk(agentIds) {
		await this.post("/beta/identityProtection/riskyAgents/dismiss", { agentIds });
	}

	/** @param {string[]} agentIds */
	async confirmAgentCompromised(agentIds) {
		await this.post("/beta/identityProtection/riskyAgents/confirmCompromised", { agentIds });
	}

	/** @param {string[]} agentIds */
	async confirmAgentSafe(agentIds) {
		await this.post("/beta/identityProtection/riskyAgents/confirmSafe", { agentIds });
	}
}

/**
 * Escape single quotes for OData string literals (RFC: double them).
 * @param {string} value
 */
export function odataEscape(value) {
	return value.replace(/'/g, "''");
}

/** Graph error carrying enough context for the model to explain the failure. */
export class GraphError extends Error {
	/**
	 * @param {string} message
	 * @param {number} status
	 * @param {string} [code]
	 * @param {string} [url]
	 */
	constructor(message, status, code, url) {
		super(message);
		this.name = "GraphError";
		this.status = status;
		this.code = code;
		this.url = url;
	}

	/**
	 * @param {Response} res
	 * @param {string} url
	 * @returns {Promise<GraphError>}
	 */
	static async fromResponse(res, url) {
		let code;
		let message = `Graph request failed with ${res.status} ${res.statusText}`;
		try {
			const body = await res.json();
			code = body?.error?.code;
			if (body?.error?.message) message = body.error.message;
		} catch {
			/* non-JSON error body — keep the status-derived message */
		}
		return new GraphError(message, res.status, code, url);
	}

	/** Actionable guidance keyed off the status code. */
	get remediation() {
		switch (this.status) {
			case 401:
				return "Not authenticated. Call the sign_in tool, sign in from the canvas, or set SECURITY_CANVAS_TOKEN for a headless session.";
			case 403:
				return "Authenticated but not authorized. Requires the IdentityRiskyAgent.Read.All permission and a Security Reader, Security Operator, or Security Administrator role.";
			case 404:
				return "Not found. The riskyAgents API is in Graph beta and may not be enabled in this tenant, or the agent id is wrong.";
			case 429:
				return "Throttled by Graph. Retry after a short delay or narrow the query with filters.";
			default:
				return "Check tenant configuration and that the Graph beta ID Protection agent APIs are available.";
		}
	}
}
