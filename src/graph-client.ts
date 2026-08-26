import {
	DeviceCodeCredential,
	AzureCliCredential,
	ChainedTokenCredential,
	type TokenCredential,
} from "@azure/identity";
import type { AgentRiskDetection, GraphCollection, RiskyAgent } from "./types.js";

const GRAPH_BASE = process.env.GRAPH_BASE_URL ?? "https://graph.microsoft.com";
const SCOPE = "https://graph.microsoft.com/.default";

/**
 * Delegated-only Graph client.
 *
 * Deliberately NO client-secret / app-only path. A security triage tool must
 * act strictly as the signed-in analyst so that Entra RBAC remains the
 * authority on what can be read or changed. An app-only token would let the
 * MCP server return data the analyst is not cleared to see — that is privilege
 * escalation wearing a helpful hat.
 *
 * Credential order: Azure CLI (fast, already signed in) then device code
 * (works headless over stdio). Device-code prompts are written to stderr,
 * never stdout, because stdout is the JSON-RPC channel.
 */
export class GraphClient {
	private credential: TokenCredential;
	private cachedToken?: { token: string; expiresOnTimestamp: number };

	constructor(credential?: TokenCredential) {
		this.credential =
			credential ??
			new ChainedTokenCredential(
				new AzureCliCredential(),
				new DeviceCodeCredential({
					tenantId: process.env.AZURE_TENANT_ID,
					clientId: process.env.AZURE_CLIENT_ID,
					userPromptCallback: (info) => {
						process.stderr.write(`\n[security-canvas] ${info.message}\n`);
					},
				}),
			);
	}

	private async getToken(): Promise<string> {
		const now = Date.now();
		// Refresh 60s early to avoid racing expiry mid-request.
		if (this.cachedToken && this.cachedToken.expiresOnTimestamp - 60_000 > now) {
			return this.cachedToken.token;
		}
		const result = await this.credential.getToken(SCOPE);
		if (!result) throw new GraphError("Failed to acquire a Microsoft Graph token.", 401);
		this.cachedToken = { token: result.token, expiresOnTimestamp: result.expiresOnTimestamp };
		return result.token;
	}

	/** Single GET. `path` is relative, e.g. "/beta/identityProtection/riskyAgents". */
	async get<T>(path: string): Promise<T> {
		const token = await this.getToken();
		const url = path.startsWith("http") ? path : `${GRAPH_BASE}${path}`;

		const res = await fetch(url, {
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/json",
				// Required by Graph to receive `agentIdentityBlueprintPrincipal`
				// in the evolvable identityType enum. Without it that value is
				// silently coerced to `unknownFutureValue`.
				Prefer: "include-unknown-enum-members",
			},
		});

		if (!res.ok) {
			throw await GraphError.fromResponse(res, url);
		}
		return (await res.json()) as T;
	}

	/**
	 * GET across @odata.nextLink pages.
	 * `maxItems` bounds the result because an unbounded tenant-wide pull can
	 * blow the model's context window and the analyst's patience alike.
	 */
	async getAllPages<T>(path: string, maxItems = 200): Promise<T[]> {
		const items: T[] = [];
		let next: string | undefined = path;
		while (next && items.length < maxItems) {
			const page: GraphCollection<T> = await this.get<GraphCollection<T>>(next);
			items.push(...(page.value ?? []));
			next = page["@odata.nextLink"];
		}
		return items.slice(0, maxItems);
	}

	/** POST returning no body (Graph actions answer 204). */
	async post(path: string, body: unknown): Promise<void> {
		const token = await this.getToken();
		const url = path.startsWith("http") ? path : `${GRAPH_BASE}${path}`;
		const res = await fetch(url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
				Prefer: "include-unknown-enum-members",
			},
			body: JSON.stringify(body),
		});
		if (!res.ok) throw await GraphError.fromResponse(res, url);
	}

	// -------------------------------------------------------------------
	// ID Protection: agents
	// -------------------------------------------------------------------

	async listRiskyAgents(opts: {
		riskLevels?: string[];
		riskStates?: string[];
		top?: number;
	} = {}): Promise<RiskyAgent[]> {
		const filters: string[] = [];
		if (opts.riskLevels?.length) {
			filters.push(`(${opts.riskLevels.map((l) => `riskLevel eq '${odataEscape(l)}'`).join(" or ")})`);
		}
		if (opts.riskStates?.length) {
			filters.push(`(${opts.riskStates.map((s) => `riskState eq '${odataEscape(s)}'`).join(" or ")})`);
		}
		const params = new URLSearchParams();
		if (filters.length) params.set("$filter", filters.join(" and "));
		params.set("$top", String(Math.min(opts.top ?? 50, 200)));

		return this.getAllPages<RiskyAgent>(
			`/beta/identityProtection/riskyAgents?${params}`,
			opts.top ?? 50,
		);
	}

	async getRiskyAgent(agentId: string): Promise<RiskyAgent> {
		return this.get<RiskyAgent>(
			`/beta/identityProtection/riskyAgents/${encodeURIComponent(agentId)}`,
		);
	}

	/**
	 * Detections for one agent.
	 *
	 * Filters on `identityId`. The older `agentId` property is deprecated
	 * (Graph removal after 2027-04-28) and is normalized in normalize.ts.
	 */
	async listDetectionsForAgent(agentId: string, top = 50): Promise<AgentRiskDetection[]> {
		const params = new URLSearchParams({
			$filter: `identityId eq '${odataEscape(agentId)}'`,
			$top: String(Math.min(top, 200)),
		});
		return this.getAllPages<AgentRiskDetection>(
			`/beta/identityProtection/agentRiskDetections?${params}`,
			top,
		);
	}

	async listRecentDetections(sinceIso: string, top = 100): Promise<AgentRiskDetection[]> {
		const params = new URLSearchParams({
			$filter: `detectedDateTime ge ${sinceIso}`,
			$top: String(Math.min(top, 200)),
		});
		return this.getAllPages<AgentRiskDetection>(
			`/beta/identityProtection/agentRiskDetections?${params}`,
			top,
		);
	}

	// -------------------------------------------------------------------
	// Write actions — gated at the tool layer, never called implicitly.
	// -------------------------------------------------------------------

	async dismissAgentRisk(agentIds: string[]): Promise<void> {
		await this.post("/beta/identityProtection/riskyAgents/dismiss", { agentIds });
	}

	async confirmAgentCompromised(agentIds: string[]): Promise<void> {
		await this.post("/beta/identityProtection/riskyAgents/confirmCompromised", { agentIds });
	}

	async confirmAgentSafe(agentIds: string[]): Promise<void> {
		await this.post("/beta/identityProtection/riskyAgents/confirmSafe", { agentIds });
	}
}

/** Escape single quotes for OData string literals (RFC: double them). */
export function odataEscape(value: string): string {
	return value.replace(/'/g, "''");
}

/** Graph error carrying enough context for the model to explain the failure. */
export class GraphError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly code?: string,
		readonly url?: string,
	) {
		super(message);
		this.name = "GraphError";
	}

	static async fromResponse(res: Response, url: string): Promise<GraphError> {
		let code: string | undefined;
		let message = `Graph request failed with ${res.status} ${res.statusText}`;
		try {
			const body = (await res.json()) as { error?: { code?: string; message?: string } };
			code = body.error?.code;
			if (body.error?.message) message = body.error.message;
		} catch {
			/* non-JSON error body — keep the status-derived message */
		}
		return new GraphError(message, res.status, code, url);
	}

	/** Actionable guidance keyed off the status code. */
	get remediation(): string {
		switch (this.status) {
			case 401:
				return "Not authenticated. Run `az login`, or set AZURE_TENANT_ID and AZURE_CLIENT_ID for device-code sign-in.";
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
