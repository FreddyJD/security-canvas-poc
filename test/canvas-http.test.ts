import { describe, expect, it } from "vitest";
import { isBrowserModule } from "../platform/canvas-http.mjs";

/**
 * The module-serving allowlist.
 *
 * Specced rather than trusted because it is a security boundary that looks like
 * routing: everything it allows is readable by anything that can reach the
 * canvas's loopback port, and a widened glob would leak credentials without
 * breaking a single feature test.
 */
describe("isBrowserModule", () => {
	it("serves a feature's presentation layers", () => {
		expect(isBrowserModule("features/agent-inventory/views/client.mjs")).toBe(true);
		expect(isBrowserModule("features/agent-inventory/components/agent-table.mjs")).toBe(true);
		expect(isBrowserModule("features/agent-inventory/domain/presentation.mjs")).toBe(true);
		expect(isBrowserModule("features/risky-agents/components/primitives.mjs")).toBe(true);
		// The details map runs in the browser: its camera and layout are domain,
		// its paint and gesture engine are components.
		expect(isBrowserModule("features/agent-details/domain/map-camera.mjs")).toBe(true);
		expect(isBrowserModule("features/agent-details/domain/map-layout.mjs")).toBe(true);
		expect(isBrowserModule("features/agent-details/components/access-graph.mjs")).toBe(true);
		expect(isBrowserModule("features/agent-details/views/client.mjs")).toBe(true);
	});

	it("refuses a feature's data and use-case layers", () => {
		// These hold the Graph calls and the tenant queries.
		expect(isBrowserModule("features/agent-inventory/data/inventory-repository.mjs")).toBe(false);
		expect(isBrowserModule("features/risky-agents/usecases/agent-triage.mjs")).toBe(false);
		expect(isBrowserModule("features/risky-agents/tools/mcp-tools.mjs")).toBe(false);
		expect(isBrowserModule("features/agent-details/data/agent-details-repository.mjs")).toBe(false);
		expect(isBrowserModule("features/agent-details/usecases/agent-details.mjs")).toBe(false);
		expect(isBrowserModule("features/agent-details/tools/mcp-tools.mjs")).toBe(false);
	});

	it("serves only the platform modules built for a browser", () => {
		expect(isBrowserModule("platform/html.mjs")).toBe(true);
		expect(isBrowserModule("platform/design-tokens.mjs")).toBe(true);
		expect(isBrowserModule("platform/theme-toggle.mjs")).toBe(true);
	});

	it("refuses the credential-bearing platform modules", () => {
		// The whole reason the allowlist is per-file rather than per-directory:
		// auth.mjs is the PKCE flow and the on-disk token cache.
		expect(isBrowserModule("platform/auth.mjs")).toBe(false);
		expect(isBrowserModule("platform/graph.mjs")).toBe(false);
		expect(isBrowserModule("platform/config.mjs")).toBe(false);
		expect(isBrowserModule("platform/inventory-client.mjs")).toBe(false);
	});

	it("refuses anything outside the two known roots", () => {
		expect(isBrowserModule("package.json")).toBe(false);
		expect(isBrowserModule("test/scoring.test.ts")).toBe(false);
		expect(isBrowserModule("extension.mjs")).toBe(false);
		expect(isBrowserModule("node_modules/zod/index.js")).toBe(false);
	});

	it("refuses a bare feature or platform directory listing", () => {
		expect(isBrowserModule("features")).toBe(false);
		expect(isBrowserModule("platform")).toBe(false);
		expect(isBrowserModule("features/agent-inventory")).toBe(false);
		// A file directly under a feature is not in a presentation layer.
		expect(isBrowserModule("features/agent-inventory/secrets.mjs")).toBe(false);
	});

	it("is not fooled by a nested path that re-enters a safe layer name", () => {
		// `data` is the layer here; a `components` folder beneath it must not
		// launder the parent into being servable.
		expect(isBrowserModule("features/agent-inventory/data/components/x.mjs")).toBe(false);
	});

	it("accepts Windows separators, since normalize() emits them there", () => {
		expect(isBrowserModule("features\\agent-inventory\\views\\client.mjs")).toBe(true);
		expect(isBrowserModule("platform\\auth.mjs")).toBe(false);
	});
});
