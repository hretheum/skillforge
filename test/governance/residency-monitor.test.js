// Tests for the residency-monitor module (T-HARD-03): the monitoring layer on top of
// assertResidencyPosture that checks the active backend against a REQUIRED (injected) posture and
// raises one secret-free structured alert event on drift.
//
// Sources: concept + first principles, zero files from any third-party skills-factory codebase
// (clean-room). Compliant evidence → ok:true, event:null. Drifted/missing evidence → ok:false with
// a DRIFT event. Missing/malformed required posture → ok:false with a MISCONFIGURED event
// (fail-closed). The event payload must never carry secret material (e.g. a tokened source URL).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  monitorResidencyPosture,
  createResidencyMonitor,
  RESIDENCY_ALERT,
  PROFILE_A_POSTURE,
  RESIDENCY,
} from '../../src/governance/index.js';

const SECRET_TOKEN = 'AKIAEXAMPLEDONOTLEAK1234';

// A backend-evidence fixture that satisfies PROFILE_A_POSTURE. `source` carries a token to prove
// the monitor never copies it into the alert payload.
function compliantEvidence() {
  return {
    endpointClass: RESIDENCY.EU_REGIONAL,
    activeModelId: 'anthropic.claude-sonnet-4-6',
    euAvailableModels: ['anthropic.claude-sonnet-4-6', 'anthropic.claude-opus-4-8'],
    retentionExceptionList: ['gpt-5'],
    evidenceAsOf: '2026-06-05',
    source: `https://backend.example/evidence?token=${SECRET_TOKEN}`,
  };
}

test('RESIDENCY_ALERT exposes the two alert kinds', () => {
  assert.equal(RESIDENCY_ALERT.DRIFT, 'residency-drift');
  assert.equal(RESIDENCY_ALERT.MISCONFIGURED, 'residency-monitor-misconfigured');
});

test('compliant backend → ok:true, event:null', () => {
  const r = monitorResidencyPosture(compliantEvidence(), PROFILE_A_POSTURE);
  assert.equal(r.ok, true);
  assert.equal(r.event, null);
});

test('drifted endpoint class → ok:false, DRIFT event with type+detail', () => {
  const ev = compliantEvidence();
  ev.endpointClass = 'global';
  const r = monitorResidencyPosture(ev, PROFILE_A_POSTURE);

  assert.equal(r.ok, false);
  assert.equal(r.event.type, RESIDENCY_ALERT.DRIFT);
  assert.match(r.event.detail, /diverged/);
  assert.ok(Array.isArray(r.event.findings));
  assert.ok(r.event.findings.length >= 1);
  assert.ok(r.event.findings.some((f) => f.invariant === 'R1-endpoint'));
  assert.equal(r.event.evidence.endpointClass, 'global');
});

test('ZDR drift (active model on retention-exception list) → DRIFT event', () => {
  const ev = compliantEvidence();
  ev.activeModelId = 'openai.gpt-5.1';
  ev.euAvailableModels = ['openai.gpt-5.1'];
  const r = monitorResidencyPosture(ev, PROFILE_A_POSTURE);

  assert.equal(r.ok, false);
  assert.equal(r.event.type, RESIDENCY_ALERT.DRIFT);
  assert.ok(r.event.findings.some((f) => f.invariant === 'R3-zdr-not-excepted'));
});

test('alert event is secret-free — no tokened source URL anywhere in the payload', () => {
  const ev = compliantEvidence();
  ev.endpointClass = 'global'; // force an alert
  const r = monitorResidencyPosture(ev, PROFILE_A_POSTURE);

  const serialized = JSON.stringify(r.event);
  assert.equal(serialized.includes(SECRET_TOKEN), false);
  assert.equal(serialized.includes('token='), false);
  // only a boolean presence flag, never the URL itself
  assert.equal(r.event.evidence.hasSource, true);
  assert.equal('source' in r.event.evidence, false);
});

test('null/malformed backendConfig → fail-closed (ok:false, DRIFT)', () => {
  for (const bad of [null, undefined, 42, 'x', true]) {
    const r = monitorResidencyPosture(bad, PROFILE_A_POSTURE);
    assert.equal(r.ok, false);
    assert.equal(r.event.type, RESIDENCY_ALERT.DRIFT);
    assert.ok(r.event.findings.length >= 1);
    // safe projection still present, all-null facts
    assert.equal(r.event.evidence.endpointClass, null);
    assert.equal(r.event.evidence.activeModelId, null);
    assert.equal(r.event.evidence.hasSource, false);
  }
});

test('null/malformed requiredPosture → fail-closed (ok:false, MISCONFIGURED)', () => {
  for (const bad of [null, undefined, 42, 'x', true, {}, { requiredEndpointClass: '' }]) {
    const r = monitorResidencyPosture(compliantEvidence(), bad);
    assert.equal(r.ok, false);
    assert.equal(r.event.type, RESIDENCY_ALERT.MISCONFIGURED);
    assert.match(r.event.detail, /fail-closed/);
  }
});

test('MISCONFIGURED event is also secret-free', () => {
  const r = monitorResidencyPosture(compliantEvidence(), null);
  const serialized = JSON.stringify(r.event);
  assert.equal(serialized.includes(SECRET_TOKEN), false);
  assert.equal(r.event.evidence.hasSource, true);
});

test('createResidencyMonitor binds posture; check() works for compliant + drifted', () => {
  const monitor = createResidencyMonitor(PROFILE_A_POSTURE);

  const okRes = monitor.check(compliantEvidence());
  assert.equal(okRes.ok, true);
  assert.equal(okRes.event, null);

  const ev = compliantEvidence();
  ev.endpointClass = 'global';
  const driftRes = monitor.check(ev);
  assert.equal(driftRes.ok, false);
  assert.equal(driftRes.event.type, RESIDENCY_ALERT.DRIFT);
});

test('createResidencyMonitor with a malformed posture fails closed on every check', () => {
  const monitor = createResidencyMonitor(null);
  const r = monitor.check(compliantEvidence());
  assert.equal(r.ok, false);
  assert.equal(r.event.type, RESIDENCY_ALERT.MISCONFIGURED);
});

test('per-environment wiring: a laxer required posture accepts a global endpoint', () => {
  const laxPosture = { ...PROFILE_A_POSTURE, requiredEndpointClass: 'global' };
  const ev = compliantEvidence();
  ev.endpointClass = 'global';
  const r = monitorResidencyPosture(ev, laxPosture);
  assert.equal(r.ok, true);
  assert.equal(r.event, null);
});

test('monitor returns are frozen', () => {
  const r = monitorResidencyPosture(compliantEvidence(), PROFILE_A_POSTURE);
  assert.equal(Object.isFrozen(r), true);
  const drift = monitorResidencyPosture({ endpointClass: 'global' }, PROFILE_A_POSTURE);
  assert.equal(Object.isFrozen(drift), true);
  assert.equal(Object.isFrozen(drift.event), true);
  assert.equal(Object.isFrozen(drift.event.findings), true);
});
