/**
 * Canvas host — GitHub Copilot app entrypoint.
 *
 * Composition root and nothing else: build the dependencies, declare the
 * canvas, wire the actions. Every behaviour it exposes lives in
 * features/risky-agents/. If this file starts growing triage logic, that logic
 * belongs in a use case.
 *
 * Must stay at the repository root — a whole-repo plugin install lands the
 * entrypoint at ~/.copilot/extensions/<name>/extension.mjs, which is exactly
 * one level deep, and the loader looks nowhere else.
 *
 * NOTE: stdout is the JSON-RPC channel. Never console.log here.
 */
import { createCanvas, joinSession } from "@github/copilot-sdk/extension";
import { AgentRepository } from "./features/risky-agents/data/agent-repository.mjs";
import { CanvasStore } from "./features/risky-agents/usecases/store.mjs";
import { createCanvasActions } from "./features/risky-agents/tools/canvas-actions.mjs";
import * as triage from "./features/risky-agents/usecases/agent-triage.mjs";
import { startCanvasServer } from "./features/risky-agents/views/canvas-server.mjs";

/** @type {import("@github/copilot-sdk/extension").Session | undefined} */
let session;

const ctx = {
	store: new CanvasStore(),
	repository: new AgentRepository(),
	// Indirection, not laziness: actions are constructed before joinSession()
	// resolves, so they must read the session at call time rather than capture
	// it at wiring time.
	getSession: () => session,
};

const { port, close } = await startCanvasServer(ctx);

const canvas = createCanvas({
	id: "security-canvas",
	displayName: "Security Canvas",
	description:
		"Triage risky Microsoft Entra agent identities, correlated with Purview data exposure and GitHub code access.",

	actions: createCanvasActions(ctx),

	open: async () => {
		// Never block the panel on a slow Graph call — the store already renders
		// a loading state, and refresh will broadcast when it lands.
		if (ctx.store.get().assessments.length === 0) {
			triage.refreshQueue(ctx).catch(() => {});
		}
		const { status, assessments } = ctx.store.get();
		return {
			url: `http://127.0.0.1:${port}`,
			title: "Security Canvas",
			status: status === "connected" ? `${assessments.length} at risk` : "sign in required",
		};
	},

	onClose: async () => close(),
});

session = await joinSession({ canvases: [canvas] });
triage.refreshQueue(ctx).catch(() => {});
