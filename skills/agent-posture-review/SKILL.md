---
name: agent-posture-review
description: Inventory the AI agents in a Microsoft tenant and assess their security posture — ownership, secure score, Conditional Access, Defender and Purview coverage, and what each agent can reach. Use when asked what agents exist, who owns one, why an agent's score is low, or what an agent can access.
---

# Review the agent estate

The inventory answers two different questions and confuses them easily: *how big
is the estate* and *which agents are worth looking at*. Getting these the wrong
way round produces confident, wrong numbers — so the counting rule comes first.

## Counts come from the summary, never from a row count

**`get_agent_estate_summary`** gives tenant-wide totals: how many agents exist,
how many are flagged, the breakdown by risk level and platform, how many lack an
owner or a control.

**`list_agents`** lists the agents that *carry risk* — risky, unowned, publicly
exposed, or unmonitored. It is a filtered subset by design, and it takes a
`limit` that defaults to 50.

So a `list_agents` result showing 7 rows in a tenant of 800 agents means seven
agents need attention, not that the tenant has seven agents. Never derive an
estate total by counting rows. For "how many agents do we have?", call the
summary.

## The path

1. **`get_agent_estate_summary`** for scale and shape.
2. **`list_agents`** to find the agents that matter — filter by `platforms`,
   `risks`, `unownedOnly`, or free-text `search`; sort with `sortBy` (risk-first
   by default).
3. **`get_agent_details`** with an `agentId` from step 2 for one agent's full
   picture: identity facts, secure score and the goals it fails, Conditional
   Access / Defender / Purview posture, and the resources it can reach.

`get_agent_details` needs an id from the catalog. If it reports no inventory row,
that means the catalog holds no row for that id — the catalog indexes only agents
that are risky, unowned, exposed or unmonitored, so an ordinary healthy agent is
not enumerable here. It does **not** mean the agent does not exist, and telling a
user their agent is gone sends them looking for a deletion that never happened.

## Never evaluated is not the same as failed

This is the rule that matters most in this workflow, and the one a summary is
most likely to flatten.

`get_agent_details` reports unmeasured facts as "not available" and lists
unevaluated controls **separately** from failed ones:

- **Evaluated and failed** — a real finding. The control ran and the agent did
  not meet it. Report it.
- **Never evaluated** — no measurement exists. Not a finding. Report it as
  unknown, and if it matters, say what would produce a measurement.

Collapsing the second into the first manufactures security gaps. An agent with
three failed controls and six unevaluated ones has three findings, not nine.

The same applies to a low secure score: report the specific goals it fails. "Score
is low" is not actionable; "fails these two goals" is.

## Ownership

`unownedOnly` exists because an agent with no accountable owner is a distinct
class of problem: there is nobody to ask about it, nobody to approve changes to
it, and nobody who notices when it misbehaves. Unowned agents are worth surfacing
even when their risk band is clean — that is a governance finding rather than a
risk finding, and it is fixed by assigning an owner rather than by tightening a
control.

## What an agent can reach

The details view includes reachable resources. This is the input to a blast-radius
conversation: an agent's posture is only as interesting as what it can touch. When
posture review turns up an agent with broad reach, that is the moment to move to
the risky-agent triage workflow rather than continuing to enumerate.

## When results are empty or refused

Call `get_auth_status` before concluding anything about the tenant. Signed out,
signed in without the necessary role, and a genuinely clean estate all produce
empty-looking results, and only the last one is a fact about the tenant. The tools
name the missing prerequisite — `IdentityRiskyAgent.Read.All` consent, a Security
Reader-class role, or Microsoft Agent 365 licensing — so pass that on specifically
rather than reporting a generic access problem.
