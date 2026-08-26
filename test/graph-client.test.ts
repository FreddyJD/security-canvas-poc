import { describe, expect, it, vi } from "vitest";
import { GraphClient, GraphError, odataEscape } from "../src/graph-client.js";
import type { TokenCredential } from "@azure/identity";

const fakeCredential: TokenCredential = {
	getToken: async () => ({ token: "fake-token", expiresOnTimestamp: Date.now() + 3_600_000 }),
};

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
	return vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
		handler(String(input), init),
	) as unknown as typeof fetch;
}

const jsonResponse = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("odataEscape", () => {
	it("doubles single quotes to prevent OData filter injection", () => {
		expect(odataEscape("o'brien")).toBe("o''brien");
	});

	it("neutralizes an attempted filter break-out", () => {
		const malicious = "x' or riskLevel eq 'high";
		expect(odataEscape(malicious)).toBe("x'' or riskLevel eq ''high");
	});
});

describe("GraphClient requests", () => {
	it("sends the bearer token and the include-unknown-enum-members Prefer header", async () => {
		const fetchMock = mockFetch(() => jsonResponse({ value: [] }));
		vi.stubGlobal("fetch", fetchMock);

		await new GraphClient(fakeCredential).listRiskyAgents();

		const [, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
		const headers = (init as RequestInit).headers as Record<string, string>;
		expect(headers.Authorization).toBe("Bearer fake-token");
		// Without this header Graph silently downgrades agentIdentityBlueprintPrincipal.
		expect(headers.Prefer).toBe("include-unknown-enum-members");
		vi.unstubAllGlobals();
	});

	it("builds an OR filter across risk levels and ANDs the state group", async () => {
		let captured = "";
		const fetchMock = mockFetch((url) => {
			captured = url;
			return jsonResponse({ value: [] });
		});
		vi.stubGlobal("fetch", fetchMock);

		await new GraphClient(fakeCredential).listRiskyAgents({
			riskLevels: ["high", "medium"],
			riskStates: ["atRisk"],
		});

		const filter = decodeURIComponent(new URL(captured).searchParams.get("$filter") ?? "");
		expect(filter).toBe("(riskLevel eq 'high' or riskLevel eq 'medium') and (riskState eq 'atRisk')");
		vi.unstubAllGlobals();
	});

	it("filters detections by identityId, not the deprecated agentId", async () => {
		let captured = "";
		const fetchMock = mockFetch((url) => {
			captured = url;
			return jsonResponse({ value: [] });
		});
		vi.stubGlobal("fetch", fetchMock);

		await new GraphClient(fakeCredential).listDetectionsForAgent("agent-1");

		const filter = decodeURIComponent(new URL(captured).searchParams.get("$filter") ?? "");
		expect(filter).toBe("identityId eq 'agent-1'");
		vi.unstubAllGlobals();
	});

	it("follows @odata.nextLink and stops at maxItems", async () => {
		const pages = (): typeof fetch => {
			let call = 0;
			return mockFetch(() => {
				call += 1;
				return call === 1
					? jsonResponse({
							value: [{ id: "a" }, { id: "b" }],
							"@odata.nextLink": "https://graph.microsoft.com/beta/next-page",
						})
					: jsonResponse({ value: [{ id: "c" }] });
			});
		};

		vi.stubGlobal("fetch", pages());
		const all = await new GraphClient(fakeCredential).getAllPages<{ id: string }>("/beta/x", 10);
		expect(all.map((x) => x.id)).toEqual(["a", "b", "c"]);

		// Fresh counter: the cap must be enforced on the first page, not as a
		// side effect of the previous run's paging state.
		vi.stubGlobal("fetch", pages());
		const capped = await new GraphClient(fakeCredential).getAllPages<{ id: string }>("/beta/x", 2);
		expect(capped.map((x) => x.id)).toEqual(["a", "b"]);
		vi.unstubAllGlobals();
	});

	it("caches the token across calls instead of re-authenticating", async () => {
		const getToken = vi.fn(async () => ({ token: "t", expiresOnTimestamp: Date.now() + 3_600_000 }));
		vi.stubGlobal("fetch", mockFetch(() => jsonResponse({ value: [] })));

		const client = new GraphClient({ getToken } as unknown as TokenCredential);
		await client.listRiskyAgents();
		await client.listRiskyAgents();

		expect(getToken).toHaveBeenCalledTimes(1);
		vi.unstubAllGlobals();
	});

	it("re-acquires a token that is within the 60s expiry margin", async () => {
		const getToken = vi.fn(async () => ({ token: "t", expiresOnTimestamp: Date.now() + 30_000 }));
		vi.stubGlobal("fetch", mockFetch(() => jsonResponse({ value: [] })));

		const client = new GraphClient({ getToken } as unknown as TokenCredential);
		await client.listRiskyAgents();
		await client.listRiskyAgents();

		expect(getToken).toHaveBeenCalledTimes(2);
		vi.unstubAllGlobals();
	});

	it("POSTs the documented agentIds body shape for write actions", async () => {
		let body = "";
		const fetchMock = mockFetch((_url, init) => {
			body = String(init?.body);
			return new Response(null, { status: 204 });
		});
		vi.stubGlobal("fetch", fetchMock);

		await new GraphClient(fakeCredential).confirmAgentCompromised(["a1", "a2"]);
		expect(JSON.parse(body)).toEqual({ agentIds: ["a1", "a2"] });
		vi.unstubAllGlobals();
	});
});

describe("GraphError", () => {
	it("extracts the Graph error code and message", async () => {
		vi.stubGlobal(
			"fetch",
			mockFetch(() => jsonResponse({ error: { code: "Authorization_RequestDenied", message: "Insufficient privileges." } }, 403)),
		);

		await expect(new GraphClient(fakeCredential).listRiskyAgents()).rejects.toMatchObject({
			status: 403,
			code: "Authorization_RequestDenied",
			message: "Insufficient privileges.",
		});
		vi.unstubAllGlobals();
	});

	it("survives a non-JSON error body", async () => {
		vi.stubGlobal("fetch", mockFetch(() => new Response("<html>gateway timeout</html>", { status: 504 })));

		await expect(new GraphClient(fakeCredential).listRiskyAgents()).rejects.toMatchObject({ status: 504 });
		vi.unstubAllGlobals();
	});

	it("gives status-specific remediation guidance", () => {
		expect(new GraphError("x", 401).remediation).toMatch(/az login/);
		expect(new GraphError("x", 403).remediation).toMatch(/Security Reader/);
		expect(new GraphError("x", 404).remediation).toMatch(/beta/);
		expect(new GraphError("x", 429).remediation).toMatch(/Throttled/);
	});
});
