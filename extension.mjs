/**
 * Canvas host — GitHub Copilot app entrypoint.
 *
 * Composition root and nothing else: build the dependencies, declare the
 * canvases, wire the actions. Every behaviour lives under features/.
 *
 * Three canvases, one estate:
 *   Agents          the whole inventory across every Microsoft agent plane
 *   Security Canvas the Entra identity-risk triage queue over the same agents
 *   Protect agents  a playbook that hands the operator the exact PowerShell
 *                   Purview requires, because it has no API for agent scoping
 *
 * They are separate surfaces rather than tabs because they answer different
 * questions and the model routes to them by name — "what are my agents?",
 * "what needs triage?" and "protect my sensitive data" should not land on the
 * same screen.
 *
 * Must stay at the repository root: a whole-repo plugin install lands the
 * entrypoint at ~/.copilot/extensions/<name>/extension.mjs, exactly one level
 * deep, and the loader looks nowhere else.
 *
 * NOTE: stdout is the JSON-RPC channel. Never console.log here.
 */
import { createCanvas, joinSession } from "@github/copilot-sdk/extension";

import { AgentRepository } from "./features/risky-agents/data/agent-repository.mjs";
import { CanvasStore } from "./features/risky-agents/usecases/store.mjs";
import { createCanvasActions } from "./features/risky-agents/tools/canvas-actions.mjs";
import * as triage from "./features/risky-agents/usecases/agent-triage.mjs";
import { startCanvasServer } from "./features/risky-agents/views/canvas-server.mjs";

import { PlaybookStore } from "./features/purview-protection/usecases/store.mjs";
import { createPlaybookActions } from "./features/purview-protection/tools/playbook-tools.mjs";
import * as playbook from "./features/purview-protection/usecases/run-playbook.mjs";
import { startPlaybookServer } from "./features/purview-protection/views/playbook-server.mjs";

import { InventoryRepository } from "./features/agent-inventory/data/inventory-repository.mjs";
import { InventoryStore } from "./features/agent-inventory/usecases/store.mjs";
import { createInventoryActions } from "./features/agent-inventory/tools/canvas-actions.mjs";
import * as inventory from "./features/agent-inventory/usecases/inventory-browse.mjs";
import { startInventoryServer } from "./features/agent-inventory/views/inventory-server.mjs";

/** @type {import("@github/copilot-sdk/extension").Session | undefined} */
let session;

// Indirection, not laziness: actions are constructed before joinSession()
// resolves, so they must read the session at call time rather than capture it.
const getSession = () => session;

const triageCtx = { store: new CanvasStore(), repository: new AgentRepository(), getSession };
const inventoryCtx = { store: new InventoryStore(), repository: new InventoryRepository(), getSession };

// The playbook reads DLP coverage from the same inventory the Agents panel
// shows, so it shares that repository rather than opening its own client.
const playbookCtx = { store: new PlaybookStore(), repository: inventoryCtx.repository, getSession };

const triagePanel = await startCanvasServer(triageCtx);
const inventoryPanel = await startInventoryServer(inventoryCtx);
const playbookPanel = await startPlaybookServer(playbookCtx);

const agentsCanvas = createCanvas({
	id: "agent-inventory",
	displayName: "Agents",
	description:
		"The tenant's AI agent estate across Microsoft 365 Copilot, Copilot Studio, Endpoint and other platforms, " +
		"with owner, platform, risk and status.",

	actions: createInventoryActions(inventoryCtx),

	open: async () => {
		// Never block the panel on a slow call — the store renders a loading
		// state and the refresh broadcasts when it lands.
		if (inventoryCtx.store.get().agents.length === 0) {
			inventory.refreshInventory(inventoryCtx).catch(() => {});
		}
		const state = inventoryCtx.store.get();
		const total = state.summary?.agents?.total ?? state.agents.length;
		return {
			url: `http://127.0.0.1:${inventoryPanel.port}`,
			title: "Agents",
			status: state.status === "connected" ? `${total.toLocaleString()} agents` : "sign in required",
		};
	},

	onClose: async () => inventoryPanel.close(),
});

const securityCanvas = createCanvas({
	id: "security-canvas",
	displayName: "Security Canvas",
	description:
		"Triage risky Microsoft Entra agent identities, correlated with Purview data exposure and GitHub code access.",

	actions: createCanvasActions(triageCtx),

	open: async () => {
		if (triageCtx.store.get().assessments.length === 0) {
			triage.refreshQueue(triageCtx).catch(() => {});
		}
		const { status, assessments } = triageCtx.store.get();
		return {
			url: `http://127.0.0.1:${triagePanel.port}`,
			title: "Security Canvas",
			status: status === "connected" ? `${assessments.length} at risk` : "sign in required",
		};
	},

	onClose: async () => triagePanel.close(),
});

const protectCanvas = createCanvas({
	id: "purview-protection",
	displayName: "Protect agents",
	description:
		"A playbook for blocking AI agents from reading sensitive data, using an agent-scoped Microsoft Purview " +
		"DLP policy. Returns the exact PowerShell for the user to run — Purview has no API for agent scoping.",

	actions: createPlaybookActions(playbookCtx),

	open: async () => {
		if (!playbookCtx.store.get().coverage) {
			playbook.refreshCoverage(playbookCtx).catch(() => {});
		}
		const { coverage } = playbookCtx.store.get();
		return {
			url: `http://127.0.0.1:${playbookPanel.port}`,
			title: "Protect agents",
			status: coverage && coverage.uncovered > 0 ? `${coverage.uncovered} uncovered` : "playbook",
		};
	},

	onClose: async () => playbookPanel.close(),
});

session = await joinSession({ canvases: [agentsCanvas, securityCanvas, protectCanvas] });

// Warm in the background so the first open of any panel is instant.
inventory.refreshInventory(inventoryCtx).catch(() => {});
triage.refreshQueue(triageCtx).catch(() => {});
