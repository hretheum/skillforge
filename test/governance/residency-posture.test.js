// Tests for the residency/retention posture check (T-HARD-03 / SEC-P1-4).
//
// The check asserts the profile-A residency/retention promise AGAINST BACKEND EVIDENCE rather
// than trusting a mutable doc page (docs/15 §"Monitoring the ZDR basis"). The DONE criterion is:
// a residency/retention regression is detected by a CHECK, not by a human noticing a doc changed.
// These tests prove (1) the committed evidence snapshot proves the posture, (2) each asserted
// invariant R1–R4 BITES when the backend evidence regresses, (3) fail-closed on missing/malformed
// evidence, and (4) the wired tool exits non-zero on a regressed evidence file (must-bite).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  assertResidencyPosture,
  PROFILE_A_POSTURE,
  RESIDENCY,
  FINDING,
} from "../../src/governance/index.js";
import { runResidencyCheck } from "../../tools/residency-check.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const SNAPSHOT_PATH = join(ROOT, "test", "fixtures", "residency-evidence-snapshot.json");

/** The good, committed backend evidence (deep-cloned per test so a test can mutate freely). */
function goodEvidence() {
  return JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
}

// =====================================================================================
// DONE criterion — the committed snapshot PROVES the profile-A posture (every invariant ok)
// =====================================================================================

test("the committed backend-evidence snapshot proves the profile-A residency/retention posture", () => {
  const report = assertResidencyPosture(goodEvidence());
  assert.equal(report.ok, true, JSON.stringify(report.findings, null, 2));
  assert.deepEqual(report.findings, []);
  // all four invariants were actually checked (the check is not vacuously empty)
  assert.deepEqual(report.checked, [
    "R1-endpoint",
    "R2-model-available",
    "R3-zdr-not-excepted",
    "R4-exception-scope",
  ]);
});

test("the asserted posture is profile A / EU-regional / ZDR-by-default (the contract it enforces)", () => {
  assert.equal(PROFILE_A_POSTURE.profile, "compliance");
  assert.equal(PROFILE_A_POSTURE.requiredEndpointClass, RESIDENCY.EU_REGIONAL);
  assert.ok(Array.isArray(PROFILE_A_POSTURE.knownRetentionExceptionScope));
});

// =====================================================================================
// MUST BITE — each asserted invariant catches a real backend regression
// =====================================================================================

test("R1 BITES — endpoint flips off EU-regional to global → residency regression", () => {
  const ev = goodEvidence();
  ev.endpointClass = "global"; // docs/15: the global endpoint is NOT residency-safe
  const report = assertResidencyPosture(ev);
  assert.equal(report.ok, false);
  const f = report.findings.find((x) => x.invariant === "R1-endpoint");
  assert.ok(f && f.finding === FINDING.REGRESSION, "expected an R1 regression");
  assert.match(f.detail, /outside the EU|residency regression/i);
});

test("R2 BITES — active model dropped from the EU-available list → residency no longer delivered", () => {
  const ev = goodEvidence();
  ev.euAvailableModels = ev.euAvailableModels.filter((m) => m !== ev.activeModelId);
  const report = assertResidencyPosture(ev);
  assert.equal(report.ok, false);
  const f = report.findings.find((x) => x.invariant === "R2-model-available");
  assert.ok(f && f.finding === FINDING.REGRESSION, "expected an R2 regression");
  assert.match(f.detail, /NOT in the backend's EU-available/i);
});

test("R3 BITES — active model appears on the retention-exception list → ZDR no longer holds", () => {
  const ev = goodEvidence();
  // simulate the exact failure docs/15 monitors for: Claude (the active model) joins the list
  ev.retentionExceptionList = [...ev.retentionExceptionList, ev.activeModelId];
  const report = assertResidencyPosture(ev);
  assert.equal(report.ok, false);
  const f = report.findings.find((x) => x.invariant === "R3-zdr-not-excepted");
  assert.ok(f && f.finding === FINDING.REGRESSION, "expected an R3 regression");
  assert.match(f.detail, /ZDR-by-default no longer holds|retention regression/i);
});

test("R3 BITES on a FAMILY match too — a renamed Claude variant on the list is still caught", () => {
  const ev = goodEvidence();
  // the list names a family ("anthropic.claude-sonnet"), the active model is a specific variant
  ev.retentionExceptionList = [...ev.retentionExceptionList, "anthropic.claude-sonnet"];
  const report = assertResidencyPosture(ev);
  assert.equal(report.ok, false);
  assert.ok(report.findings.some((x) => x.invariant === "R3-zdr-not-excepted" && x.finding === FINDING.REGRESSION));
});

test("R4 BITES — the retention-exception list WIDENS beyond the known scope (even if Claude not named)", () => {
  const ev = goodEvidence();
  ev.retentionExceptionList = [...ev.retentionExceptionList, "gemini-3"]; // a new, out-of-scope family
  const report = assertResidencyPosture(ev);
  assert.equal(report.ok, false);
  const f = report.findings.find((x) => x.invariant === "R4-exception-scope");
  assert.ok(f && f.finding === FINDING.REGRESSION, "expected an R4 widening regression");
  assert.match(f.detail, /WIDENED beyond the asserted scope/i);
});

test("R4 does NOT false-positive — a GPT-5 minor variant stays within the known gpt-5 scope", () => {
  const ev = goodEvidence();
  ev.retentionExceptionList = ["gpt-5", "gpt-5.2", "gpt-5-turbo"]; // all gpt-5 family
  const report = assertResidencyPosture(ev);
  assert.equal(report.ok, true, JSON.stringify(report.findings));
});

// =====================================================================================
// FAIL-CLOSED — missing / malformed evidence is UNPROVEN, never a silent pass
// =====================================================================================

test("fail-closed — null evidence is unproven (the promise cannot be proven)", () => {
  const report = assertResidencyPosture(null);
  assert.equal(report.ok, false);
  assert.ok(report.findings.some((f) => f.finding === FINDING.UNPROVEN));
});

test("fail-closed — evidence missing the endpoint class is unproven for R1", () => {
  const ev = goodEvidence();
  delete ev.endpointClass;
  const report = assertResidencyPosture(ev);
  assert.equal(report.ok, false);
  assert.ok(report.findings.some((f) => f.invariant === "R1-endpoint" && f.finding === FINDING.UNPROVEN));
});

test("fail-closed — evidence missing the retention-exception list is unproven for R3", () => {
  const ev = goodEvidence();
  delete ev.retentionExceptionList;
  const report = assertResidencyPosture(ev);
  assert.equal(report.ok, false);
  assert.ok(report.findings.some((f) => f.invariant === "R3-zdr-not-excepted" && f.finding === FINDING.UNPROVEN));
});

test("assertResidencyPosture never throws on garbage input (total / fail-closed)", () => {
  for (const bad of [undefined, 42, "x", [], { activeModelId: 7 }]) {
    assert.doesNotThrow(() => assertResidencyPosture(bad));
    assert.equal(assertResidencyPosture(bad).ok, false);
  }
});

// =====================================================================================
// THE WIRED TOOL — runs over an evidence file, exits non-zero on a regression (must-bite)
// =====================================================================================

test("the tool PASSES (exit 0) against the committed snapshot", () => {
  assert.equal(runResidencyCheck({ evidence: SNAPSHOT_PATH }), 0);
});

test("the tool FAILS (exit 1) against a regressed evidence file — Claude on the retention list", (t) => {
  // write a tampered live-evidence file (the scheduled re-check shape) and run the SAME check over it
  const ev = goodEvidence();
  ev.retentionExceptionList = [...ev.retentionExceptionList, ev.activeModelId];
  ev.source = "live:tampered-for-test";
  const tmp = join(ROOT, "test", "fixtures", "residency-evidence-REGRESSED.tmp.json");
  writeFileSync(tmp, JSON.stringify(ev, null, 2));
  t.after(() => rmSync(tmp, { force: true }));
  assert.equal(runResidencyCheck({ evidence: tmp }), 1);
});

test("the tool FAILS (exit 1) when the evidence file is missing (fail-closed, not skipped)", () => {
  assert.equal(runResidencyCheck({ evidence: join(ROOT, "test", "fixtures", "does-not-exist.json") }), 1);
});
