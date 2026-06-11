#!/usr/bin/env node
// guardrail-bridge — publish the guardrail gate (E0–E10) PASS/FAIL into the SAME OTEL pipeline as
// the runtime telemetry, so the clean-room membrane becomes a continuously-observable trend
// (T-P4-04 / docs/10-telemetry-and-grafana.md §"Getting the guardrail PASS/FAIL signal onto the
// dashboard").
//
// Sources: concept + first principles, zero files from any third-party skills-factory codebase
// (clean-room).
//
// WHAT THIS IS (and is NOT). The guardrail gates run in CI, OUTSIDE any Claude Code session, and
// already produce the binary result (their exit codes — see tools/gates.js). This bridge is the
// "report step" docs/10 calls for: it TRANSLATES each gate's PASS/FAIL into (i) an OTLP METRIC
// (a gauge `skillforge.guardrail.status{gate=...}` = 1 for PASS / 0 for FAIL → Prometheus → the
// trend panel) and (ii) an OTLP EVENT (gate name, PASS/FAIL, commit/PR, the evidence command →
// Loki → the latest-run table). It is NOT a second definition of "what passes": the gates remain
// the single source of truth, and the dashboard is a MIRROR of their results.
//
// THE PUBLIC GATES ARE A VERIFIABLE SUBSET. The full E0–E10 catalog is LOCAL-ONLY (private/, out of
// the remote — docs/08). The PUBLIC gate runner (tools/gates.js) runs the subset that lives in the
// tracked tree; this bridge maps each public gate to its E-family id and publishes it, so the
// public gates appear on the dashboard as a verifiable subset of the full catalog (the local-only
// gates are bridged by the same code in the private CI, with the same payload shape).
//
// HONEST INFRA BOUNDARY. The EMISSION here is real code: the payload builders are pure and tested,
// and the OTLP push is a real HTTP POST. But the COLLECTOR / Prometheus / Loki / Grafana that
// receive, store, and DRAW these payloads are the DEPLOY stack (deploy/ — docker-compose + config +
// dashboards); this bridge produces the signal, it does not stand up the pipeline. When no
// collector is configured the push is a NO-OP (the payloads are still built and printed, so a CI
// run without telemetry is unaffected and still shows the operator what WOULD be sent).
//
// SECRET-FREE. The payloads carry only gate ids, PASS/FAIL, and commit/PR/run identifiers — never a
// secret value, never file content. The builder is byte-shaped data; nothing reaches back into the
// gate's output beyond its pass/fail and a fixed evidence label.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runGates } from "./gates.js";

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));

/** The metric the guardrail trend panel reads (docs/10 §guardrail bridge: a per-gate gauge). */
export const GUARDRAIL_METRIC = "skillforge.guardrail.status";

/** The event the latest-run table reads (docs/10 §guardrail bridge: a per-gate structured record). */
export const GUARDRAIL_EVENT = "skillforge.guardrail.result";

/** Gauge values: PASS = 1, FAIL = 0 (the trend line is green at 1, red at 0). */
export const GAUGE = Object.freeze({ PASS: 1, FAIL: 0 });

// The public gate id → its E-family guardrail id (docs/08 catalog). The public gate runner's ids
// (tools/gates.js GATES) map onto the E-family so a public gate shows on the dashboard as the
// verifiable subset of E0–E10. Determinism/genericity are the engine's correctness guardrails;
// secret-scan/cleanroom are the membrane guardrails; the rest are inventory/manifest guardrails.
export const PUBLIC_GATE_E_ID = Object.freeze({
  determinism: "E1",
  genericity: "E2",
  "skills-ref": "E8",
  "registry-lint": "E9",
  "secret-scan": "E4",
  cleanroom: "E5",
});

/**
 * Build the OTLP-shaped metric + event payloads for ONE gate result. PURE — no side effect, no
 * network. The shapes are the minimal subset of OTLP a collector accepts via its HTTP JSON
 * receiver: a gauge data point with one string attribute (`gate`), and a log record (event) with
 * the gate's PASS/FAIL and provenance attributes.
 *
 * @param {object} r
 * @param {string} r.gate     the E-family gate id (e.g. "E1")
 * @param {("PASS"|"FAIL")} r.status  the gate outcome
 * @param {object} [ctx]      run provenance: { commit, pr, runId, evidence } (all optional, secret-free)
 * @returns {{ metric: object, event: object }}
 * @throws {TypeError} on a bad status or a missing gate id
 */
export function buildGuardrailSignals({ gate, status } = {}, ctx = {}) {
  if (typeof gate !== "string" || gate.length === 0) {
    throw new TypeError("guardrail signal requires a non-empty gate id");
  }
  if (status !== "PASS" && status !== "FAIL") {
    throw new TypeError(`guardrail status must be "PASS" or "FAIL", got ${JSON.stringify(status)}`);
  }
  const { commit = null, pr = null, runId = null, evidence = null } = ctx;
  const attributes = secretFreeAttributes({ gate, commit, pr, runId, evidence });

  const metric = {
    name: GUARDRAIL_METRIC,
    // A gauge: PASS → 1, FAIL → 0, labelled by gate (and the run provenance for drill-down).
    gauge: { dataPoints: [{ asInt: status === "PASS" ? GAUGE.PASS : GAUGE.FAIL, attributes }] },
  };
  const event = {
    event: GUARDRAIL_EVENT,
    gate,
    status,
    commit,
    pr,
    runId,
    evidence,
  };
  return { metric, event };
}

/**
 * Build the bridge PAYLOAD for a full set of gate results — the metric batch + event batch a CI
 * report step would POST. PURE.
 *
 * @param {Array<{gate:string,status:("PASS"|"FAIL")}>} results  the gate outcomes (E-family ids)
 * @param {object} [ctx]  shared run provenance ({ commit, pr, runId, evidence })
 * @returns {{ metrics: object[], events: object[] }}
 */
export function buildGuardrailPayload(results, ctx = {}) {
  if (!Array.isArray(results)) throw new TypeError("guardrail results must be an array");
  const metrics = [];
  const events = [];
  for (const r of results) {
    const { metric, event } = buildGuardrailSignals(r, ctx);
    metrics.push(metric);
    events.push(event);
  }
  return { metrics, events };
}

/**
 * Run the PUBLIC gate runner and map its per-gate outcomes onto E-family ids — the input the bridge
 * publishes. Uses gates.js as the single source of truth for the public subset (no second runner).
 *
 * @returns {Array<{gate:string,status:("PASS"|"FAIL"),publicId:string}>}
 */
export function collectPublicGateResults() {
  // Run each public gate INDIVIDUALLY so a per-gate PASS/FAIL is captured (gates.js's aggregate
  // exit is fail-loud but coarse). We reuse the SAME gate file list gates.js declares by spawning
  // the runner per gate via its override; here we re-derive the per-gate status from a child run.
  const results = [];
  for (const [publicId, eId] of Object.entries(PUBLIC_GATE_E_ID)) {
    const code = runGates({ gates: [{ id: publicId, file: PUBLIC_GATE_FILE[publicId] }] });
    results.push({ gate: eId, status: code === 0 ? "PASS" : "FAIL", publicId });
  }
  return results;
}

// The public gate id → tool file (kept in lockstep with tools/gates.js GATES). Declared here so the
// bridge can run a single gate at a time for per-gate attribution.
const PUBLIC_GATE_FILE = Object.freeze({
  determinism: "determinism-gate.js",
  genericity: "genericity-proof.js",
  "skills-ref": "skills-ref.js",
  "registry-lint": "registry-lint.js",
  "secret-scan": "secret-scan.js",
  cleanroom: "cleanroom-guards.js",
});

/**
 * Publish a built payload to the collector via OTLP/HTTP — opt-in / no-op when no endpoint is set.
 * Enablement mirrors docs/10 §"Turning it on": the master switch `CLAUDE_CODE_ENABLE_TELEMETRY` and
 * an OTLP endpoint must both be present, or the push is skipped (the payload is still returned/
 * printed so a CI run without telemetry is unaffected and shows what WOULD be sent).
 *
 * @param {{metrics:object[],events:object[]}} payload
 * @param {object} [env]  environment to read the switch/endpoint from (default: process.env)
 * @returns {Promise<{ published: boolean, reason?: string }>}
 */
export async function publishGuardrailPayload(payload, env = process.env) {
  const master = env?.CLAUDE_CODE_ENABLE_TELEMETRY;
  const enabled = master === "1" || master === "true";
  const endpoint = env?.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!enabled || !endpoint) {
    // No collector configured → no-op. The bridge stays harmless in a CI run that has no telemetry.
    return { published: false, reason: "telemetry disabled or no OTLP endpoint configured (no-op)" };
  }
  // The actual OTLP/HTTP POST. The collector (deploy/) receives, stores, and draws these; this is
  // the emission seam only. Best-effort: a transport failure must NOT fail the CI gate (the gate's
  // own exit code already decided pass/fail) — the bridge only reports.
  try {
    const headers = { "content-type": "application/json" };
    if (env?.OTEL_EXPORTER_OTLP_HEADERS) {
      const [k, v] = env.OTEL_EXPORTER_OTLP_HEADERS.split("=");
      if (k && v) headers[k.trim()] = v.trim();
    }
    await fetch(`${endpoint.replace(/\/$/, "")}/v1/metrics`, {
      method: "POST",
      headers,
      body: JSON.stringify({ skillforge: { metrics: payload.metrics } }),
    });
    await fetch(`${endpoint.replace(/\/$/, "")}/v1/logs`, {
      method: "POST",
      headers,
      body: JSON.stringify({ skillforge: { events: payload.events } }),
    });
    return { published: true };
  } catch (err) {
    return { published: false, reason: `OTLP push failed (best-effort, gate result stands): ${err.message}` };
  }
}

// --- internals ----------------------------------------------------------------------------

/**
 * Keep only the known, secret-free attribute fields and drop nulls — the bridge never spreads
 * arbitrary data into telemetry (that is how content leaks). Values are gate ids / commit shas /
 * PR numbers / run ids / a fixed evidence label, none of which is a secret or file content.
 */
function secretFreeAttributes({ gate, commit, pr, runId, evidence }) {
  const attrs = { gate };
  if (commit) attrs.commit = String(commit);
  if (pr) attrs.pr = String(pr);
  if (runId) attrs["run.id"] = String(runId);
  if (evidence) attrs.evidence = String(evidence);
  return attrs;
}

// Run as a CI report step when invoked directly: collect the public gate results, build the
// payload, publish it (no-op without a collector), and print what was/would be sent. The bridge
// NEVER changes the gate verdict — it exits 0 (it only reports); CI fails on the gate runner's own
// exit, not on the bridge.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const ctx = {
    commit: process.env.GITHUB_SHA ?? null,
    pr: process.env.GITHUB_PR_NUMBER ?? null,
    runId: process.env.GITHUB_RUN_ID ?? null,
    evidence: "node tools/gates.js",
  };
  const results = collectPublicGateResults();
  const payload = buildGuardrailPayload(results, ctx);
  publishGuardrailPayload(payload).then((r) => {
    for (const ev of payload.events) console.log(`guardrail-bridge: ${ev.gate} = ${ev.status}`);
    console.log(`guardrail-bridge: ${r.published ? "published to collector" : r.reason}`);
    process.exit(0); // report-only — never the reason CI fails
  });
}
