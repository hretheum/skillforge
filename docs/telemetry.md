# Telemetry and Grafana

---

## A two-minute glossary

A few terms recur below; each is defined once here and again, briefly, in
[`glossary.md`](glossary.md).

- **Telemetry** — the signals a running system emits about itself: counters ("how many skills ran"),
  measurements ("how many tokens that cost"), and events ("a guardrail failed at 14:02"). Telemetry
  is the raw material of observability.
- **Observability** — the property of a system that lets you answer questions about its behavior
  *from the outside*, without attaching a debugger. If you can ask "did generation quality drop this
  week?" and get an answer from the data the system already emits, the system is observable.
- **OpenTelemetry (OTEL)** — an open, vendor-neutral standard for *how* a program emits telemetry.
  Because it is a standard, any tool that speaks it can collect signals from any program that speaks
  it — no lock-in to one vendor. Claude Code speaks OTEL natively.
- **OTLP** — the **OpenTelemetry Protocol**, the wire format OTEL uses to ship signals from the
  program to a collector. Think of OTEL as the language and OTLP as the envelope it travels in.
- **metric** — a numeric signal tracked over time (a *time series*): e.g. "tokens used per minute".
  Metrics are cheap, compact, and ideal for trends and dashboards.
- **event / log** — a structured record of *one thing that happened* at a point in time, with detail
  attached (e.g. "tool `Edit` was denied permission in session X"). Richer than a metric, heavier to store.
- **Prometheus** — a database specialized for storing and querying **metrics** (time series).
- **Loki** — a database specialized for storing and querying **logs/events** (the structured records).
- **Grafana** — the **dashboard**: a single screen that reads from Prometheus and Loki and draws the
  charts and tables a human reads. This is where "observability" becomes something you can glance at.

---

## Why observe the factory at all

skillforge is a [factory](vision-and-problem.md): an engine that turns a client config into
ready-made skills, and a set of skills/commands that then run to produce artifacts. Like any factory,
it has an output you care about and a cost you want to keep in check. Without telemetry, the only way
to know how it is doing is to run it and watch — which does not scale past a handful of runs and tells
you nothing about *trends*. Five questions are worth answering continuously:

1. **Activity** — which skills and commands are being run, and how often? (Are people actually using the
   "create a component" skill, or is it dead weight?)
2. **Success and quality** — do generation runs succeed, or are they erroring out / retrying / producing
   artifacts that get thrown away?
3. **Cost** — how many tokens and how much money does the factory burn, per skill and per client? A skill
   that is ten times more expensive than its peers is a design smell worth seeing. Cost also has a
   **structural lever** worth watching directly: the factory re-sends the *same* stable prompt prefix (the
   engine/skill instructions + a client's normalized description — the "stability tiers" of
   [`architecture-overview.md`](architecture-overview.md)) on every run, and a backend that reuses a
   cached prefix charges only a small fraction for it. So **cache-hit ratio** and **cost-per-generation**
   are first-class KPIs here, not afterthoughts: a falling cache-hit ratio is the early sign that something
   broke the byte-stability the saving depends on (a non-deterministic adapter, a timestamp that crept into
   the prefix) — and it surfaces as rising cost before anyone notices it any other way.
4. **★ Guardrail health** — and this is the one specific to *this* project — are the clean-room
   **guardrails** (E0–E10, defined in the local-only guardrails document kept in `private/`) passing? A guardrail that starts
   failing is a provenance risk, and a *trend* of near-misses is an early warning that the membrane is
   under strain. We want PASS/FAIL not just at the moment of a commit but as a line on a chart over weeks.
5. **Reliability** — latency and error rates of the underlying model calls, so a slow or failing backend
   is visible rather than mistaken for "the factory being broken".

The first three are generic factory-health questions; the fourth is what makes this document particular
to skillforge — we treat **guardrail outcomes as a first-class telemetry signal**, alongside cost and
activity.

---

## How it works: skillforge runs on Claude Code, which already emits OTEL

The pivotal fact is that skillforge does not need a bespoke telemetry layer. The factory is **driven by
Claude Code** — the engine, its skills, and its commands run as Claude Code skills/commands — and Claude
Code has **native OpenTelemetry support** built in. When telemetry is switched on, Claude Code itself
emits, over OTLP:

- **metrics** — counters and measurements for sessions, token usage, cost, lines of code, commits, and more;
- **events** — structured log records for API requests, tool executions, permission decisions, and (directly
  useful to us) **skill activations**.

So the bulk of questions 1–3 and 5 above are answered for free: we turn on a feature, point it at a
collector, and the factory's own runtime reports its activity, success, and cost. Our only custom work
is question 4 — getting the **guardrail** PASS/FAIL signal (which is produced in CI, *outside* a Claude
Code session) onto the same dashboard. That bridge is described in its own section below.

> **Privacy by default.** Claude Code does *not* collect the content of user prompts by default — only
> their length — and does not log tool input arguments unless explicitly asked to. That default is the
> right one for a clean-room project: we observe *that* skills ran and *how* they performed, without
> drawing client content into the telemetry pipeline.
>
> **And zero secrets in telemetry.** This privacy posture must not be undone: adapter **credentials never
> appear in telemetry** — not in events, not in metric labels, not in log lines. Secret *references* (names)
> may be recorded for debugging; secret *values* never are. This is a hard rule of the security model — see
> [`security.md`](security.md).

---

## Architecture

The data flows in one direction, from the factory's runtime to a human's eyes. Two storage backends
sit side by side because metrics and events have different shapes and the right tool differs for each;
Grafana then reads from both and presents one unified view.

```
   ┌──────────────────────────────────────────────────────────────────────┐
   │  skillforge factory  (engine + skills + commands)                      │
   │  ── runs ON ──>  Claude Code runtime  (native OpenTelemetry)           │
   └───────────────────────────────┬──────────────────────────────────────┘
                                    │  OTLP  (metrics + events)
                                    v
                       ┌───────────────────────────┐
                       │   OpenTelemetry Collector  │   receives, batches,
                       │   (one inbound OTLP door)  │   and routes by signal type
                       └─────────┬─────────┬────────┘
                  metrics ───────┘         └─────── events / logs
                                 │                   │
                                 v                   v
                       ┌──────────────┐      ┌──────────────┐
                       │  Prometheus  │      │     Loki     │
                       │ (time series)│      │ (log/events) │
                       └───────┬──────┘      └──────┬───────┘
                               │                    │
                               └─────────┬──────────┘
                                         v
                               ┌──────────────────┐
                               │     Grafana      │  one dashboard:
                               │   (dashboard)    │  activity · quality · cost
                               └──────────────────┘  · ★ guardrail PASS/FAIL trend
                                         ^
   ┌─────────────────────────────────┐  │  metrics/events for guardrail
   │  CI  (guardrail gates E0–E10)    │──┘  PASS/FAIL  (see "Guardrails on
   │  defined locally (private/)      │     the dashboard" below)
   └─────────────────────────────────┘
```

The **OpenTelemetry Collector** is the single inbound door: every producer (the Claude Code runtime and,
later, CI) ships OTLP to it, and it fans the signals out to the right store — metrics to Prometheus,
events to Loki. The collector is optional in the simplest setups (a backend can receive OTLP directly),
but having it as a seam is worth it: it is the one place to add batching, redaction, or a second
destination later, without touching the producers. This mirrors the spirit of the rest of skillforge —
[adapters at the edges](adapters.md), a generic interior — applied to observability: the collector is
the swappable edge between "what emits signals" and "what stores them".

---

## Turning it on: environment variables

Telemetry is **opt-in** — nothing leaves the machine unless these variables are set. Configuration is
done entirely through environment variables read by the Claude Code runtime; skillforge adds no telemetry
code of its own. The minimal set:

```bash
# 1. Enable telemetry at all (the master switch — off by default)
export CLAUDE_CODE_ENABLE_TELEMETRY=1

# 2. Choose what to export (configure only what you need)
export OTEL_METRICS_EXPORTER=otlp        # otlp | prometheus | console | none
export OTEL_LOGS_EXPORTER=otlp           # otlp | console | none   (events travel as logs)

# 3. Where to send it — the collector's OTLP endpoint
export OTEL_EXPORTER_OTLP_PROTOCOL=grpc  # grpc | http/protobuf
export OTEL_EXPORTER_OTLP_ENDPOINT=http://collector:4317

# 4. Authentication, if the endpoint needs it — a secret REFERENCE, never an inline token.
#    The bearer token is a secret VALUE (docs/11): it must be resolved by the deployment's secret
#    backend, so the header carries a PLACEHOLDER, not the literal. A config-lint enforces this.
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer ${OTLP_BEARER_TOKEN}"

# 5. (Optional, for debugging) shorter export intervals than the defaults
export OTEL_METRIC_EXPORT_INTERVAL=10000 # ms; default 60000 (60s)
export OTEL_LOGS_EXPORT_INTERVAL=5000    # ms; default 5000  (5s)
```

A few notes that matter for a factory running many times:

- **`CLAUDE_CODE_ENABLE_TELEMETRY=1`** is the master switch. With it unset, the rest is inert — telemetry
  is private and off until deliberately enabled.
- **Metrics vs events use separate exporters** (`OTEL_METRICS_EXPORTER` and `OTEL_LOGS_EXPORTER`). You can
  send metrics one way and events another, or turn off either. Events ("logs" in OTEL terms) carry the
  per-occurrence detail; metrics carry the aggregable numbers.
- **The endpoint and protocol** follow the standard OTEL variables; the Claude Code runtime reads them via
  the OpenTelemetry SDK, so anything that documentation says about `OTEL_EXPORTER_OTLP_*` applies as-is.
  Per-signal overrides exist too (e.g. `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`) when metrics and events go
  to different collectors.
- **Export intervals** default to 60s for metrics and 5s for events. Shorten them while wiring things up
  so you see data quickly; restore the defaults for steady-state running to avoid needless chatter.

Because these are plain environment variables, the natural home for the factory's telemetry settings is
the same place the factory is run from (a `.env` for local runs, the CI environment for automated runs) —
*not* a client config. This keeps the [client = data only](client-model.md) principle intact:
observability is an operational concern of the engine's environment, not part of any client's description.

### The telemetry config-lint (enforced, not asserted) — SEC-P2-5

The two hard rules above — *no secret values in telemetry* and *no client content in telemetry* — are not
left to discipline; a **config-lint** enforces them, the telemetry sibling of the repo `secret-scan`
([security.md](security.md)). It lints the shipped telemetry env reference
([`deploy/telemetry/telemetry.profile-a.reference.env`](../deploy/telemetry/telemetry.profile-a.reference.env))
and fails CI on either:

- **Prompt / tool-input content logging under profile A.** Claude Code keeps prompt content and tool-input
  arguments OUT of telemetry by default; env switches can opt *into* logging them. Under **profile A**
  (EU residency + ZDR, [deployment-profiles.md](deployment-profiles.md)) that is **forbidden** —
  enabling it routes **client content** onto the telemetry plane and voids the residency/ZDR promise. The
  lint fails if any such switch (`OTEL_LOG_USER_PROMPTS`, `OTEL_LOG_TOOL_INPUTS`, …) is enabled under
  profile A.
- **An inline OTLP credential.** `OTEL_EXPORTER_OTLP_HEADERS` carries the exporter's bearer token. That
  token is a **secret value**, so the header must hold a **reference** (a `${PLACEHOLDER}` the secret
  backend resolves), never the literal — exactly the references-not-values rule of
  [security.md](security.md). The lint runs the same detector as the repo
  secret-scan over the header value and fails on a credential-shaped (inline) token, under **both**
  profiles (a secret value is a leak regardless of residency posture).

The lint is a plain JSON/env check, model-independent (`src/core/telemetry-config.js`, the CI face is
`tools/telemetry-config-lint.js`), so "telemetry is secret-free and content-free" becomes a
continuously-checked property rather than a one-time hope.

---

## What gets emitted (the signals worth dashboarding)

Claude Code emits a broad set of metrics and events; below are the ones that map onto the five questions
above. (Names are the public Claude Code metric/event names; the full list lives in the public docs linked
at the foot of this file.)

**Metrics (time series → Prometheus):**

| Metric | What it tells the factory |
|---|---|
| `claude_code.session.count` | How many factory runs (sessions) happened — raw activity. |
| `claude_code.token.usage` | Tokens consumed, **broken down by token type** (input / output / cache-read / cache-creation) and model — the basis of cost *and* of cache efficiency. The cache-read vs (input + cache-creation) split is exactly what the **cache-hit ratio** KPI is computed from. |
| `claude_code.cost.usage` | Estimated spend — money burned per run/skill/client; divided by skill-run count it gives **cost-per-generation**. |
| `claude_code.lines_of_code.count` | Lines the factory wrote/changed — a rough output-volume signal. |
| `claude_code.commit.count` / `claude_code.pull_request.count` | Commits / PRs the factory produced. |
| `claude_code.active_time.total` | Active working time — load and duration. |
| `claude_code.api_error` / `claude_code.api_request` | Backend error and request counts — reliability. |

**Events (structured records → Loki):**

| Event | What it tells the factory |
|---|---|
| `claude_code.skill_activated` | **Which skill ran, when** — the heartbeat of the factory; the per-skill activity and success view is built on this. |
| `claude_code.tool.execution` / `claude_code.tool_result` | Which tools ran and how they ended — useful for spotting a skill that fails at a particular step. |
| `claude_code.tool_decision` | **Permission decisions** (allow/deny) — directly relevant to whether the agent stayed within its sandbox. |
| `claude_code.api_request` / `claude_code.api_error` | Per-call API detail — drill-down behind the reliability metrics. |
| `claude_code.user_prompt` | That a prompt occurred (length only, **not content** by default). |

The signal we lean on hardest is **`claude_code.skill_activated`**: it is the closest thing to "the factory
produced a skill run", and slicing it by skill name and by client gives questions 1 and 2 directly.

**Attributes for slicing.** Both metrics and events carry resource/metric *attributes* — among them
`session.id`, `organization.id`, `model`, `app.version`, and (opt-in) account identifiers. These are the
dimensions you filter and group by on the dashboard: e.g. cost **per model**, activity **per session**,
errors **per version after a release**.

### Where the `skill` and `client` dimensions come from

Two of the headline KPIs slice **by skill** and **by client** — *cost per skill*, *cost per client*, and
the cache-hit ratio *grouped by client* (Row 2 below). But the attributes the runtime emits natively, listed
just above, do **not** include a `skill` or a `client` dimension. So we have to be explicit about how those
two dimensions reach the metrics, or the panels are charting a grouping that does not exist.

The native cost metric (`claude_code.cost.usage`) is labeled by `session.id`, `model`, `app.version`, and
org/account identifiers — not by skill or client. There are two honest ways to get the missing dimensions,
and skillforge uses the first because the build model makes it exact:

1. **Inject `skill` and `client` as OTEL resource attributes, set once per session (the chosen path).** The
   factory's build model gives every run a clean context: **one Claude Code session = one client and one
   skill** (a run *is* "the active client's config, this skill, one artifact" — see
   [`skills-and-commands.md`](skills-and-commands.md) §life-cycle and).
   That one-to-one mapping is what makes the injection exact: because the session never mixes clients or
   skills, stamping the session with `skillforge.skill=<skill-name>` and `skillforge.client=<client-handle>`
   as **resource attributes** correctly labels *every* metric and event that session emits — including the
   native `claude_code.cost.usage` and `claude_code.token.usage` — with no per-metric work. Resource
   attributes are applied via the standard OTEL mechanism (`OTEL_RESOURCE_ATTRIBUTES`, set per run in the
   engine environment that launches the session, **not** in a client config — observability stays an engine
   concern, [`client-model.md`](client-model.md)). The `client` value is the same low-cardinality
   handle `03` already uses (`example-studio`) — a grouping label, **not** client content or a secret (see the
   reconciliation note below) — so per-client/per-skill cost is computed directly from the native metric,
   sliced by these two injected attributes.
2. **Fallback — derive from `claude_code.skill_activated` and session correlation.** If injecting resource
   attributes is unavailable in some environment, the per-skill view can be approximated by joining the
   native `skill_activated` event (which carries the skill name) to cost metrics on `session.id`. This is
   weaker (a join, and only as clean as the one-session-one-skill assumption holds) and the *client*
   dimension still has to come from somewhere — so it is the fallback, not the default.

**If neither is wired, the panels must be honest about it:** downgrade *cost per skill / per client* and the
*cache-hit by client* to **session-grouped** and label the gap, rather than charting a dimension that is not
in the data. The default build target is path 1: `skillforge.skill` and `skillforge.client` injected as
resource attributes per session.

> **Reconciling "client = data only" with "group by client".** Telemetry may carry the client *handle*
> (`example-studio`) as a low-cardinality grouping label without breaking any rule: the `client = data only`
> principle is about *where a client's description lives* (its config, not the engine code —
> [`client-model.md`](client-model.md)), and the "no secrets/content in telemetry" rule
> ([`security.md`](security.md)) forbids secret *values* and client *content*.
> A client identifier is neither — it is a grouping key — so per-client KPIs are allowed while both rules
> hold. (See the privacy note above: lengths and identifiers, never content or credentials.)

---

## Example Grafana dashboard

One dashboard, organized top-to-bottom from "is the factory healthy?" down to "why isn't it?". Each panel
below names the signal it reads and the question it answers.

**Row 1 — Factory pulse (the glance-and-go row):**
- **Skill runs over time** — *time series* from `claude_code.skill_activated`, grouped by skill name.
  Answers "what is being used, and is usage rising or falling?".
- **Success rate** — *stat / gauge* derived from skill-activation events vs error events
  (`claude_code.api_error`, failed `claude_code.tool_result`). Answers "are runs succeeding?".
- **Cost (rolling 24h / 7d)** — *stat* on `claude_code.cost.usage`. Answers "what are we spending?".

**Row 2 — Cost and volume:**
- **Tokens by model** — *stacked time series* on `claude_code.token.usage` grouped by `model`.
- **Cost per skill / per client** — *bar gauge* on `claude_code.cost.usage` grouped by the skill and
  client attributes. Surfaces the disproportionately expensive skill.
- **★ Cache-hit ratio** — *time series / gauge* derived from `claude_code.token.usage` split by token type:
  `cache-read ÷ (input + cache-creation + cache-read)`, grouped by client. This is the **cost-lever KPI** —
  a healthy factory re-running the same client prefix should trend high and stable; a drop means the stable
  prefix stopped matching byte-for-byte and is the earliest warning of cost creep. **The cached prefix has
  two determinism owners, and a drop can come from either** (see "Who owns cache-hit determinism" below):
  tier 1 (the engine/skill text) is owned by the **core**, tier 2 (the normalized description) by the
  **input adapter** — so the panel must point an operator at *both* candidates, not one. To make the alarm
  actionable rather than half-blind, this panel reads alongside two byte-stable fingerprints that localize
  the break: a **tier-1 prefix hash** (the core's rendered engine/skill text) and a **tier-2 content hash**
  (the normalized description, from the input adapter). When the ratio drops, whichever hash changed names
  the owner at fault.
- **Cost-per-generation** — *stat / time series* of `claude_code.cost.usage ÷ skill-run count`
  (`claude_code.skill_activated`), per skill and per client. The single number that says whether the
  factory is getting cheaper or more expensive per artifact over time; reads alongside the cache-hit ratio
  (the two move together). The cost economics behind these KPIs live in
  [`compliance-and-cost.md`](compliance-and-cost.md).
- **Output volume** — *time series* on `claude_code.lines_of_code.count` and `claude_code.commit.count`.

**Row 3 — Reliability:**
- **API errors & retries** — *time series* on `claude_code.api_error` (and retries-exhausted).
- **Active time / latency** — *time series* on `claude_code.active_time.total`, to spot slow runs.

**Row 4 — ★ Guardrail health (the skillforge-specific row):**
- **Guardrail PASS/FAIL trend** — *time series / state-timeline* showing each guardrail gate (E0–E10) green
  or red over time, fed by the CI bridge below. Answers "is provenance holding?".
- **Latest guardrail run** — *table* listing every gate and its current status, with the commit/PR it ran
  against. The one place to confirm, at a glance, that the clean-room is intact.
- **Recent permission denials** — *logs panel* from `claude_code.tool_decision` (deny). A spike here can
  indicate a skill trying to step outside its sandbox.

Grafana reads metric panels from **Prometheus** and the log/event panels (the logs panel, and anything
event-derived) from **Loki**, blending both on one screen — which is exactly why we keep the two stores
side by side.

---

## Who owns cache-hit determinism

The cache-hit ratio is the single biggest cost lever, so when it drops, the dashboard has to send the
operator to the *right* cause — otherwise the most important cost KPI is "something broke, somewhere". The
trap is that the saving depends on the **whole** cached prefix being byte-stable, and that prefix is made of
**two tiers with two different owners** ([`architecture-overview.md`](architecture-overview.md)
§"stability tiers"):

- **Tier 1 — the engine/skill text** (the recipe rendered to prompt text). Its byte-determinism is owned by
  the **core**: if the core renders tier 1 non-deterministically (map iteration order, a version string, a
  date creeping into the prompt), the prefix breaks even though every adapter behaved.
- **Tier 2 — the normalized description** (the client's source, normalized). Its byte-determinism is owned by
  the **input adapter** — the [`adapters.md`](adapters.md) §determinism rule.

A cache-hit drop can therefore be *either* owner's fault, and an annotation that names only the input adapter
(as an earlier draft of the Row 2 panel did) would mis-attribute a tier-1 regression to tier 2. The fix is
two-part:

1. **Name both owners in the operator-facing annotation** — core/tier-1 *and* input-adapter/tier-2 — so the
   panel never points at one when the other broke.
2. **Carry a secondary signal that distinguishes them.** Emit two byte-stable fingerprints per run as
   low-cardinality attributes/events: a **tier-1 prefix hash** (the core's rendered engine/skill text) and a
   **tier-2 content hash** (the normalized description — this is the *same* content hash the input adapter
   already computes to key the "upload-once, reference-many" file optimization in
   [`adapters.md`](adapters.md), promoted to a first-class fingerprint, so it costs nothing new). When
   the ratio falls, whichever hash *changed* between runs localizes the break to its owner; if both held but
   the ratio still dropped, the cause is downstream of the prefix (backend/cache behavior), not a determinism
   regression.

Neither hash carries client content or secrets — each is an opaque digest, a grouping/diagnostic key — so it
respects the privacy posture above. The determinism contracts these hashes watch are stated at their source:
tier 2 in [`adapters.md`](adapters.md) (the input-adapter determinism rule) and tier 1 as a core
contract in [`architecture-overview.md`](architecture-overview.md).

---

## Getting the guardrail PASS/FAIL signal onto the dashboard

Questions 1–3 and 5 are answered by the Claude Code runtime emitting telemetry from inside a session.
Question 4 — **guardrail health** — is different, because the guardrails (defined in the local-only
guardrails document in `private/`) run in **CI**, *outside* any Claude Code session. They are scripts
that exit `0` (PASS) or `1` (FAIL): "zero foreign-repo paths", "commit authorship is private",
"PROVENANCE present", "sources note present in every spec doc", and so on (E0–E10). To put those outcomes
on the same Grafana, we bridge CI's exit codes into the same OTEL pipeline. Two complementary ways, from
simplest to richest:

1. **Push a metric per gate from CI.** After each guardrail job, the CI step emits a single OTLP metric —
   e.g. a gauge `skillforge.guardrail.status{gate="E0"}` set to `1` for PASS or `0` for FAIL — to the same
   collector the runtime uses. Because it is the *same* collector and Prometheus, the guardrail trend
   panel is just another time series. This is the minimal bridge and covers the "trend" requirement.
2. **Push an event per run.** Alongside the metric, CI emits a structured OTLP **event** (to Loki via the
   collector) carrying the gate name, PASS/FAIL, the commit/PR, and the evidence command that was run.
   This powers the "latest guardrail run" table and gives a clickable audit trail of *why* a gate failed,
   not just *that* it did.

Mechanically, the CI job already produces the binary result (the guardrail scripts' exit codes); the only
addition is a small "report" step that translates that exit code into an OTLP metric and event and sends it
to the collector — no new gate logic, just publishing the outcome the gate already computed. The
guardrails themselves remain the source of truth (defined in the local-only guardrails document in
`private/`); the dashboard is a *mirror* of their results, never a second, divergent definition of "what passes".

> **Why this matters for clean-room.** Treating guardrail outcomes as telemetry turns provenance from a
> one-shot check at commit time into a **continuously observable** property. A single FAIL is caught by CI;
> a *pattern* of FAILs or near-misses over weeks — visible only as a trend — is the early signal that the
> membrane ("concept passes through, code never") is under strain and the
> process needs attention before a real leak happens.

---

## Why telemetry pays off at scale

Telemetry is **operational scaffolding**, not part of the factory's core function. It earns its place once
there is something worth watching at volume: with more than one client and many runs, per-skill and
per-client cost/activity become real questions, and the guardrail trend becomes worth watching continuously
rather than per-commit. The collector → Prometheus/Loki → Grafana stack and the CI guardrail bridge sit
alongside the existing gates. The hooks are cheap because the runtime emits OTEL natively — no refactor
needed.

### What is built

The split between **engine-side emission** (code, tested) and the **running pipeline** (operator-run
config) is deliberate — see the honest-infra boundary in the deploy README:

- **Emission (code, `node --test`):**
  - `skillforge.skill` + `skillforge.client` per-session resource attributes (OBS-01) —
    `src/core/telemetry.js` (`sessionResourceAttributes` / `resourceAttributesEnv`, opt-in / no-op).
  - The two cache-hit determinism fingerprints (OBS-02) — `src/core/cache-diagnostics.js`
    (`cacheDiagnosticAttributes` / `attributeCacheDrop`), reusing the tier-1 prefix hash + tier-2
    content hash the prompt-tiers renderer already emits.
  - The per-run `skillforge.skill_result` PASS/FAIL event (OBS-04) — `src/governance/skill-result.js`.
  - The CI guardrail bridge (OBS-03) — `tools/guardrail-bridge.js` (gate PASS/FAIL →
    OTLP gauge + event; the public gates as a verifiable E-family subset; no-op without a collector;
    never changes a gate verdict).
  - The run wires the emission through an injected, best-effort, secret-free `telemetrySink`
    (`src/engine/run.js`) — additive, opt-in, never the reason a generation fails.
- **The running stack (operator-run config, NOT exercised by CI):** `deploy/telemetry/` — a
  docker-compose collector → Prometheus/Loki → Grafana, with datasources + the factory dashboard
  provisioned **as code** (`grafana/dashboards/skillforge-factory.json`) and a how-to-run
  ([`deploy/telemetry/README-telemetry.md`](../deploy/telemetry/README-telemetry.md)). Nothing here
  is claimed to be live until an operator brings it up.

Privacy posture holds end-to-end: every emitter is secret-free by construction and **fail-closed
secret-scans its own payload**; the only client datum stamped is the low-cardinality handle; the
cache fingerprints are opaque digests; and the collector adds a belt-and-braces redaction processor.

---

## Related documents

- The guardrail gates whose PASS/FAIL we put on the dashboard: kept local-only (in `private/`, not in the remote)
- The clean-room membrane that the guardrail trend protects: `docs/security.md`
- Why telemetry config is engine-environment, not client data: [`client-model.md`](client-model.md)
- Why secrets never enter telemetry (the security model): [`security.md`](security.md)
- The "swappable edge / generic interior" pattern the collector follows, and the input-adapter (tier-2) determinism rule + content hash the cache-hit attribution reads: [`adapters.md`](adapters.md)
- The two prefix tiers and where tier-1 byte-determinism is a core contract (the other cache-hit owner): [`architecture-overview.md`](architecture-overview.md)
- Definitions of the terms used here: [`glossary.md`](glossary.md)

---

## Sources consulted

The architecture, the reasoning, and the guardrail bridge are written from the concept and general
engineering knowledge (clean-room — zero files from any third-party `skills-factory` codebase). The exact
**names** of Claude Code metrics, events, and environment variables were taken from the **public** Claude
Code documentation, which is fair to consult:

- Claude Code — *Monitoring* (OpenTelemetry metrics, events, and configuration): <https://code.claude.com/docs/en/monitoring-usage>
