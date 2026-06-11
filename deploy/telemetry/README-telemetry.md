# skillforge telemetry stack — how to run

> _Sources: written from the concept + general engineering knowledge + the **public** Claude Code
> monitoring documentation (metric/event/env-var names) — zero files from any third-party
> `skills-factory` codebase (clean-room). Realizes [`docs/10-telemetry-and-grafana.md`](../../docs/10-telemetry-and-grafana.md)._

## What this is (and the honest infra boundary)

This directory is the **DEPLOY stack** for skillforge observability: the collector →
Prometheus/Loki → Grafana pipeline that **receives and draws** the signals the engine emits. It is
**operator-run config**, not engine code and **not exercised by CI**:

| Part | Where | Tested in CI? |
|---|---|---|
| **Emission** — `skillforge.skill`/`skillforge.client` resource attributes, the two cache-hit fingerprints, the per-run `skill_result` event | `src/core/telemetry.js`, `src/core/cache-diagnostics.js`, `src/governance/skill-result.js` | **yes** (`node --test`) |
| **Guardrail bridge** — translate gate PASS/FAIL into an OTLP metric + event | `tools/guardrail-bridge.js` | **yes** (payload builders unit-tested) |
| **The running pipeline** — collector, Prometheus, Loki, Grafana | this directory (`deploy/telemetry/`) | **no** — an operator brings it up with `docker compose` |

Nothing here claims a live stack runs in CI. The engine produces the signals; this brings up the
place they flow to.

## Bring it up

```bash
cd deploy/telemetry
docker compose up -d
# Grafana:     http://localhost:3000   (anonymous Viewer; dashboard "skillforge — factory health")
# Prometheus:  http://localhost:9090
# Collector:   OTLP gRPC :4317 · OTLP HTTP :4318
```

The Grafana datasources and the dashboard are **provisioned as code** (`grafana/provisioning/` +
`grafana/dashboards/skillforge-factory.json`) — no click-ops; the dashboard is identical on every
bring-up.

## Point the factory at it (opt-in)

Telemetry is **off by default**. Enable it in the environment the factory runs from (a `.env` for
local runs, the CI environment for automated runs) — **never in a client config**
([`docs/03`](../../docs/03-client-model.md): observability is an engine-environment concern):

```bash
export CLAUDE_CODE_ENABLE_TELEMETRY=1
export OTEL_METRICS_EXPORTER=otlp
export OTEL_LOGS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_PROTOCOL=grpc
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
```

### The `skill` + `client` slicing dimensions (OBS-01)

The native runtime metrics have no `skill`/`client` dimension. The engine computes the per-session
resource attributes; the session runner stamps them via the standard OTEL env var. Use the helper:

```js
import { resourceAttributesEnv } from "../../src/core/telemetry.js";

// Per run/session (one session = one client + one skill — the build model makes this exact):
const env = { ...process.env, ...(resourceAttributesEnv({ skill: "create-component", client: "example-studio" }) ?? {}) };
// → env.OTEL_RESOURCE_ATTRIBUTES = "skillforge.skill=create-component,skillforge.client=example-studio"
// Launch the Claude Code session with `env`. When telemetry is disabled the helper returns null and
// nothing is stamped — the run is unaffected (opt-in / no-op).
```

`resourceAttributesEnv` is a no-op unless `CLAUDE_CODE_ENABLE_TELEMETRY` is truthy, and it APPENDS
to any existing `OTEL_RESOURCE_ATTRIBUTES` (the runtime's native attributes are preserved).

## The CI guardrail bridge (OBS-03 / T-P4-04)

The guardrails run in CI, outside any session. After the gate runner, a report step publishes each
gate's PASS/FAIL to the **same** collector:

```bash
# In CI, with the telemetry env set (same OTEL_EXPORTER_OTLP_ENDPOINT as above):
node tools/guardrail-bridge.js
# → emits skillforge.guardrail.status{gate=...} (metric) + skillforge.guardrail.result (event)
#   for each public gate, mapped to its E-family id. No collector configured → it no-ops and just
#   prints what WOULD be sent. The bridge NEVER changes the gate verdict — it only reports.
```

The bridge is a **mirror** of the gates' results, never a second definition of "what passes". The
public gates appear on the dashboard as a verifiable subset of E0–E10; the local-only gates are
bridged by the same code in private CI, with the identical payload shape.

## Privacy posture (hard rule)

No secret value and no client content ever enters telemetry
([`docs/11`](../../docs/11-security-and-secrets.md)):

- The emitters are **secret-free by construction** and **fail-closed secret-scan** their own payloads
  (the resource attributes, the cache fingerprints, the guardrail signals, the skill_result event).
- The only stamped client datum is the low-cardinality **client handle** (`example-studio`) — a grouping
  label, not content (the [`docs/10`](../../docs/10-telemetry-and-grafana.md) reconciliation note).
- The cache fingerprints are **opaque content-hash digests**, not client data.
- The collector adds a **defence-in-depth redaction** processor as belt-and-braces (drops
  `authorization`/`api_key`/`token` attributes before storage).
