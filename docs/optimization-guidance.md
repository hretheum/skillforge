# Token and context optimization

> **How to keep an agent run cheap without making it worse.** Every turn an agent takes pays for the
> tokens it carries: the standing context loaded at session start, the silent reasoning the model spends
> before it answers, and the model tier doing the work. Left unmanaged, these grow quietly — a session
> that overflows its window pays the full freight on every turn, a trivial task gets a flagship model and
> thousands of hidden thinking tokens, and a config file that grew over months is re-read on each request.
> This document is the cost discipline for agent teams: four rules that bound those costs, and the
> per-rule notes for applying them.
>

---

## Why this is its own concern

A team of agents is a stream of model calls, and the cost of that stream is dominated by a few levers that
are easy to ignore because none of them shows up as an error. Nothing breaks if every task runs on the
largest model; nothing breaks if a config file doubles in size; nothing breaks if reasoning runs
unbounded. The work still completes — it just costs more, often several times more, with no signal that it
did. The four rules below turn those invisible levers into deliberate choices.

Two of the rules bound **per-call** cost (which model, how much hidden reasoning), and two bound **standing**
cost (how much context every turn carries, when to discard accumulated history). Together they cover the
whole bill.

---

## Rule 1 — model-tier-first: default to the smaller capable model

The default model for a task is the **smaller, faster tier**. Escalate to a flagship model only when the
task genuinely demands deep reasoning: an architectural decision, a security analysis, or a complex
refactor that spans many interacting pieces. Most daily work — editing a file, writing a doc, wiring a
config, running and reading tests — does not need the flagship tier and finishes just as correctly on the
smaller one.

The mistake this rule prevents is **uniform escalation**: reaching for the most capable model on every task
because it is the safe choice. It is not the cheap choice, and for routine work it is not a better choice —
it is the same output at a multiple of the price. Decide the tier from the **shape of the task**, not from
caution.

## Rule 2 — cap hidden reasoning: a thinking-token ceiling

Extended ("thinking") reasoning is billed but invisible — the model can spend thousands of tokens
deliberating before it emits a single visible character, including on tasks where the answer is
immediate. Never leave it uncapped. Set an explicit **thinking-token ceiling** (a sound default is **10,000
tokens**) so that hard problems still get room to reason while trivial ones cannot silently burn budget.

The ceiling is a guard against the worst case, not a target. Simple tasks will use a fraction of it; the
point is that no single task can run away. A genuinely hard reasoning step bumping against the ceiling is a
signal worth noticing — but the default posture is **bounded, never open-ended**.

## Rule 3 — compact at milestones, not at overflow

Discard accumulated conversation history **proactively, at natural breakpoints** — after a team of agents
finishes its work, before spawning a new team, after closing out a unit of work — rather than waiting for
the context window to overflow. A session that has filled its window pays the full standing-context cost on
**every** subsequent turn; compacting at a milestone, while the relevant state is small and summarizable,
is far cheaper than carrying a bloated transcript turn after turn.

The trigger is a **completed unit of work**, not a token threshold. At a milestone the useful state can be
distilled to a short summary with little loss; mid-task it cannot, so a forced compaction there risks
dropping context the work still needs. Compact when there is a clean seam, and there usually is one exactly
at the points above.

## Rule 4 — bound the session-start payload

Everything loaded into context at session start — standing instructions, activated skills, client context —
is re-paid on **every turn** for the life of the session. Keep the total session-start payload under a firm
budget (a sound ceiling is **8,000 characters**) and **audit it whenever the standing instructions change
materially**. A standing-context file tends to accrete: each addition looks harmless on its own, but the sum
is a tax on every turn of every session.

The lever here is the **standing** files, not the per-task prompt. The discipline is to treat session-start
context as a scarce, shared resource: add to it only what every turn genuinely needs, and prune it back when
it drifts past the budget.

---

## How to apply (for agent teams)

The orchestration model here runs work as **teams of agents** — a lead that coordinates and spawns
teammates, each teammate carrying its own context window. The four rules map onto that model as follows.

**Rule 1 — model tier.** Set the default tier once, at the team level, to the smaller model; let the lead
spawn teammates on that default. Reserve a flagship-tier teammate for the specific branch that needs it (an
architecture or security review, a wide refactor), and spawn it deliberately rather than defaulting the
whole team up. Per-client defaults live in the client config (see below) so a client can pin its own
baseline.

**Rule 2 — thinking ceiling.** Carry the ceiling as a per-client default in config (see below) and apply it
to every spawned teammate, so no teammate reasons unbounded. A teammate doing genuinely hard reasoning can
be given a higher ceiling explicitly for that one branch; the default stays low.

**Rule 3 — compaction.** Treat each finished teammate, each closed unit of work, and each team handoff as a
compaction point. Concretely: compact after a team reports done and before the lead spawns the next team,
so the next team starts from a distilled summary rather than the full prior transcript. Because each
teammate has its own window, the lead's window is the one that accumulates across the run — that is the one
to keep lean.

**Rule 4 — session-start budget.** Audit the standing context whenever it changes materially: when standing
instructions grow, when a client's activated skill set changes, or when client context files are added to
the load. Keep the combined payload under the budget; if it drifts over, prune or move detail into
on-demand references that load only when needed, rather than at session start.

These defaults are not advisory only — a client can pin its own model tier and thinking ceiling in its
config, so that every team spawned for that client inherits the same economy. See
[`client-model.md`](client-model.md) for how client config is structured.
