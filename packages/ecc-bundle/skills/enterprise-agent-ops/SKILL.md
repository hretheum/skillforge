---
name: enterprise-agent-ops
description: Operate long-lived agent workloads with observability, security boundaries, and lifecycle management.
origin: ECC
---

# Enterprise Agent Ops

Use this skill for cloud-hosted or continuously running agent systems that need operational controls beyond single CLI sessions.

## Operational Domains

1. runtime lifecycle (start, pause, stop, restart)
2. observability (logs, metrics, traces)
3. safety controls (scopes, permissions, kill switches)
4. change management (rollout, rollback, audit)

## Baseline Controls

- immutable deployment artifacts
- least-privilege credentials
- environment-level secret injection
- hard timeout and retry budgets
- audit log for high-risk actions

## Metrics to Track

- success rate
- mean retries per task
- time to recovery
- cost per successful task
- failure class distribution

## Incident Pattern

When failure spikes:
1. freeze new rollout
2. capture representative traces
3. isolate failing route
4. patch with smallest safe change
5. run regression + security checks
6. resume gradually

## Kill-Switch and Rollback Patterns

When an agent workload must be halted or reversed:

**Immediate kill:**
- Signal the agent process (SIGTERM → SIGKILL with timeout) and drain the task queue.
- Revoke least-privilege credentials at the IAM/secret-manager level to prevent in-flight calls from completing.
- Set a feature flag or env var (`AGENT_ENABLED=false`) that the agent process checks at the start of each task loop iteration.

**Rollback:**
- Keep deployment artifacts immutable. Roll back by redeploying the previous pinned artifact, not by patching in place.
- For stateful agents (database writes, file mutations): maintain an undo log or a pre-run snapshot. Replay or restore before resuming.
- After rollback, run the regression suite (`eval-harness`) before re-enabling traffic.

**Graduated resume:**
- Resume with a shadow (read-only) run first; compare outputs to the expected baseline before allowing writes.
- Increase concurrency incrementally; watch the `mean retries per task` metric for drift.

## Boundary Note

This skill covers **operating** long-lived agent workloads — monitoring, kill switches, rollback, and change management. It does not cover:

- Loop **construction** and harness scaffolding → `autonomous-agent-harness`
- Loop **quality gates** and in-session recovery patterns → `continuous-agent-loop`

Use those skills to build the infrastructure; use this skill to operate it safely.

## Deployment Integrations

This skill pairs with:
- PM2 workflows
- systemd services
- container orchestrators
- CI/CD gates
