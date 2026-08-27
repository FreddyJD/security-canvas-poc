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

Two hosts and two features ship from one repo. Each feature owns its full stack; the hosts are
composition roots.

| Feature | Question it answers | Backend |
|---|---|---|
| `agent-inventory` | "What are my agents?" | ZTAI unified inventory (`/rp/zerotrustai`) — the estate across M365 Copilot, Copilot Studio, Endpoint |
| `risky-agents` | "What needs triage?" | Entra ID Protection (`/beta/identityProtection`) — identity risk, scored cross-pillar |
| `purview-protection` | "Protect my sensitive data" | None — Purview has no API for this, so it produces a script: guided steps, or one script Copilot runs (see below) |

Both use the same layering:

```
HOSTS    — extension.mjs (two canvas panels) · mcp.mjs (stdio; VS Code, Security Copilot, Foundry)
TOOLS    — canvas actions + MCP tools — thin adapters, no logic
VIEWS    — screens; the model routes to them by name
USECASES — all the logic: auth gaps, failures, filtering, refresh  ← the middle layer
DATA     — repository: API in, domain objects out
DOMAIN   — scoring, presentation rules, contracts: pure, zero imports
```

Dependencies point one way, inward. `domain/` imports nothing. `usecases/` depends on the
`AgentSource` *port*, not on the class that implements it, so it never learns Graph exists. The
hosts are composition roots — build the dependencies, wire the actions, and get out of the way.

**No build step.** A Copilot plugin install is a plain file copy: `npm install` never runs, so
`node_modules` cannot exist at runtime. Everything is ESM that Node executes directly. TypeScript
is still enforced — `checkJs` type-checks the JSDoc annotations, with `tsc --noEmit` in CI. That
constraint is also what removed the old generated `vendor/` copy of the scoring engine: with zero
external imports, both hosts just import the same file.

### The middle layer

Between a tool call and a component sits the part that usually rots. The rule that keeps it honest:

> A use case may touch the repository and the store, and must return plain data. It never renders
> HTML, never builds an MCP envelope, never touches `req`/`res`.

Everything that can go wrong on the way to a screen — no client id, no token, an expired session,
a 403, a throttle, an empty tenant — is resolved in `usecases/` into a `status` the UI renders
without branching on HTTP codes. That is why both hosts are thin, and why `agent-triage.test.ts`
can cover every failure mode without a browser or a network.

### Design system without a build step

The Agents view matches the Security-UX Agents page because
[`platform/design-tokens.mjs`](platform/design-tokens.mjs) carries the real `webLightTheme` /
`webDarkTheme` values from `@fluentui/tokens`, extracted verbatim. Fluent's React components can't
run here — they need React, a bundler and a build — but the palette, type ramp, spacing scale and
radii are what make a page look like Fluent, and those are just values.

They're emitted as CSS custom properties under `:root` and `[data-theme="dark"]`, so switching
theme is one attribute flip: no re-render, no stylesheet swap, no flash. An inline script in the
shell sets it from `localStorage` or `prefers-color-scheme` before first paint.

### Playbooks: when there is no API to call

Purview cannot express agent-scoped DLP through its portal, and has no public REST API for it.
The scoping is carried by `EndpointDlpRestrictions`, which only Security & Compliance PowerShell
can set. There is nothing to call.

So `purview-protection` does not pretend there is an API. It builds the exact commands, explains
what each one changes, and offers two ways to run them:

| Mode | Who runs it | What it returns |
|---|---|---|
| **Guided** (default) | The operator, step by step in their own shell | Eight explained steps with progress that survives across turns |
| **Auto** | Copilot, in a terminal | One composed script — idempotent, and it stops before changing anything if the SIT is missing |

Guided is the default and auto has to be asked for by name, in the UI or as `mode: "auto"`. The
asymmetry is the point: these commands rewrite tenant DLP policy, so the mode where nobody reads
them first is the one that requires an explicit request. In both modes the operator authenticates —
`Connect-IPPSSession` opens a browser prompt and the script waits for it, so the credentials that
can change the tenant never leave them.

The two artifacts are written separately rather than one derived from the other, because unattended
execution changes the requirements rather than the wrapper. The auto script must be idempotent (it
gets re-run after every failed sign-in), must live in one session (`Connect-IPPSSession`
authenticates the process, so splitting it would sign in and throw the session away), and must stop
on the one condition a reader would have caught — a missing sensitive information type, which would
otherwise produce two rules that enforce nothing and a tenant that *looks* protected. Concatenating
the guided steps would satisfy none of that. A test asserts both artifacts carry byte-identical
`EnforcementOverrides` JSON, since if they drift the mode you picked decides whether you are
actually protected.

The canvas holds the sequence and the progress; the human holds the credentials. That is what a
canvas is genuinely better at than a chat reply: it survives across turns, so you can run step 4,
come back, and see where you were.

A playbook is **data** — [`domain/protect-agents-playbook.mjs`](features/purview-protection/domain/protect-agents-playbook.mjs)
is a definition plus two script builders. Adding a second playbook is a file and a registration,
not a new screen.

Two things it is deliberately careful about:

- **Parameters are allowlisted, not escaped.** A SIT name is interpolated into a command a tenant
  administrator then runs. PowerShell has too many quoting contexts to escape reliably, so
  [`domain/validate.mjs`](features/purview-protection/domain/validate.mjs) rejects anything outside
  `[A-Za-z0-9 _.-]` and the script is never produced. `x"; Remove-DlpCompliancePolicy ...` does not
  get a chance to be clever. Both builders are downstream of it — auto mode is not a second, weaker
  path.
- **Each mode says one thing, emphatically.** A block of PowerShell in a tool result reads to a
  model like a task, so guided mode states "present, do not execute" in the prompt, the tool
  description and the tool output. Auto mode has the opposite failure — a model handed both a
  script and a numbered walkthrough takes the walkthrough, because it is the more conservative
  reading and it is wrong when the user just asked you to run it. So the auto result carries the
  script and *no* steps: offering one artifact removes the choice.

Progress is worded as a claim throughout ("I ran this", "3 of 8 steps marked done"). Nothing here
can see the operator's terminal, so in guided mode the only evidence that the protection is real is
re-reading coverage afterwards — which is what the last step asks for.

### Why a view registry, not generic components

The canvas exposes `show_triage_queue` / `show_agent_detail` and the model picks one. It does
**not** get primitives to compose tables from — the model already has a general-purpose renderer
(markdown in chat), so generic primitives would produce a worse markdown table that costs more
tokens, and hand the analyst a different layout on every query. Naming the screens means the canvas
owns sorting, empty states, keyboard nav and hover once. Adding a screen is: write a view, register
it, expose a matching `show_<view>` action.

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

### Sign in

Open Security Canvas and click **Sign in with Microsoft**. Your browser opens, you pick your work
account, and the triage queue loads. Nothing to configure, no codes to copy. Sign-in is cached on the
device, so it is a one-time step.

The canvas ships with its own Entra app registration (a public client, which holds no secret — the
client id is safe to publish and is what makes one-click sign-in possible). Under the hood it uses
the OAuth authorization-code flow with PKCE and a loopback redirect.

**Requirements:** `IdentityRiskyAgent.Read.All` consented in your tenant, a Security Reader-class
role, and Microsoft Agent 365 licensing. If any are missing the canvas says which one rather than
showing an empty queue.

To use your own app registration instead, set `SECURITY_CANVAS_CLIENT_ID` or write
`~/.copilot/security-canvas/config.json`:

```json
{ "clientId": "<your-app-id>", "tenantId": "<your-tenant-id>" }
```

### MCP server

## Tools

| Tool | Purpose |
|---|---|
| `list_agents` | The whole agent estate across every Microsoft platform. Answers "what are my agents?". |
| `get_protect_agents_playbook` | The agent-scoped DLP playbook. Defaults to guided steps for the user to run; `mode: "auto"` returns one script for the agent to run, and must be asked for. |
| `get_agent_estate_summary` | Tenant totals: counts by risk level, by platform, and coverage gaps. |
| `list_risky_agents` | Triage-ordered list of Entra-flagged agents. The security entry point. |
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

Detection weights live in [`features/risky-agents/domain/risk-catalog.mjs`](features/risky-agents/domain/risk-catalog.mjs). Note that live tenants emit
`unifiedAgentRisk` and `aiCompoundAccountRisk` — aggregate types absent from the published docs —
alongside the 8 documented per-behaviour types. **Tune these to your environment**; the defaults are
reasoned, not empirical.

```bash
npm install       # only the MCP SDK + zod; the canvas itself needs no deps

npm test          # 235 unit tests
npm run typecheck # tsc --noEmit over JSDoc-annotated ESM
npm run test:e2e  # real MCP protocol against a fake tenant, no credentials needed
npm run inspect   # browse tools in the MCP Inspector
```

There is no build step — `mcp.mjs` and `extension.mjs` run as-is.

**Permissions.** Entra reads need `IdentityRiskyAgent.Read.All` and one of Security Reader /
Security Operator / Security Administrator. Writes need `IdentityRiskyAgent.ReadWrite.All` and
Security Administrator.

The **inventory** API gates on directory role rather than on a Graph scope: it requires Global
Administrator or Security Administrator, so a correctly-scoped token from a non-admin still gets
403. It takes the same delegated Graph token as everything else, so no extra consent is needed.
`SECURITY_CANVAS_INVENTORY_BASE` points it at a dev ring or `http://localhost:5105`.

> The catalog it serves is the **flagged** subset — agents that are risky, unowned, publicly
> exposed, or unmonitored — not the whole estate. The true total comes from `agents/summary`, which
> is why both the canvas and `list_agents` lead with "N flagged of M in the estate" rather than
> letting the row count be read as the tenant size.

Register in `.mcp.json` (already scaffolded), or point any MCP client at `node mcp.mjs`.

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

Feature-first: everything about risky agents lives in one directory, in dependency order.

```
extension.mjs                    canvas host — composition root (must stay at repo root)
mcp.mjs                          MCP host — stdio (stdout is JSON-RPC; never console.log)

features/agent-inventory/        "what are my agents?" -- the ZTAI unified estate
  domain/       types.d.ts       the ADR-077 catalog + summary contracts
                presentation.mjs labels, risk meter, metrics, filter/sort rules
  data/         inventory-repository.mjs
  usecases/     inventory-browse.mjs · store.mjs
  components/   agent-table.mjs · metric-card.mjs · filter-bar.mjs
  views/        inventory-screen.mjs · inventory-server.mjs · client.mjs · styles.mjs
  tools/        canvas-actions.mjs · mcp-tools.mjs

features/purview-protection/     "protect my sensitive data" -- a PowerShell playbook
  domain/       types.d.ts       playbook, step and coverage contracts
                protect-agents-playbook.mjs  the playbook AS DATA -- add one here
                validate.mjs     allowlist for values that reach a privileged shell
                coverage.mjs     DLP coverage over the estate (tri-state, never inferred)
  usecases/     run-playbook.mjs · store.mjs
  components/   playbook-steps.mjs
  views/        playbook-screen.mjs · playbook-server.mjs · client.mjs · styles.mjs
  tools/        playbook-tools.mjs

features/risky-agents/           "what needs triage?" -- Entra identity risk
  domain/       types.d.ts       shared contracts, incl. the AgentSource port
                scoring.mjs      the scoring engine — the actual product
                risk-catalog.mjs detection knowledge base — tune this
  data/         agent-repository.mjs   the only layer that knows Graph exists
  usecases/     agent-triage.mjs the middle layer: all the logic
                store.mjs        observable state, broadcast over SSE
  components/   primitives.mjs   esc(), badges, cards — every string escaped here
                agent-list.mjs   queue rows          (stateless)
                agent-detail.mjs evidence pane       (stateless)
                connection-gate.mjs  sign-in / error / loading
  views/        registry.mjs     the routing table the model targets
                triage-queue.mjs the two-pane screen
                canvas-server.mjs local HTTP: serves modules, maps routes to use cases
                client.mjs       browser entry — SSE in, delegated clicks out
                styles.mjs       canvas CSS
  tools/        canvas-actions.mjs  show_* actions for the model
                mcp-tools.mjs       5 MCP tools, both delegating to usecases/
                render-text.mjs     prose for models (the MCP peer of components/)

platform/       graph.mjs        Graph client — token provider injected
                inventory-client.mjs  ZTAI inventory client (Graph RP / portal proxy)
                auth.mjs         PKCE browser sign-in, token cache, CLI fallback
                config.mjs       disk-first config (the app has no shell env)
                canvas-http.mjs  shared panel plumbing + the browser-module allowlist
                design-tokens.mjs  Fluent light/dark tokens as CSS custom properties
                theme-toggle.mjs   light/dark switching, shared by every panel
                html.mjs         esc() — the one escaping boundary, shared by all

test/           purview-playbook.test.ts      91 — injection defence, playbook shape, coverage, auto mode
                scoring.test.ts               37 — scoring properties + live-data regressions
                inventory-browse.test.ts      35 — use cases, paging, and every component
                inventory-presentation.test.ts 31 — labels, filters, sort stability
                components.test.ts            22 — rendering, escaping, routing
                agent-triage.test.ts          20 — every failure mode, no network
                graph.test.ts                 14 — requests, paging, errors, injection
                agent-repository.test.ts      10 — fetch strategy and mapping
                canvas-http.test.ts            8 — the browser-module allowlist (a security boundary)
                e2e-smoke.mjs                 real MCP protocol, stub at the Graph boundary
```

Components are loaded twice — by Node in tests and by the browser as ES modules over the canvas's
own HTTP server. They are pure string functions, so what the tests check is exactly what ships.

What the browser may load is an allowlist by *layer*, specced in `canvas-http.test.ts`: inside a
feature only `components/`, `views/` and `domain/`; inside `platform/` only `html.mjs` and
`design-tokens.mjs`. `data/`, `usecases/` and `platform/auth.mjs` are never reachable — serving all
of `platform/` to get the shared `esc()` would also hand out the token cache.

