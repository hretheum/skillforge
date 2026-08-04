---
name: continuous-agent-loop
description: Patterns for continuous autonomous agent loops with quality gates, evals, and recovery controls.
origin: ECC
---

# Continuous Agent Loop

Patterns for running autonomous agent loops with quality gates, evals, and recovery controls in a CI or production context.

## Boundary Note

This skill focuses on **operating** an agent loop that is already wired up — quality gates, failure recovery, and session-level controls. For **constructing** the loop infrastructure itself (harness setup, scaffold, worktree management), use `autonomous-loops`, which remains a live complementary skill.

## Loop Selection Flow

```text
Start
  |
  +-- Need strict CI/PR control? -- yes --> continuous-pr
  |
  +-- Need RFC decomposition? -- yes --> rfc-dag
  |
  +-- Need exploratory parallel generation? -- yes --> infinite
  |
  +-- default --> sequential
```

## Combined Pattern

Recommended production stack:
1. RFC decomposition (`ralphinho-rfc-pipeline`)
2. quality gates (`plankton-code-quality` + `/quality-gate` ECC command)
3. eval loop (`eval-harness`)
4. session persistence (`nanoclaw-repl`)

> `/quality-gate` and `/harness-audit` are ECC slash-command shims, not standalone skill directories. They are available when the ECC command surface is installed.

## Failure Modes

- loop churn without measurable progress
- repeated retries with same root cause
- merge queue stalls
- cost drift from unbounded escalation

## Recovery

- freeze loop
- run `/harness-audit`
- reduce scope to failing unit
- replay with explicit acceptance criteria
