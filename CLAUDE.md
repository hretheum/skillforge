# skillforge — project instructions (CLAUDE.md)

## What this is

**skillforge** is a **composable skill engine** — one generic engine that, from a swappable per-client config,
produces ready-made **skills** (reusable agent capabilities, e.g. "create a component that conforms to a
client's design system"). The engine knows nothing about any specific client; all client knowledge lives in
separate data (config + references), so the same engine serves many clients with no code changes. It is an
**independent work written from scratch from the concept alone** (clean-room).

Spec documents live in [`docs/`](docs/) — start with [`docs/vision-and-problem.md`](docs/vision-and-problem.md)
and [`docs/architecture-overview.md`](docs/architecture-overview.md).
Glossary: [`docs/glossary.md`](docs/glossary.md).

## Status

**Engine implemented, lifecycle stage S1** (has-code, zero external dependencies). Audits requiring
dependencies (SAST/semgrep, sonatype) remain out of scope until `package.json` gains third-party deps (S2).

### Engine — current state

| Dimension | State |
|---|---|
| Public API | `runSkill()` in `src/engine/run.js` — sole entry point |
| Test suite | **1103 pass, 1 skip, 0 fail** (`node --test`) |
| Skill kinds | 6 registered: `artifact` · `instruction` · `validation` · `analysis` · `transformation` · `sync` |
| Skills in registry | 6: `create-component` · `sync-example` · `verdex-create-component` · `verdex-form-builder` · `verdex-analytics` · `verdex-disclosure-check` |
| Clients | 4: `example-studio` · `glasshouse` · `verdex` · `verdex-advisor` |
| Registry lint | 6 rules: LINT-SKILLKIND-REQUIRED · LINT-COMPOSE-REQUIRED · LINT-GOVERNANCE-SIDEEFFECTS · LINT-ECC-DUPLICATE · LINT-NAME-REQUIRED · LINT-TOOL-ALLOWLIST |
| Global store | `~/.skillforge/skills/` — `src/store/` (discovery · manifest · index) |
| CLI commands | `emit` · `mcp` · `skills add/list/config` · `init [--skills <bundle>]` |
| MCP tools | `skillforge_emit` · `skillforge_list_profiles` · `skillforge_list_skills` · `skillforge_skills_update` |
| Tooling | `node tools/registry-lint.js` · `node tools/determinism-gate.js` |

### Next on the backlog

No active sprint. Candidate work:
- `requiredTools` gate enforcement in `pretool-hook.js`
- Telemetry sink wiring
- S2 readiness: introduce first npm dependency

---

## Inherited rules (apply to all work here)

1. **Clean-room — the one-way membrane.** The **concept crosses, the code never does.** You may carry over
   ideas, patterns, and "how it should work"; you may **not** carry over a single line of anyone else's
   code, anyone else's client configuration, or any third-party confidential data. Do not copy files, do
   not cherry-pick, do not "rewrite with a foreign file open alongside."

2. **Own naming and structure.** Wherever someone else's solution is a concrete implementation detail
   (module names, directory layout, config/activation file format), invent your own. No paths into anyone
   else's repository appear anywhere in this repo.

3. **Sensitive material stays local-only.** Provenance records, legal analysis, and anything that
   references prior-employer / private context live in `private/` — **never** in the remote. Specs and
   audit artifacts in the remote contain none of it.

4. **English-only artifacts; Polish with the owner.** All files in the repo — spec, docs, code,
   comments, commit messages — are written in **English**. **Conversation with the owner is in Polish.**

5. **Validation directive — independent review before "done."** Every unit of work goes
   **implementation → independent review (a separate reviewer, never the author) → guardrail validation →
   only then done.** A teammate does not commit; the lead commits.

6. **Documentation closure.** Every significant unit of work must leave a documentation trail: update
   the relevant doc file and confirm acceptance criteria are met before marking work done.

7. **Lifecycle-stage awareness.** Always state the current stage (S0–S3) before auditing, and do not
   report a dimension that has not yet "come alive" — e.g. never flag "no tests" against a spec-only repo.

8. **Spec before code.** Write down what the engine should do, from first principles, before
   implementing — without opening any foreign file as a crib sheet.

9. **Worktree protocol for code-writing sprints.** When a team sprint involves agents writing code
   in parallel, each agent must be spawned with `isolation: "worktree"`. Lead merges branches in
   TASK-DAG dependency order — never ad-hoc. Before each merge: `git diff main..agent-branch --stat` to
   confirm scope matches the task. Run `/compact` after each team completes before spawning the next.

10. **Token optimisation.** Default model: Sonnet. Escalate to Opus only for architecture / security
    decisions. Run `/compact` at each sprint milestone. Keep total SessionStart payload under 8 000
    characters.

---

## Document style

Narrative and self-contained: each document opens with *why / what / how / scope*, explains
project-specific terms on first use (or links the [glossary](docs/glossary.md)), and places precise
tables and reference material after the narrative. Write for an intelligent professional — do not
infantilise basics.
