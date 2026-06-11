// CI guardrail bridge — publish gate PASS/FAIL as OTLP metric + event (T-P4-04 / OBS-03,
// docs/10 §"Getting the guardrail PASS/FAIL signal onto the dashboard").
//
// Sources: concept + first principles, zero third-party skills-factory files (clean-room).
//
// SCOPE OF THIS TEST. The bridge's PAYLOAD BUILDERS are pure, real code (the engine-side emission)
// and are tested here: a gate PASS/FAIL becomes a gauge metric (1/0) + a structured event with the
// gate id and provenance, secret-free, with the public gates mapped to their E-family subset. The
// actual OTLP POST + the collector/Prometheus/Loki/Grafana that draw the signals are the DEPLOY
// stack (deploy/), not exercised here — the no-op-without-a-collector behavior IS asserted.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  GUARDRAIL_METRIC,
  GUARDRAIL_EVENT,
  GAUGE,
  PUBLIC_GATE_E_ID,
  buildGuardrailSignals,
  buildGuardrailPayload,
  publishGuardrailPayload,
} from "../tools/guardrail-bridge.js";

test("a PASS gate becomes a gauge=1 metric + a PASS event labelled by gate", () => {
  const { metric, event } = buildGuardrailSignals({ gate: "E1", status: "PASS" });
  assert.equal(metric.name, GUARDRAIL_METRIC);
  assert.equal(metric.gauge.dataPoints[0].asInt, GAUGE.PASS);
  assert.equal(metric.gauge.dataPoints[0].asInt, 1);
  assert.equal(metric.gauge.dataPoints[0].attributes.gate, "E1");
  assert.equal(event.event, GUARDRAIL_EVENT);
  assert.equal(event.gate, "E1");
  assert.equal(event.status, "PASS");
});

test("a FAIL gate becomes a gauge=0 metric + a FAIL event", () => {
  const { metric, event } = buildGuardrailSignals({ gate: "E5", status: "FAIL" });
  assert.equal(metric.gauge.dataPoints[0].asInt, GAUGE.FAIL);
  assert.equal(metric.gauge.dataPoints[0].asInt, 0);
  assert.equal(event.status, "FAIL");
});

test("provenance (commit/pr/run/evidence) rides as secret-free attributes, nulls dropped", () => {
  const { metric, event } = buildGuardrailSignals(
    { gate: "E4", status: "PASS" },
    { commit: "abc123", pr: "42", runId: "9", evidence: "node tools/gates.js" },
  );
  const attrs = metric.gauge.dataPoints[0].attributes;
  assert.deepEqual(attrs, { gate: "E4", commit: "abc123", pr: "42", "run.id": "9", evidence: "node tools/gates.js" });
  // Event mirrors the same provenance.
  assert.equal(event.commit, "abc123");
  // Nulls are dropped from the metric attributes (never spread arbitrary/empty data into telemetry).
  const bare = buildGuardrailSignals({ gate: "E4", status: "PASS" });
  assert.deepEqual(bare.metric.gauge.dataPoints[0].attributes, { gate: "E4" });
});

test("the builder validates its inputs (fail-loud on a bad gate id or status)", () => {
  assert.throws(() => buildGuardrailSignals({ gate: "", status: "PASS" }), /non-empty gate id/);
  assert.throws(() => buildGuardrailSignals({ gate: "E1", status: "MAYBE" }), /must be "PASS" or "FAIL"/);
});

test("buildGuardrailPayload batches a full result set into parallel metric + event arrays", () => {
  const results = [
    { gate: "E1", status: "PASS" },
    { gate: "E2", status: "FAIL" },
    { gate: "E4", status: "PASS" },
  ];
  const payload = buildGuardrailPayload(results, { commit: "deadbeef" });
  assert.equal(payload.metrics.length, 3);
  assert.equal(payload.events.length, 3);
  assert.equal(payload.metrics[1].gauge.dataPoints[0].asInt, 0, "E2 FAIL → gauge 0");
  assert.equal(payload.events[1].status, "FAIL");
  assert.ok(payload.metrics.every((m) => m.gauge.dataPoints[0].attributes.commit === "deadbeef"), "shared provenance applied");
});

test("the public gates map onto a verifiable E-family SUBSET (no second definition of pass)", () => {
  // The bridge maps each PUBLIC gate id to its E-family id so it appears on the dashboard as a
  // subset of E0–E10. It does not invent gate semantics — it only labels the public subset.
  assert.ok(Object.keys(PUBLIC_GATE_E_ID).includes("determinism"));
  assert.ok(Object.keys(PUBLIC_GATE_E_ID).includes("secret-scan"));
  assert.ok(Object.keys(PUBLIC_GATE_E_ID).includes("cleanroom"));
  // Every mapped value is an E-family id.
  for (const eId of Object.values(PUBLIC_GATE_E_ID)) assert.match(eId, /^E\d+$/);
});

test("publish is a NO-OP without a collector configured (the bridge stays harmless in CI)", async () => {
  const payload = buildGuardrailPayload([{ gate: "E1", status: "PASS" }]);
  // No telemetry env → no push (the payload is still built; the bridge never fails CI).
  const off = await publishGuardrailPayload(payload, {});
  assert.equal(off.published, false);
  assert.match(off.reason, /no-op/);
  // Master switch on but no endpoint → still a no-op (both are required).
  const noEndpoint = await publishGuardrailPayload(payload, { CLAUDE_CODE_ENABLE_TELEMETRY: "1" });
  assert.equal(noEndpoint.published, false);
});
