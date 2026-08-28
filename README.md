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

Two hosts and four features ship from one repo. Each feature owns its full stack; the hosts are
composition roots.

### One list, one definition of "risky"

"Show me the risky agents" and "show me my agents" land on the **same table**. The first is the
second with the risk filter applied.

There used to be a separate Security Canvas — a two-pane triage queue over Entra's `riskyAgents`,
with its own rows, its own sort order and its own empty state. It was deleted, because it was a
second answer to a question the Agents table already answers, and two surfaces that can disagree
about which agents are risky is worse than one that cannot.

The merge is safe because the two were never really different data. An inventory row's `riskLevel`
**is** Entra ID Protection risk: `AgentRiskComposer` joins `riskyAgents`, `riskyUsers` and
`riskyServicePrincipals` server-side at collect time and stores the max of the principal's level and
its detection levels. The triage queue was re-deriving, client-side and via a lossier key, a value
the row already carried.

What the queue had and a table row does not is *depth* — per-detection history and the scored
explanation behind a level. That did not go away; it moved to where depth belongs, as
`explain_agent_risk`. Clicking a row hands the agent to the model with that tool named explicitly,
so the answer is grounded in detections rather than inferred from the word "high".

| Feature | Question it answers | Backend |
|---|---|---|
| `agent-inventory` | "What are my agents?" **and** "which need triage?" | ZTAI unified inventory (`/rp/zerotrustai`) — the estate across M365 Copilot, Copilot Studio, Endpoint |
| `agent-details` | "Tell me more about *this* agent" | The same inventory, plus `agents/{id}` and `agents/{id}/exposure` — identity, score, access, and a pan-and-zoom graph |
| `risky-agents` | "*Why* is this one risky?" | Entra ID Protection (`/beta/identityProtection`) — detection history, scored cross-pillar |
| `purview-protection` | "Protect my sensitive data" | None — Purview has no API for this, so it produces a script: guided steps, or one script Copilot runs (see below) |

All four use the same layering:

```
HOSTS    — extension.mjs (three canvas panels) · mcp.mjs (stdio; VS Code, Security Copilot, Foundry)
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

The panels look like Security-UX's Unified UX POC because
[`platform/design-tokens.mjs`](platform/design-tokens.mjs) carries the real `lithiumLightTheme` /
`lithiumDarkTheme` values from `@sfe/react-theme` — the **Lithium** themes that POC and Perception
both render. SFE's React components can't run here — they need React, a bundler and a build — but
the palette, type ramp, spacing scale and radii are what make a page look like Lithium, and those
are just values.

The values are *generated*, not hand-copied:

```
node scripts/generate-design-tokens.mjs \
  ../Security-UX/node_modules/@sfe/react-theme > platform/design-tokens.mjs
```

A hand-copied palette drifts from the theme it came from. Security-UX has exactly that bug —
`app/shared/theming/lithium/tokens.custom.ts` froze a page gradient of `#202935 → #0D111D` back
when Lithium shipped none, and Lithium now ships `#0B1B31 → #0E1216`. Regenerating instead makes an
SFE upgrade a diff rather than an audit. Point the script at the **hoisted** copy: Security-UX
installs a second, older one that shadows it, which is why that repo imports through a `V2SfeTheme`
alias rather than by package name.

Two details carry over from
[`PocUnifiedux/shared/data/unifieduxTheme.ts`](../Security-UX/packages/security-unifiedux/src/app/PocUnifiedux/shared/data/unifieduxTheme.ts),
and they are the difference between Lithium and Fluent wearing Lithium's palette:

- **The radius ramp is remapped, not hand-typed.** Lithium ships `borderRadiusMedium: 4px`;
  Perception draws with 16px by pointing the ramp at whichever token *already holds* 16px. A
  literal would freeze; a lookup follows an SFE restyle.
- **The page background is a gradient composed from the theme's own stops**, published on
  `--canvas-page-background`. Lithium's ground is a soft off-centre radial wash, not a flat fill —
  dark lifts the light source to the top edge, light drops it into the upper-left.

What does *not* come across is `lithiumCustomStyleHooks`, the 54 hooks that restyle Fluent's React
components. Nothing here renders a Fluent component, so there is nothing for them to restyle; the
stylesheets under `features/*/views/styles.mjs` play that role and are written against these tokens
directly.

They're emitted as CSS custom properties under `:root` and `[data-theme="dark"]`, so switching
theme is one attribute flip: no re-render, no stylesheet swap, no flash. An inline script in the
shell sets it from `localStorage` or `prefers-color-scheme` before first paint.

Four surfaces render HTML, and all four are themed — including
[`platform/auth.mjs`](platform/auth.mjs), the page you land on after the Entra redirect. That one
can't use `data-theme`: it's served by the throwaway loopback listener that exists only for the
OAuth callback, so there's no `localStorage` on that origin to read a choice from and no toggle to
offer on a tab that closes itself. It inlines `themeDeclarations("dark")` under
`prefers-color-scheme` instead.

`test/design-tokens.test.ts` asserts the shape rather than the hexes — the values are meant to
change when SFE ships, the remapped ramp and the derived gradient are not. It also fails the build
on any colour literal in shipped source, which is the rule that would have caught the sign-in page.

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

### An agent detail page that refuses to fabricate

`agent-details` is the port of the Security-UX agent-detail skin, re-pointed at the API this repo can
actually reach: the catalog row it already holds, plus `agents/{id}` and `agents/{id}/exposure`.

Two rules do most of the work, and both are about a distinction that is invisible on screen:

**A fact nobody measured is not a fact that is false.** The identity list draws all nine rows for
every agent, and an unanswered one carries `known: false` and renders as "not available" rather than
being dropped. Dropping it would make the card's height depend on how much the sources happened to
answer, and — worse — would make "no owner is recorded" indistinguishable from "this page does not
report owners". The same rule runs through the score (`applies: false` is listed *separately* from
`met: false`), the posture sentence (a `null` protection flag is never mentioned), and the access
card (no dependency graph shows an empty state, not "0 resources").

**Evidence, not inference.** `identity.coverageTarget` says which object Conditional Access would be
evaluated *against*. It is not a verdict, and the catalog carries no verdict — so `caGoverned` stays
`null`, PolicyGoverned drops out of the score's denominator, and the posture panel says nothing about
Conditional Access at all. An earlier version read the target as `caGoverned: true`; it inflated
every identity-bearing agent's score and put "Protected by Conditional Access coverage" on screen for
agents no policy may cover. `test/agent-details-adapter.test.ts` pins all of this.

The map itself is a hub-and-rings layout rather than a force simulation, because a ring *encodes*
something: centre is the agent, inner is what reaches it, outer is what it reaches. A force graph
gives a different picture every run and its positions mean nothing a reader can learn. Detail is a
function of **how close you are** — a cluster opens as the camera approaches and closes when it
pulls back, so the map never accumulates open branches to tidy up. All of the arithmetic
(`domain/map-camera.mjs`, `domain/map-layout.mjs`) is DOM-free and covered in
`test/agent-details-map.test.ts`; the paint is asserted against a recording stub in
`test/agent-details-paint.test.ts`, which is what catches the failure a screenshot cannot show — a
Lithium token reaching `fillStyle` unresolved, where a 2D context silently ignores it and keeps the
previous fill.

`npm run preview:details` serves the page against fixtures if you want to look at it without a tenant.

### Why named screens, not generic components

The canvas exposes `show_agent_inventory` / `show_risky_agents` / `filter_agent_inventory` and the
model picks one. It does **not** get primitives to compose tables from — the model already has a
general-purpose renderer (markdown in chat), so generic primitives would produce a worse markdown
table that costs more tokens, and hand the analyst a different layout on every query. Naming the
screens means the canvas owns sorting, empty states, keyboard nav and hover once.

Note what `show_risky_agents` is: not a screen, a *filter*. It clears the other filters, pins the
risk bands and sorts worst-first. That is deliberate — a named action gives the model an obvious
target for "what needs triage?" without a second screen having to exist, and the analyst can widen
it back to the estate by clicking a pill, because it is the same table they were already looking at.

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

Open the **Agents** panel and click **Sign in with Microsoft**. Your browser opens, you pick your
work account, and the inventory loads. Nothing to configure, no codes to copy. Sign-in is cached on
the device, so it is a one-time step.

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
| `list_agents` | The tenant's agents that carry risk, across every Microsoft platform — the same set the Security Unified UX Agents page shows. Answers "what are my risky agents?". |
| `get_agent_details` | Everything known about **one** agent: identity facts, the secure score and the goals it fails, its Conditional Access / Defender / Purview DLP posture, and what it can reach. Answers "tell me more about X". |
| `get_protect_agents_playbook` | The agent-scoped DLP playbook. Defaults to guided steps for the user to run; `mode: "auto"` returns one script for the agent to run, and must be asked for. |
| `get_agent_estate_summary` | Tenant totals: counts by risk level, by platform, and coverage gaps. |
| `list_risky_agents` | Triage-ordered list of Entra-flagged agents, with composite scores. The portable peer of the `show_risky_agents` canvas action — in the Copilot app the canvas puts the same agents on screen. |
| `explain_agent_risk` | One agent's detection history in plain language, with remediation. **The depth behind a risk level** — what the Agents table sends you to. |
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

npm test          # 458 unit tests
npm run typecheck # tsc --noEmit over JSDoc-annotated ESM
npm run test:e2e  # real MCP protocol against a fake tenant, no credentials needed
npm run test:panel # boots the real Agents panel and drives it over HTTP
npm run preview   # serves the panel on fixture data to look at in a browser
npm run preview:live # same panel, on a real captured risk=true response
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

> The catalog route serves the **flagged** subset — agents that are risky, unowned, publicly
> exposed, or unmonitored — not the whole estate. Unowned alone flags a row, and most packaged
> agents have no resolved owner, so that subset is dominated by agents at `riskLevel: "none"`.
> This canvas therefore sends `?risk=true`, which narrows it to the agents that actually carry
> risk — the same call the Security Unified UX Agents page makes, so the two surfaces list the
> same agents. The true estate total comes from `agents/summary`, which is why the canvas and
> `list_agents` lead with "N agents with risk, of M in the estate" rather than letting either
> number be read as the other.

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

features/agent-inventory/        "what are my agents?" AND "which need triage?" -- the ZTAI estate
  domain/       types.d.ts       the ADR-077 catalog + summary contracts
                presentation.mjs labels, risk meter, metrics, filter/sort/empty-state rules
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

features/risky-agents/           "*why* is this agent risky?" -- Entra identity risk, MCP-only
  domain/       types.d.ts       shared contracts, incl. the AgentSource port
                scoring.mjs      the scoring engine — the actual product
                risk-catalog.mjs detection knowledge base — tune this
  data/         agent-repository.mjs   the only layer that knows Graph exists
  usecases/     agent-triage.mjs the middle layer: stateless, returns plain data
  tools/        mcp-tools.mjs       5 MCP tools, all delegating to usecases/
                render-text.mjs     prose for models

                No views/ or components/: this feature owns no screen. The
                Agents table is the only agent list, and it links here for the
                per-detection depth a table row cannot carry.

platform/       graph.mjs        Graph client — token provider injected
                inventory-client.mjs  ZTAI inventory client (Graph RP / portal proxy)
                auth.mjs         PKCE browser sign-in, token cache, CLI fallback
                config.mjs       disk-first config (the app has no shell env)
                canvas-http.mjs  shared panel plumbing + the browser-module allowlist
                design-tokens.mjs  Lithium light/dark tokens as CSS custom properties (generated)
                theme-toggle.mjs   light/dark switching, shared by every panel
                html.mjs         esc() — the one escaping boundary, shared by all

test/           purview-playbook.test.ts      91 — injection defence, playbook shape, coverage, auto mode
                inventory-browse.test.ts      54 — use cases, paging, components, risky view, investigate
                scoring.test.ts               37 — scoring properties + live-data regressions
                inventory-presentation.test.ts 31 — labels, filters, sort stability
                graph.test.ts                 14 — requests, paging, errors, injection
                agent-repository.test.ts      10 — fetch strategy and mapping
                agent-triage.test.ts          10 — query defaults, grouping, auth classification
                canvas-http.test.ts            8 — the browser-module allowlist (a security boundary)
                design-tokens.test.ts          9 — the Lithium port: remapped ramp, derived gradient,
                                                  and no colour literal in shipped source
                e2e-smoke.mjs                 real MCP protocol, stub at the Graph boundary
                panel-smoke.mjs               the real Agents panel over HTTP, stub repository
                panel-preview.mjs             not a test — serves the panel on fixtures to look at

scripts/        generate-design-tokens.mjs   regenerates platform/design-tokens.mjs from
                                             @sfe/react-theme; not run at build or test time
```

Components are loaded twice — by Node in tests and by the browser as ES modules over the canvas's
own HTTP server. They are pure string functions, so what the tests check is exactly what ships.

What the browser may load is an allowlist by *layer*, specced in `canvas-http.test.ts`: inside a
feature only `components/`, `views/` and `domain/`; inside `platform/` only `html.mjs` and
`design-tokens.mjs`. `data/`, `usecases/` and `platform/auth.mjs` are never reachable — serving all
of `platform/` to get the shared `esc()` would also hand out the token cache.

