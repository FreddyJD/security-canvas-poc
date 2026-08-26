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

MCP is the foundation; a canvas is a UI layer added later. They are orthogonal — the reference
[`mobile-canvas-ghcp`](https://github.com/Redth/mobile-canvas-ghcp) ships both from one plugin manifest.

```
CANVAS   — UI, Copilot app only                    (not yet built)
MCP      — tools; works in Copilot app, VS Code,   ← you are here
           Security Copilot, Copilot Studio, Foundry
DATA     — Graph · Purview · Defender · GitHub
```

Building the MCP server first is deliberate: it is portable across five hosts and is not exposed to
the Copilot canvas API, whose types are still marked `@experimental`.

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

Detection weights live in [`src/risk-catalog.ts`](src/risk-catalog.ts) — all 8 Entra detection types
with meaning, impact, and remediation. **Tune these to your environment**; the defaults are reasoned,
not empirical.

## Setup

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
- **Not verified against a live tenant.** All 37 unit tests and the e2e suite pass against stubs.
  The Graph request shapes match the documented schema, but no real tenant response has been observed.
- **Purview and GitHub exposure are caller-supplied.** `assess_agent_blast_radius` accepts them as
  arguments; automatic collection is not wired yet.
- **Defender is intentionally absent.** Use the GA [Sentinel MCP server](https://learn.microsoft.com/azure/sentinel/datalake/sentinel-mcp-get-started)
  for incidents rather than re-implementing it.

## Roadmap

1. Auto-collect Purview exposure (`/beta/security/informationProtection`) and GitHub access.
2. Proxy Sentinel MCP for Defender incident correlation.
3. Canvas UI — a triage queue and blast-radius graph, where visuals beat text. A plain list does not
   need a canvas.

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
