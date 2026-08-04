---
name: ralphinho-rfc-pipeline
description: RFC-driven multi-agent DAG execution pattern with quality gates, merge queues, and work unit orchestration.
origin: ECC
---

# Ralphinho RFC Pipeline

Inspired by [humanplane](https://github.com/humanplane) style RFC decomposition patterns and multi-unit orchestration workflows.

Use this skill when a feature is too large for a single agent pass and must be split into independently verifiable work units.

## Skill Routing: This vs Related Skills

Three skills share the orchestration space — pick the right one:

| Skill | Best for |
|-------|----------|
| **ralphinho-rfc-pipeline** (this skill) | A defined RFC or feature spec exists; work must be decomposed into a formal DAG with unit specs, quality gates per unit, and a merge queue. The structure is the point — you want a traceable, replayable pipeline with scorecards. |
| `autonomous-loops` | You need a self-driving, continuous feedback loop that keeps running without human checkpoints — the emphasis is on autonomy and persistence, not formal DAG decomposition. |
| `team-agent-orchestration` | You are managing multiple agents as a Kanban team with ownership, board state, and control pane visibility — the emphasis is on agent coordination and branch/worktree management rather than a formal RFC pipeline. |

When in doubt: if you have an RFC document and want each work unit to produce a scorecard and merge-queue entry, use this skill. If you just want agents running in parallel without a formal spec, reach for `team-agent-orchestration`.

## Pipeline Stages

1. RFC intake
2. DAG decomposition
3. Unit assignment
4. Unit implementation
5. Unit validation
6. Merge queue and integration
7. Final system verification

## Unit Spec Template

Each work unit should include:
- `id`
- `depends_on`
- `scope`
- `acceptance_tests`
- `risk_level`
- `rollback_plan`

## Complexity Tiers

- Tier 1: isolated file edits, deterministic tests
- Tier 2: multi-file behavior changes, moderate integration risk
- Tier 3: schema/auth/perf/security changes

## Quality Pipeline per Unit

1. research
2. implementation plan
3. implementation
4. tests
5. review
6. merge-ready report

## Merge Queue Rules

- Never merge a unit with unresolved dependency failures.
- Always rebase unit branches on latest integration branch.
- Re-run integration tests after each queued merge.

## Recovery

If a unit stalls:
- evict from active queue
- snapshot findings
- regenerate narrowed unit scope
- retry with updated constraints

## Outputs

- RFC execution log
- unit scorecards
- dependency graph snapshot
- integration risk summary
