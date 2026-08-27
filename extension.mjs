/**
 * Canvas host — GitHub Copilot app entrypoint.
 *
 * Composition root and nothing else: build the dependencies, declare the
 * canvases, wire the actions. Every behaviour lives under features/.
 *
 * Three canvases, one estate:
 *   Agents          the whole inventory across every Microsoft agent plane,
 *                   including "show me the risky agents" — that is this table
 *                   filtered to the risky bands, not a separate screen
 *   Agent details   ONE agent in depth: its identity facts, its secure score
 *                   and the goals it fails, its protection posture, and a
 *                   pan-and-zoom graph of everything it can reach
 *   Protect agents  a playbook that hands the operator the exact PowerShell
 *                   Purview requires, because it has no API for agent scoping
 *
 * There used to be a fourth, "Security Canvas": a two-pane triage queue over
 * Entra's riskyAgents. It was removed because it was a second answer to a
 * question the Agents table already answers. An inventory row's `riskLevel`
 * *is* Entra ID Protection risk — the service joins riskyAgents, riskyUsers and
 * riskyServicePrincipals server-side at collect time — so the triage queue was
 * a different-looking list of the same agents, with its own sort order, its own
 * empty state, and its own idea of what "high" meant. Two surfaces that can
 * disagree about which agents are risky is worse than one that cannot.
 *
 * Agent details is not a fourth answer to that question, which is the
 * distinction worth holding onto. It answers a different one — "tell me about
 * *this* agent" — and it is reached from a row rather than instead of one. It
 * lists no agents, ranks nothing, and has no opinion about which agents are
 * risky, so there is nothing for it to disagree with the table about. The depth
 * the removed triage queue had lives in two places now: per-detection history
 * in the `explain_agent_risk` MCP tool the row's investigate action points at,
 * and per-agent posture here.
 *
 * Must stay at the repository root: a whole-repo plugin install lands the
 * entrypoint at ~/.copilot/extensions/<name>/extension.mjs, exactly one level
 * deep, and the loader looks nowhere else.
 *
 * NOTE: stdout is the JSON-RPC channel. Never console.log here.
 */
import { createCanvas, joinSession } from "@github/copilot-sdk/extension";

import { PlaybookStore } from "./features/purview-protection/usecases/store.mjs";
import { createPlaybookActions } from "./features/purview-protection/tools/playbook-tools.mjs";
import * as playbook from "./features/purview-protection/usecases/run-playbook.mjs";
import { startPlaybookServer } from "./features/purview-protection/views/playbook-server.mjs";

import { InventoryRepository } from "./features/agent-inventory/data/inventory-repository.mjs";
import { InventoryStore } from "./features/agent-inventory/usecases/store.mjs";
import { createInventoryActions } from "./features/agent-inventory/tools/canvas-actions.mjs";
import * as inventory from "./features/agent-inventory/usecases/inventory-browse.mjs";
import { startInventoryServer } from "./features/agent-inventory/views/inventory-server.mjs";

import { AgentDetailsRepository } from "./features/agent-details/data/agent-details-repository.mjs";
import { DetailsStore } from "./features/agent-details/usecases/store.mjs";
import { createDetailsActions } from "./features/agent-details/tools/canvas-actions.mjs";
import { startDetailsServer } from "./features/agent-details/views/details-server.mjs";

/** @type {import("@github/copilot-sdk/extension").Session | undefined} */
let session;

// Indirection, not laziness: actions are constructed before joinSession()
// resolves, so they must read the session at call time rather than capture it.
const getSession = () => session;

const inventoryCtx = { store: new InventoryStore(), repository: new InventoryRepository(), getSession };

// The details page resolves its catalog row through the inventory repository
// the Agents panel already holds, so clicking a row opens this page without
// re-reading a catalog that is in memory — and the two surfaces cannot show
// different facts about the same agent.
const detailsCtx = {
	store: new DetailsStore(),
	repository: new AgentDetailsRepository(undefined, inventoryCtx.repository),
	getSession,
};

// The playbook reads DLP coverage from the same inventory the Agents panel
// shows, so it shares that repository rather than opening its own client.
const playbookCtx = { store: new PlaybookStore(), repository: inventoryCtx.repository, getSession };

const inventoryPanel = await startInventoryServer(inventoryCtx);
const detailsPanel = await startDetailsServer(detailsCtx);
const playbookPanel = await startPlaybookServer(playbookCtx);

const agentsCanvas = createCanvas({
	id: "agent-inventory",
	displayName: "Agents",
	description:
		"The tenant's AI agent estate across Microsoft 365 Copilot, Copilot Studio, Endpoint and other platforms, " +
		"with owner, platform, risk and status. Also answers 'what are my risky agents?' — that is this table " +
		"filtered to the agents Entra ID Protection currently scores as risky.",

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

const detailsCanvas = createCanvas({
	id: "agent-details",
	displayName: "Agent details",
	description:
		"One agent in depth: who owns it, what identity it runs as, its unified secure score and the goals it " +
		"fails, its Conditional Access / Defender / Purview DLP posture, and a pan-and-zoom graph of everything " +
		"it can reach.",

	actions: createDetailsActions(detailsCtx),

	open: async () => {
		const state = detailsCtx.store.get();
		return {
			url: `http://127.0.0.1:${detailsPanel.port}`,
			title: "Agent details",
			// The panel opens empty until an agent is chosen, and says so rather
			// than showing a spinner for an arrival that is not coming.
			status: state.vm ? state.vm.name : "pick an agent",
		};
	},

	onClose: async () => detailsPanel.close(),
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

session = await joinSession({ canvases: [agentsCanvas, detailsCanvas, protectCanvas] });

// Warm in the background so the first open of either panel is instant.
inventory.refreshInventory(inventoryCtx).catch(() => {});
