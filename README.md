# Security Canvas

Cross-pillar agent security triage for Microsoft Entra, Purview, Defender, and GitHub — exposed as MCP tools.

Answers questions like **"what are my high-risk agents?"** with a verdict and its justification, not a data dump.

```
[CRITICAL] Invoice Bot (agent-invoice)
  score 88/100 · entra high · state atRisk
  - Suspicious credential usage: New credentials were added to the agent's blueprint and then used.
  - Directory reconnaissance: The agent enumerated directory objects such as users, groups, or roles.
```

## Why this exists

Microsoft already defines "risky agent" — Entra ID Protection scores agent identities and ships
`/beta/identityProtection/riskyAgents`. This server does **not** re-implement that. It adds the thing
no single product does: **correlating identity risk with blast radius**.

> Which agents have high Entra risk **and** touched Purview-labeled sensitive data **and** can write
> to a production GitHub repo?

Identity risk says *how likely* an agent is compromised. Blast radius says *how much it matters*.
Triage needs both — and in the demo above, adding data and code context moves the same agent from
88 to 98.

## Architecture

Two layers ship from one repo, sharing a single scoring engine so they can never disagree
about severity.

```
CANVAS   — triage queue UI in the Copilot app side panel
MCP      — tools; Copilot app, VS Code, Security Copilot, Copilot Studio, Foundry
ENGINE   — src/correlate.ts + src/risk-catalog.ts  (shared by both)
DATA     — Graph · Purview · Defender · GitHub
```

The MCP server is the portable asset — five hosts, no exposure to the Copilot canvas API whose
types are still marked `@experimental`. The canvas is the surface where triage actually happens.

## Install

### Canvas extension (GitHub Copilot app)

**Customize → Canvas → Install canvas extension**, then paste the repo URL:

```
https://github.com/FreddyJD/security-canvas-poc
```

The real `extension.mjs` lives at the **repository root**, so a whole-repo install lands it exactly
where the loader looks: `~/.copilot/extensions/<name>/extension.mjs`. `extensions/security-canvas/`
holds a one-line shim that re-imports the root entrypoint, so plugin-style installs work too. This
mirrors how [`mobile-canvas-ghcp`](https://github.com/Redth/mobile-canvas-ghcp) is laid out.

> If the extension installs but never appears in **Installed**, check the nesting:
> `~/.copilot/extensions/<name>/extension.mjs` must be exactly one level deep. A repo whose
> entrypoint is only at `extensions/<name>/extension.mjs` installs "successfully" and is then
> silently ignored.

### Real tenant data

The canvas opens on a sign-in screen and shows **only real data from your tenant**. Click **Sign in**,
complete the device-code prompt, and the triage queue loads automatically. Sign-in is cached per
device, so it is a one-time step.

There is deliberately **no sample or demo mode**. A security console that can display invented agents
is worse than one that shows nothing: an analyst who mistakes placeholder rows for their tenant draws
exactly the wrong conclusion, and the failure is silent. Every non-connected state instead names the
problem — missing configuration, expired session, insufficient permission, or missing licensing.

Connect needs an app registration. **The Azure CLI cannot be used** — it is a first-party app
pre-authorized for a fixed set of Graph scopes, and `IdentityRiskyAgent.Read.All` is not among them,
so an `az` token returns 403 no matter how privileged the signed-in user is (`AADSTS65002`).

One-time setup, by a Global Administrator:

```bash
# 1. Register a public client app
az ad app create --display-name "Security Canvas" \
  --is-fallback-public-client true \
  --required-resource-accesses '[{
    "resourceAppId": "00000003-0000-0000-c000-000000000000",
    "resourceAccess": [
      {"id": "3215c57f-3faa-4295-95c2-6f14a5bc6124", "type": "Scope"},
      {"id": "8f6a01e7-0391-4ee5-aa22-a3af122cef27", "type": "Scope"}
    ]
  }]'

# 2. Grant admin consent (IdentityRiskyAgent.Read.All is admin-restricted)
az ad app permission admin-consent --id <appId>
```

Then point the canvas at it:

```bash
export SECURITY_CANVAS_CLIENT_ID=<appId>
export SECURITY_CANVAS_TENANT_ID=<tenantId>   # optional; defaults to "organizations"
```

| Variable | Purpose |
|---|---|
| `SECURITY_CANVAS_CLIENT_ID` | App registration used for device-code sign-in. Required for live data. |
| `SECURITY_CANVAS_TENANT_ID` | Tenant to sign in against. Optional. |
| `SECURITY_CANVAS_TOKEN` | A Graph access token, used as-is. Useful in CI. |

Tokens cache at `~/.copilot/security-canvas/token-cache.json` (mode `0600`) and refresh silently, so
sign-in is a one-time step per device.

**Requirements:** `IdentityRiskyAgent.Read.All` with admin consent; a Security Reader, Security
Operator, or Security Administrator role; and Microsoft Agent 365 licensing. Missing any of the three
surfaces a specific message rather than an empty queue.

> **Conditional Access.** Tenants enforcing Token Protection or device compliance may block sign-in
> from an unmanaged device (`AADSTS530084`, `AADSTS53003`). That is a policy decision, not a bug —
> the canvas names the error and offers a retry rather than failing silently.

> **Why the canvas has no npm dependencies.** A plugin install is a plain file copy: `npm install`
> never runs and `node_modules` never exists at runtime. Verified against a real install directory.
> So the canvas imports only Node builtins, `@github/copilot-sdk` (injected by the app), and
> `vendor/` — the scoring engine, generated from `src/` by `npm run build:canvas`. Never edit
> `vendor/` by hand.

### MCP server

## Tools

| Tool | Purpose |
|---|---|
| `list_risky_agents` | Triage-ordered list of flagged agents. The entry point. |
| `explain_agent_risk` | One agent's detection history in plain language, with remediation. |
| `assess_agent_blast_radius` | Correlates Entra risk with Purview + GitHub exposure. |
| `list_recent_agent_detections` | Tenant-wide activity in a time window, grouped by type. |
| `update_agent_risk_state` | dismiss / confirmCompromised / confirmSafe. **Gated.** |

### Design rules

1. **Verdicts, not dumps.** Every tool returns a judgement plus evidence. Context window is a budget.
2. **Read/write split.** Reads are `readOnlyHint`. The write tool is `destructiveHint` *and* requires
   an explicit `confirm: true`. Security Copilot refuses destructive tools outright, and no agent
   should be disabled by an ambiguous sentence.
3. **Delegated auth only.** There is no client-secret path. Every call runs as the signed-in analyst
   so Entra RBAC stays the authority. An app-only token would let this server return data the analyst
   is not cleared to see — privilege escalation wearing a helpful hat.
4. **Degraded, not zero.** An unwired pillar is reported as a coverage gap. A model shown `0` will
   confidently call an agent safe; a model told "not evaluated" will caveat.

## Scoring

Composite score is a saturating combination (probabilistic OR), not a sum:

```
score = (1 - Π(1 - wᵢ · pillarWeightᵢ)) × 99
```

Summing would let five trivial findings outrank one confirmed compromise. Two guards matter:

- Individual factors cap at `0.92`. Without this, a single max-weight factor drives the product to
  exactly zero, pinning the score at 100 and making **all further evidence invisible** — which also
  made severe agents tie and destroyed triage ordering. This was a real bug, caught by tests.
- Computed scores cap at **99**. Only an explicit human `confirmedCompromised` reaches 100; a
  heuristic should never claim more certainty than a person.

Beyond ~8 severe factors the score genuinely plateaus. That is honest: both agents are "drop
everything", and ranking them further would be false precision. Ties break deterministically
(`compareBySeverity`) so list order is stable across identical calls.

Three further guards came directly from live tenant data, and none were visible against stubs:

- **Duplicate collapse.** Entra emits the same `riskEventType` many times per agent (15+ identical
  `unifiedAgentRisk` rows observed). Scoring each one drove a *medium* agent to CRITICAL 99. Repeats
  now collapse into one factor with a bounded recurrence bonus (saturates at +15%).
- **Adjudicated agents score 0.** `confirmedSafe` and `dismissed` mean a human already ruled. They
  were surfacing as LOW; re-flagging them trains analysts to ignore the queue.
- **Entra ceiling.** Entra's `riskLevel` is an ML rollup of its own detections, so re-deriving a
  score from those same detections and landing *higher* is double counting. Identity-only evidence
  is capped at Entra's band. Purview and GitHub signals may exceed it — that is evidence Entra
  cannot see, and is the entire point of this server.

Detection weights live in [`src/risk-catalog.ts`](src/risk-catalog.ts). Note that live tenants emit
`unifiedAgentRisk` and `aiCompoundAccountRisk` — aggregate types absent from the published docs —
alongside the 8 documented per-behaviour types. **Tune these to your environment**; the defaults are
reasoned, not empirical.

```bash
npm install && npm run build

az login          # or set AZURE_TENANT_ID + AZURE_CLIENT_ID for device code
npm run test:e2e  # verify with a fake tenant, no credentials needed
npm run inspect   # browse tools in the MCP Inspector
```

**Permissions.** Reads need `IdentityRiskyAgent.Read.All` and one of Security Reader / Security
Operator / Security Administrator. Writes need `IdentityRiskyAgent.ReadWrite.All` and Security
Administrator.

Register in `.mcp.json` (already scaffolded), or point any MCP client at `node dist/index.js`.

## Status and caveats

- **Graph beta.** `riskyAgents` and `agentRiskDetections` are `/beta` — subject to change and not
  supported in production by Microsoft. Pin and monitor.
- **Licensing.** ID Protection for agents will require Microsoft Agent 365.
- **Verified against a live tenant** (2026-08): `GET /beta/identityProtection/riskyAgents` returned
  HTTP 200 with 14 real agents, scored end-to-end through this engine. Three scoring bugs were found
  only because real data was used — see Scoring below.
- **Purview and GitHub exposure are caller-supplied.** `assess_agent_blast_radius` accepts them as
  arguments; automatic collection is not wired yet. The canvas reports both pillars as coverage gaps
  on every agent, so a score is never mistaken for a complete picture.
- **Defender is intentionally absent.** Use the GA [Sentinel MCP server](https://learn.microsoft.com/azure/sentinel/datalake/sentinel-mcp-get-started)
  for incidents rather than re-implementing it.

## Roadmap

1. Auto-collect Purview exposure (`/beta/security/informationProtection`) and GitHub access.
2. Proxy Sentinel MCP for Defender incident correlation.
3. Blast-radius graph in the canvas — the one view where a visual genuinely beats text.

## Layout

```
src/
  index.ts          stdio entry point (stdout is JSON-RPC — never console.log)
  tools.ts          MCP tool definitions, rendering, safety gates
  correlate.ts      scoring engine — the actual product
  risk-catalog.ts   detection knowledge base — tune this
  graph-client.ts   delegated auth, paging, OData escaping
  types.ts          Graph beta schema + correlation types
test/
  correlate.test.ts     25 tests — scoring properties
  graph-client.test.ts  12 tests — requests, paging, errors, injection
  e2e-smoke.mjs         live MCP protocol over InMemoryTransport
```
