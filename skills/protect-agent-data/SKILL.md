---
name: protect-agent-data
description: Stop AI agents reading sensitive content by creating an agent-scoped Purview DLP policy. Use when asked to protect sensitive data from agents, prevent agents leaking data, apply DLP to agents, or fix agents not covered by a data protection policy.
---

# Protect agents from leaking data

Purview has no public API for agent-scoped DLP. The policy has to be created by
running Security & Compliance PowerShell, which means this workflow ends in
commands rather than in a completed change. That constraint shapes everything
below: you are handing an operator a script that rewrites tenant DLP policy.

## The path

1. **`check_agent_dlp_coverage`** — how many agents a DLP policy covers today.
   Start here. It establishes whether the change is needed and gives you the
   number to compare against afterwards.
2. **`get_protect_agents_playbook`** — the PowerShell, parameterised by
   sensitive information type, policy name and confidence level.
3. Walk the user through it, or hand it over — see the modes below.
4. **`check_agent_dlp_coverage`** again once they say they have run it. An
   unverified policy is a policy nobody knows is working.

## Guided is the default. Auto is asked for by name.

`get_protect_agents_playbook` returns `mode: "guided"` unless told otherwise.

**Guided** — the commands are for the *user* to run. Present them one step at a
time, wait for confirmation between steps, and do not execute them. Do not offer
to execute them either: an offer is an invitation, and the point of guided mode is
that a human reads each command before their tenant runs it.

**Auto** — pass `mode: "auto"` **only** when the user has explicitly asked you to
run it for them: *"just run it"*, *"do it for me"*, *"don't walk me through it"*.
That returns one composed script to run in a terminal, and the instructions in
that result take precedence over these.

"Protect my agents" is not a request for auto mode. It is the request that starts
this workflow. Inferring auto from impatience, from a long conversation, or from
the user having approved something else earlier is the mistake this asymmetry
exists to prevent.

## The parameters change what gets blocked

- **`sitName`** — the sensitive information type to enforce on. The default is a
  permissive test SIT: right for proving the mechanism works, wrong for
  production. Say which one is in play.
- **`policyName`** — defaults to `AIAgentPolicy`. If a policy by that name exists,
  the run collides with it; ask before reusing a name.
- **`confidenceLevel`** — how certain a match must be. `Low` catches more and
  false-positives more, which is what you want while proving the policy works and
  not what you want once it is enforcing. `High` is the opposite trade.

These are not cosmetic. A DLP policy that blocks too much is an outage in slow
motion; one that blocks too little is theatre. Confirm the SIT and the confidence
level before handing over commands rather than letting defaults decide.

## Reporting coverage

`check_agent_dlp_coverage` returns covered agents out of the estate. Two things to
get right:

**Coverage is not protection.** An agent covered by a permissive test SIT at low
confidence is inside the policy and barely constrained by it. Report the coverage
number with the policy that produced it.

**A gap is not the same as an unevaluated control.** The inventory distinguishes
"evaluated and failed" from "never evaluated". Only the first is a finding.
Reporting the second as a gap sends someone to fix a control that was never
measured.

## After the run

Ask the user to confirm they ran it, then re-check coverage. If the number has not
moved, the likely causes are: the policy was created but not enabled, the SIT
matched nothing, or Purview has not finished propagating — policy changes are not
instant. Say which you are ruling out rather than reporting the tool as broken.
