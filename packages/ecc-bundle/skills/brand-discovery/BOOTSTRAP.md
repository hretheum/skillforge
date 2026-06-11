# Brand Discovery — First Session Setup

No active session found (`state.session` is null). Before the interview
begins, establish a home on disk and a few procedural parameters.

**Use `AskUserQuestion` for each round.** One round at a time; do not skip
ahead. After Round 2, create the directory and write the initialized
`state.json`, then open the first module immediately.

---

## Round 1 — Vault location and scope

Use `AskUserQuestion` with two questions:

1. **Where should brand-identity files live?** (free text — absolute path,
   e.g. `/Users/you/vault/brand-identity`)
   → `state.vaultPath`

2. **Who is in scope for this session?**
   Options: `Solo founder (just me)` · `Two founders` ·
   `Three founders` · `Four or more founders`
   → determines `state.participants` length (you will name them
   in Round 2 if more than one)

---

## Round 2 — Module and participant names (if needed)

Use `AskUserQuestion` with:

1. **Where do we start?**
   Options: `Module 10 — Purpose / Why (recommended)` ·
   `Module 20 — Positioning` · `Module 30 — Audience & Niche` ·
   `Already mid-way — tell me which module`
   → `state.inProgressModule` and `state.nextModule`

2. **Participant names** (only if more than one founder was chosen in Round
   1 — ask for a comma-separated list of short names or aliases to use as
   file names under `founders/`; skip this question for solo)
   → `state.participants[]`

---

## After Round 2 — Setup actions

1. **Write the initialized `state.json`** to `context.statePath` (the path
   provided in context — this is the skillforge client resource file). The
   Write tool creates any missing parent directories automatically; there is
   no need to create the vault directory separately.

```json
{
  "session": "<client-id>-brand-<YYYY-MM>",
  "vaultPath": "<absolute vault path from Round 1>",
  "statePath": "<context.statePath>",
  "completedModules": [],
  "inProgressModule": "<chosen module file, e.g. 10_purpose-why.md>",
  "nextModule": "<next in sequence, e.g. 20_positioning.md>",
  "participants": ["<name-1>", ...],
  "lastUpdated": "<ISO-8601 timestamp>"
}
```

2. **Also write the first module placeholder** at
   `{vaultPath}/modules/{inProgressModule}` (can be empty beyond a heading) so
   the directory exists for future module writes.

3. **Confirm to the user:**
   > "Session created at `{vaultPath}`. Starting with Module 10 — Purpose /
   > Why. Let's begin."

---

## Module 10 — Purpose / Why (opening question)

*Skip to the chosen module if the user picked a different starting point.*

Goal: surface the studio's **core belief** — the Why that exists
independently of what the studio sells or how it delivers.

**Ask this question now** (do not show the setup summary first):

> "Before we talk about what you do — why does this studio exist? Not the
> pitch version, but the real reason you decided to build this together."

After the answer: paraphrase, then choose the most alive thread and go
deeper with a laddering probe ("Why does that matter to you?") or 5 Whys.
Keep going until a core value surfaces, not a capability statement.

**Things to capture in `10_purpose-why.md`:**
- The core belief driving the work (Sinek's Why)
- The behavioural How (values in action, not poster slogans)
- What the studio refuses to be or do
- One or two founder quotes strong enough to become internal anchors

**Saturation signal:** the founding story loops back to itself; no new
value surfaces on a third "Why does that matter?"

---

*After completing the chosen first module: write the module file + update
`state.json`, then ask: "Shall we continue to the next module now, or
save this for another session?"*
