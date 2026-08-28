import { describe, expect, it, vi } from "vitest";
import {
	GRAPH_RP_BASE,
	INVENTORY_API_VERSION,
	InventoryClient,
	InventoryError,
} from "../platform/inventory-client.mjs";

/**
 * The URL this client emits is the whole contract with the inventory service,
 * and it is the one thing every other test mocks past. These assert the request
 * itself.
 */
const fakeToken = async () => "fake-token";

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
	return vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
		handler(String(input), init),
	) as unknown as typeof fetch;
}

const jsonResponse = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const emptyCatalog = { metadata: {}, agents: [] };

/** Runs `call` with fetch stubbed and hands back the URL it requested. */
async function captureUrl(call: (client: InventoryClient) => Promise<unknown>): Promise<URL> {
	let captured = "";
	const fetchMock = mockFetch((url) => {
		captured = url;
		return jsonResponse(emptyCatalog);
	});
	vi.stubGlobal("fetch", fetchMock);
	try {
		await call(new InventoryClient(fakeToken));
	} finally {
		vi.unstubAllGlobals();
	}
	return new URL(captured);
}

describe("listAgents", () => {
	it("pins the api-version that selects the catalog representation", async () => {
		// Unrecognized values do not 400 on this route — the service falls through
		// to the legacy unversioned action and returns a different body entirely.
		const url = await captureUrl((c) => c.listAgents());

		expect(url.origin + url.pathname).toBe(`${GRAPH_RP_BASE}/inventory/agents`);
		expect(url.searchParams.get("api-version")).toBe(INVENTORY_API_VERSION);
		expect(INVENTORY_API_VERSION).toBe("2026-08-01");
	});

	it("sends risk=true so the estate narrows to the agents that carry risk", async () => {
		// The bug this guards: without it the service serves every FLAGGED row,
		// and since unowned alone flags a row that is hundreds of agents at
		// riskLevel "none" — burying the handful Entra actually scored.
		const url = await captureUrl((c) => c.listAgents({ risk: true }));

		expect(url.searchParams.get("risk")).toBe("true");
	});

	it("omits risk entirely when unset, because risk=false is a real selection", async () => {
		// `?risk=false` returns the complement — the rows carrying no risk. An
		// omitted filter and a false one are different questions.
		const url = await captureUrl((c) => c.listAgents());

		expect(url.searchParams.has("risk")).toBe(false);
	});

	it("still sends risk=false when a caller explicitly asks for the complement", async () => {
		const url = await captureUrl((c) => c.listAgents({ risk: false }));

		expect(url.searchParams.get("risk")).toBe("false");
	});

	it("clamps maxCount to 1 rather than provoking a 400", async () => {
		const url = await captureUrl((c) => c.listAgents({ maxCount: 0 }));

		expect(url.searchParams.get("maxCount")).toBe("1");
	});

	it("returns an empty catalog rather than throwing when the body has no agents", async () => {
		vi.stubGlobal("fetch", mockFetch(() => jsonResponse({})));
		const catalog = await new InventoryClient(fakeToken).listAgents({ risk: true });

		expect(catalog.agents).toEqual([]);
		vi.unstubAllGlobals();
	});
});

describe("getSummary", () => {
	it("asks for JSON explicitly so a2ui is never content-negotiated in", async () => {
		const fetchMock = mockFetch(() => jsonResponse({ agents: { total: 789 } }));
		vi.stubGlobal("fetch", fetchMock);

		await new InventoryClient(fakeToken).getSummary();

		const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
		const headers = (init as RequestInit).headers as Record<string, string>;
		expect(String(url)).toBe(`${GRAPH_RP_BASE}/inventory/agents/summary`);
		expect(headers.Accept).toBe("application/json");
		// Unversioned: this route has no deployed counterpart to select between.
		expect(String(url)).not.toContain("api-version");
		vi.unstubAllGlobals();
	});
});

describe("failures", () => {
	it("carries Retry-After off a 503 so the analyst is told how long to wait", async () => {
		vi.stubGlobal(
			"fetch",
			mockFetch(
				() =>
					new Response(JSON.stringify({ error: "inventoryUnavailable", message: "not collected" }), {
						status: 503,
						headers: { "Content-Type": "application/json", "Retry-After": "5" },
					}),
			),
		);

		const err = await new InventoryClient(fakeToken)
			.listAgents({ risk: true })
			.catch((e: unknown) => e);

		expect(err).toBeInstanceOf(InventoryError);
		expect((err as InventoryError).retryAfter).toBe(5);
		expect((err as InventoryError).remediation).toMatch(/retry in 5s/i);
		vi.unstubAllGlobals();
	});

	it("explains a 403 as a directory-role problem, not a missing scope", async () => {
		vi.stubGlobal("fetch", mockFetch(() => jsonResponse({ message: "denied" }, 403)));

		const err = await new InventoryClient(fakeToken)
			.listAgents({ risk: true })
			.catch((e: unknown) => e);

		expect((err as InventoryError).remediation).toMatch(/directory role/i);
		vi.unstubAllGlobals();
	});
});
