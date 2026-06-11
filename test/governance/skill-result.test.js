// Per-run skill_result (PASS/FAIL) at the PostToolUse seam (T-P2-06 / OBS-04).
//
// Sources: concept + first principles, zero third-party skills-factory files (clean-room).
// docs/10 §success-rate (OBS-04) + docs/13 §PostToolUse. Asserts success is computed at the
// GENERATION grain (artifact produced w/o a fatal error), emitted as a structured event, and
// is secret-free — NOT proxied by API-error counts.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SKILL_RESULT,
  SKILL_RESULT_EVENT,
  makeSkillResult,
  fromSuccess,
  fromFailure,
  emitSkillResult,
} from "../../src/governance/skill-result.js";
import { AdapterFailure, FAILURE_CLASS } from "../../src/adapters/failure.js";

// A credential-shaped value is assembled at RUNTIME so no literal credential ever enters the
// tracked tree (the references-not-values invariant applies to test fixtures too — docs/11; a
// literal would trip the repo's own secret-scan CI gate, correctly). These tests still exercise
// the telemetry secret-guard with a value the scanner recognizes once built.
const FAKE_TOKEN = String.fromCharCode(115, 107, 45) + "AbCdEf0123456789AbCdEf0123456789"; // "sk-…"

test("fromSuccess: a PASS event at the generation grain, no failure descriptor", () => {
  const e = fromSuccess({ skill: "create-component", client: "example-studio", project: "web" });
  assert.equal(e.event, SKILL_RESULT_EVENT);
  assert.equal(e.hookEventName, "PostToolUse");
  assert.equal(e.outcome, SKILL_RESULT.PASS);
  assert.equal(e.skill, "create-component");
  assert.equal(e.client, "example-studio");
  assert.equal(e.project, "web");
  assert.equal(e.failure, null);
});

test("fromFailure: a FAIL event reads the typed failure's class (records WHY)", () => {
  const f = new AdapterFailure({
    failureClass: FAILURE_CLASS.AUTH,
    reason: "auth failed",
    edge: "input",
    rotationHint: "secrets.jiraToken",
  });
  const e = fromFailure(f, { skill: "create-component", client: "acme" });
  assert.equal(e.outcome, SKILL_RESULT.FAIL);
  assert.equal(e.failure.failureClass, FAILURE_CLASS.AUTH);
  assert.equal(e.failure.fatal, true);
  assert.equal(e.failure.edge, "input");
  assert.equal(e.failure.rotationHint, "secrets.jiraToken");
});

test("fromFailure: an UNCLASSIFIED raw error → a permanent-fatal FAIL with a safe reason (no leak)", () => {
  const raw = new Error(`secret token ${FAKE_TOKEN} in here`);
  const e = fromFailure(raw, { skill: "create-component" });
  assert.equal(e.outcome, SKILL_RESULT.FAIL);
  assert.equal(e.failure.failureClass, FAILURE_CLASS.PERMANENT);
  assert.equal(e.failure.fatal, true);
  // The raw message is NOT copied into telemetry — a fixed safe string is used instead.
  assert.ok(!e.failure.reason.includes(FAKE_TOKEN), "raw error message must not bleed into telemetry");
  assert.match(e.failure.reason, /unclassified/);
});

test("makeSkillResult: refuses to emit an event carrying a credential-shaped value (fail-closed)", () => {
  assert.throws(
    () =>
      makeSkillResult({
        outcome: SKILL_RESULT.FAIL,
        skill: "create-component",
        // a misused rotation hint carrying an actual secret value must be caught: the field
        // should hold a REFERENCE, never a value like this (built at runtime — see FAKE_TOKEN).
        failure: { failureClass: FAILURE_CLASS.AUTH, fatal: true, reason: "x", edge: "input", rotationHint: FAKE_TOKEN },
      }),
    /credential-shaped|secret/,
  );
});

test("makeSkillResult: rejects a bad outcome or a missing skill", () => {
  assert.throws(() => makeSkillResult({ outcome: "MAYBE", skill: "x" }), /PASS.*FAIL/);
  assert.throws(() => makeSkillResult({ outcome: SKILL_RESULT.PASS, skill: "" }), /non-empty skill/);
});

test("emitSkillResult: sends through the injected sink and returns the event", () => {
  const seen = [];
  const e = emitSkillResult(fromSuccess({ skill: "create-component" }), (ev) => seen.push(ev));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].outcome, SKILL_RESULT.PASS);
  // The return value is the original event; the sink receives the redacted wire copy (a distinct
  // object so the redaction cannot be undone by mutating the returned event). For a clean event the
  // two are equal by value.
  assert.deepEqual(e, seen[0]);
});

test("emitSkillResult: a throwing sink does NOT take down the caller (telemetry is best-effort)", () => {
  const e = fromSuccess({ skill: "create-component" });
  assert.doesNotThrow(() =>
    emitSkillResult(e, () => {
      throw new Error("collector down");
    }),
  );
});

test("emitSkillResult: a missing sink no-ops (returns the event)", () => {
  const e = emitSkillResult(fromSuccess({ skill: "create-component" }));
  assert.equal(e.outcome, SKILL_RESULT.PASS);
});

test("OBS-04: a run that succeeded after retried API errors is still a PASS (not proxied by api-error)", () => {
  // The grain is "did the generation produce its artifact without a FATAL error" — a recovered
  // transient (retried-and-succeeded) never reaches this seam as a failure, so the outcome is
  // PASS. This is the whole point of OBS-04: success is NOT lowered by transient backend errors.
  const e = fromSuccess({ skill: "create-component", client: "example-studio" });
  assert.equal(e.outcome, SKILL_RESULT.PASS);
  assert.equal(e.failure, null);
});

// --- outbound redaction (AC: scan + REDACT on outbound events) ----------------------------

test("emitSkillResult REDACTS a credential-shaped span before the sink sees it (defense-in-depth)", () => {
  // makeSkillResult REFUSES a secret-bearing event at build time; redaction is the complementary
  // wire-pass for a value that slipped PAST that refusal. We exercise it by handing emitSkillResult a
  // RAW event object (bypassing the build-time scan) carrying the runtime-built FAKE_TOKEN, and
  // assert the sink receives the redacted form — the credential never reaches the transport.
  const rawEvent = {
    event: SKILL_RESULT_EVENT,
    outcome: SKILL_RESULT.FAIL,
    skill: "create-component",
    client: "example-studio",
    failure: { reason: "boom", rotationHint: FAKE_TOKEN },
  };
  let received;
  emitSkillResult(rawEvent, (e) => {
    received = e;
  });
  assert.ok(received, "the sink was called");
  assert.notEqual(received.failure.rotationHint, FAKE_TOKEN, "the credential-shaped span must be redacted on the wire");
  assert.doesNotMatch(JSON.stringify(received), new RegExp(FAKE_TOKEN), "no credential-shaped value reaches the sink");
  // the run-facing handles survive (redaction strips only the credential-shaped spans).
  assert.equal(received.client, "example-studio");
  assert.equal(received.skill, "create-component");
});

test("emitSkillResult passes a clean event through unchanged (no spurious redaction)", () => {
  const clean = fromSuccess({ skill: "create-component", client: "example-studio" });
  let received;
  emitSkillResult(clean, (e) => {
    received = e;
  });
  assert.equal(received.outcome, SKILL_RESULT.PASS);
  assert.equal(received.client, "example-studio");
  assert.equal(received.skill, "create-component");
});
