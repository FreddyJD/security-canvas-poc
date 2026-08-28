---
name: triage-risky-agents
description: Investigate agents Microsoft Entra has flagged as risky in a tenant, decide which ones actually matter, and act on them. Use when asked what needs triage, why an agent was flagged, what happened overnight, or whether a flagged agent is a real problem.
---

# Triage risky agents

Entra flags agent identities the way it flags user identities: on signals, not on
consequences. A flagged agent that can reach nothing is noise; an unflagged agent
with write access to production is a problem the risk list will never show you.
Triage is the work of telling those apart, and it is why "list the risky agents"
is the start of the job rather than the whole of it.

## The path

1. **`list_risky_agents`** — the flagged set, worst first. This is a queue to work,
   not a report to hand over.
2. **`explain_agent_risk`** — for one agent: the detections, what each one means,
   and what it implies. Answers *why is this on the list?*
3. **`assess_agent_blast_radius`** — identity risk weighed against what the agent
   can actually reach. Answers *does it matter?*
4. **`update_agent_risk_state`** — only after the user decides. See below.

Steps 2 and 3 are per agent. Do not run them across the whole queue speculatively:
pick the agents whose risk band and reach justify the attention, and say why you
picked them.

For "what happened last night?", use **`list_recent_agent_detections`** instead —
it is tenant-wide and grouped by detection type, so it answers the time-window
question without walking the queue. Entra retains detections for 90 days; a window
beyond that returns nothing, which is a retention boundary and not a quiet tenant.

## Judgment

**Rank by consequence, not by severity.** The risk band is Entra's opinion about
the signal. Blast radius is the question the analyst is actually asking. A medium
agent with production write access outranks a high agent that can reach one
mailbox — say so plainly when the ordering disagrees with the band.

**A partial blast radius is not a clean one.** `assess_agent_blast_radius` takes
Purview and GitHub exposure as inputs. Omitted pillars come back reported as
degraded, and that wording is deliberate: unknown exposure is not zero exposure.
Never round an unassessed pillar down to "no exposure found" — pass what you know,
and name what you could not check.

**Do not describe the flagged set as the estate.** `list_risky_agents` is the
Entra identity-risk view. It is a filtered subset, and a tenant with 6 flagged
agents may hold 800. When the user asks how many agents they have, that is
`get_agent_estate_summary`.

**Detections are evidence, not conclusions.** `explain_agent_risk` returns
plain-language meaning for each detection because the raw event types
(`signInSpike` and friends) do not survive translation to a non-specialist.
Report what the signal indicates, then what it would take to confirm it. Entra
flagged the agent; it did not convict it.

## Writes need a decision, not an inference

`update_agent_risk_state` changes security posture in the tenant:

| Action | Effect |
|---|---|
| `confirmCompromised` | Sets risk to high and **triggers risk-based Conditional Access.** Can lock an agent out of the resources it needs. |
| `confirmSafe` | Clears risk and teaches Entra to stop flagging similar activity. Suppresses future signal. |
| `dismiss` | Clears the current finding, keeps flagging similar activity. |

Rules, in order:

1. **Never call this to tidy up.** A queue full of stale findings is not a reason
   to dismiss them. The user decides; you carry out the decision.
2. **Ask before every call, naming the agents and the consequence.** Not "shall I
   mark these safe?" but "this clears risk on 4 agents and stops Entra flagging
   this pattern again."
3. **`confirm: true` records that the user approved.** It is not a parameter to
   fill in so the call succeeds. Setting it without having asked is the one
   failure here that cannot be undone by a later call.
4. **Batch only what the user batched.** Approval for one agent is not approval
   for the twelve next to it.

Requires Security Administrator and `IdentityRiskyAgent.ReadWrite.All` — a
permission error here is about the operator's role, not about the agent.

## When the queue is empty

An empty result has three causes that look identical and need opposite responses:

- **Not signed in** — `get_auth_status`, then `sign_in`.
- **Signed in without the role** — needs `IdentityRiskyAgent.Read.All` consented,
  a Security Reader-class role, and Microsoft Agent 365 licensing. The tools name
  the missing one; pass that on rather than paraphrasing it as "no access".
- **Genuinely nothing flagged** — a real and reportable answer.

Check before concluding. "No risky agents" is a claim about the tenant, and it is
the wrong thing to tell a security team who is simply signed out.
