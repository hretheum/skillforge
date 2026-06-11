// Tests for the execution-posture module: the egress posture check
// (egress-deny-by-default + require-justification + timeout) and the heartbeat dead-man switch.
//
// The posture check asserts the execution posture AGAINST AN ADAPTER DECLARATION, deny-first: an
// adapter that says nothing inherits the safe default (egress denied) and is compliant; one that
// opens egress without a justification, names an unknown egress class, or declares a non-positive
// timeout is a violation; a null/non-object adapter is UNPROVEN (fail-closed).
//
// The heartbeat is a dead-man switch: armed from creation, each beat() re-arms it; a stall past the
// timeout fires a PROCESS-GROUP SIGKILL (tested via injected fake clock + recording killer so it is
// deterministic and offline — no real process is ever signalled).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  assertExecutionPosture,
  assertPosture,
  getEffectiveTimeout,
  createHeartbeat,
  EGRESS,
  POSTURE_FINDING,
  EXECUTION_POSTURE,
  HEARTBEAT_SIGNAL,
} from '../../src/governance/index.js';

/**
 * A deterministic fake clock: setTimer/clearTimer record pending timers; advance(ms) fires every
 * timer whose deadline has elapsed. Lets the dead-man switch be tested without real time.
 */
function fakeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map();
  return {
    setTimer(fn, ms) {
      const id = ++seq;
      timers.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    advance(ms) {
      now += ms;
      for (const [id, t] of [...timers.entries()]) {
        if (t.at <= now) {
          timers.delete(id);
          t.fn();
        }
      }
    },
    pending() {
      return timers.size;
    },
  };
}

/** A recording killer — captures (pid, signal) so a test can assert the dead-man switch fired. */
function recordingKiller() {
  const calls = [];
  const kill = (pid, signal) => calls.push({ pid, signal });
  return { kill, calls };
}

// =====================================================================================
// FAIL-CLOSED — a null/non-object adapter is UNPROVEN, never a silent pass
// =====================================================================================

test('fail-closed — null adapter is unproven (the posture cannot be proven)', () => {
  const report = assertExecutionPosture(null);
  assert.equal(report.ok, false);
  assert.ok(report.findings.some((f) => f.type === POSTURE_FINDING.UNPROVEN));
  assert.match(report.findings[0].detail, /non-null object/i);
});

test('never throws on garbage input (total / fail-closed)', () => {
  for (const bad of [undefined, 42, 'x', null]) {
    assert.doesNotThrow(() => assertExecutionPosture(bad));
    assert.equal(assertExecutionPosture(bad).ok, false);
  }
});

// =====================================================================================
// DEFAULT-DENY — an adapter that says nothing inherits the safe default and is compliant
// =====================================================================================

test('empty adapter is compliant (deny-by-default needs no declaration)', () => {
  const report = assertExecutionPosture({});
  assert.equal(report.ok, true);
  assert.deepEqual(report.findings, []);
});

test('explicit egress-denied is compliant', () => {
  const report = assertExecutionPosture({ egress: EGRESS.DENIED });
  assert.equal(report.ok, true);
  assert.deepEqual(report.findings, []);
});

// =====================================================================================
// EGRESS-ALLOWED requires a non-empty justification
// =====================================================================================

test('egress-allowed WITH a justification is compliant', () => {
  const report = assertExecutionPosture({
    egress: EGRESS.ALLOWED,
    justification: 'analytics pipeline',
  });
  assert.equal(report.ok, true);
  assert.deepEqual(report.findings, []);
});

test('egress-allowed WITHOUT a justification is a violation', () => {
  const report = assertExecutionPosture({ egress: EGRESS.ALLOWED });
  assert.equal(report.ok, false);
  const f = report.findings.find((x) => x.type === POSTURE_FINDING.VIOLATION);
  assert.ok(f, 'expected a violation');
  assert.match(f.detail, /justification/i);
});

test('egress-allowed with an EMPTY justification is a violation', () => {
  const report = assertExecutionPosture({ egress: EGRESS.ALLOWED, justification: '' });
  assert.equal(report.ok, false);
  assert.ok(report.findings.some((f) => f.type === POSTURE_FINDING.VIOLATION && /justification/i.test(f.detail)));
});

test('egress-allowed with a whitespace-only justification is a violation', () => {
  const report = assertExecutionPosture({ egress: EGRESS.ALLOWED, justification: '   ' });
  assert.equal(report.ok, false);
  assert.ok(report.findings.some((f) => f.type === POSTURE_FINDING.VIOLATION && /justification/i.test(f.detail)));
});

// =====================================================================================
// UNKNOWN egress class is a violation
// =====================================================================================

test('an unknown egress declaration is a violation', () => {
  const report = assertExecutionPosture({ egress: 'unknown-value' });
  assert.equal(report.ok, false);
  const f = report.findings.find((x) => x.type === POSTURE_FINDING.VIOLATION);
  assert.ok(f, 'expected a violation');
  assert.match(f.detail, /unknown egress/i);
});

// =====================================================================================
// TIMEOUT — when declared, must be a positive number
// =====================================================================================

test('a negative timeoutMs is a violation', () => {
  const report = assertExecutionPosture({ timeoutMs: -1 });
  assert.equal(report.ok, false);
  assert.ok(report.findings.some((f) => f.type === POSTURE_FINDING.VIOLATION && /positive number/i.test(f.detail)));
});

test('a zero timeoutMs is a violation', () => {
  const report = assertExecutionPosture({ timeoutMs: 0 });
  assert.equal(report.ok, false);
  assert.ok(report.findings.some((f) => f.type === POSTURE_FINDING.VIOLATION && /positive number/i.test(f.detail)));
});

test('a non-number timeoutMs is a violation', () => {
  const report = assertExecutionPosture({ timeoutMs: 'soon' });
  assert.equal(report.ok, false);
  assert.ok(report.findings.some((f) => f.type === POSTURE_FINDING.VIOLATION && /positive number/i.test(f.detail)));
});

test('a valid positive timeoutMs is compliant', () => {
  const report = assertExecutionPosture({ timeoutMs: 5000 });
  assert.equal(report.ok, true);
  assert.deepEqual(report.findings, []);
});

// =====================================================================================
// getEffectiveTimeout — declared-if-valid, else default 30_000
// =====================================================================================

test('getEffectiveTimeout falls back to the 30_000 default for an empty adapter', () => {
  assert.equal(getEffectiveTimeout({}), 30_000);
});

test('getEffectiveTimeout returns a valid declared timeout', () => {
  assert.equal(getEffectiveTimeout({ timeoutMs: 5000 }), 5000);
});

test('getEffectiveTimeout falls back to the default for an invalid timeout', () => {
  for (const bad of [{ timeoutMs: -1 }, { timeoutMs: 0 }, { timeoutMs: 'x' }, null, undefined]) {
    assert.equal(getEffectiveTimeout(bad), 30_000);
  }
});

// =====================================================================================
// alias + asserted contract
// =====================================================================================

test('assertPosture is an alias for assertExecutionPosture', () => {
  assert.equal(assertPosture, assertExecutionPosture);
});

test('the asserted posture is egress-deny-by-default + require-justification', () => {
  assert.equal(EXECUTION_POSTURE.defaultEgress, EGRESS.DENIED);
  assert.equal(EXECUTION_POSTURE.requireJustification, true);
});

// =====================================================================================
// HEARTBEAT dead-man switch — SIGKILLs the process group on stall past the timeout
// =====================================================================================

test('createHeartbeat requires a positive integer pid (fail-closed on bad input)', () => {
  for (const bad of [undefined, null, 0, -1, 1.5, 'x', NaN]) {
    assert.throws(() => createHeartbeat({ pid: bad }), TypeError);
  }
});

test('a stall past the timeout FIRES a process-group SIGKILL (negative pid)', () => {
  const clock = fakeClock();
  const killer = recordingKiller();
  const hb = createHeartbeat({
    pid: 4242,
    adapter: { timeoutMs: 1000 },
    kill: killer.kill,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });

  assert.equal(hb.fired(), false);
  clock.advance(1000); // the window elapses with no beat → stall
  assert.equal(hb.fired(), true);
  assert.equal(killer.calls.length, 1);
  // the watchdog hands the child pid + the force-kill signal to the kill action
  assert.equal(killer.calls[0].pid, 4242);
  assert.equal(killer.calls[0].signal, HEARTBEAT_SIGNAL);
  assert.equal(HEARTBEAT_SIGNAL, 'SIGKILL');
});

test('the DEFAULT kill action SIGKILLs the process GROUP (negative pid) — group semantics', () => {
  // exercise the real default killer via an injected process.kill stand-in (no real signal sent)
  const clock = fakeClock();
  const sent = [];
  const fakeProcessKill = (pid, signal) => sent.push({ pid, signal });
  const originalKill = process.kill;
  process.kill = fakeProcessKill;
  try {
    // createHeartbeat with the DEFAULT kill (we do not pass `kill`)
    createHeartbeat({
      pid: 4242,
      adapter: { timeoutMs: 100 },
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    clock.advance(100);
  } finally {
    process.kill = originalKill;
  }
  assert.equal(sent.length, 1);
  // a process GROUP is addressed by a NEGATIVE pid (kill(2) semantics) → child + descendants die together
  assert.equal(sent[0].pid, -4242);
  assert.equal(sent[0].signal, 'SIGKILL');
});

test('a beat re-arms the switch — no kill while the skill keeps beating', () => {
  const clock = fakeClock();
  const killer = recordingKiller();
  const hb = createHeartbeat({
    pid: 7,
    adapter: { timeoutMs: 1000 },
    kill: killer.kill,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });

  clock.advance(800);
  hb.beat(); // re-arm before the window closes
  clock.advance(800);
  hb.beat();
  clock.advance(800);
  assert.equal(hb.fired(), false, 'a beating skill must not be killed');
  assert.equal(killer.calls.length, 0);

  // …but once it stops beating, the next full window fires
  clock.advance(1000);
  assert.equal(hb.fired(), true);
  assert.equal(killer.calls.length, 1);
});

test('clear() disarms the switch — a completed skill is never killed', () => {
  const clock = fakeClock();
  const killer = recordingKiller();
  const hb = createHeartbeat({
    pid: 9,
    adapter: { timeoutMs: 1000 },
    kill: killer.kill,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });

  hb.clear();
  assert.equal(clock.pending(), 0, 'clear() must remove the pending timer');
  clock.advance(10_000);
  assert.equal(hb.fired(), false);
  assert.equal(killer.calls.length, 0);
});

test('the dead-man switch fires AT MOST once', () => {
  const clock = fakeClock();
  const killer = recordingKiller();
  const hb = createHeartbeat({
    pid: 11,
    adapter: { timeoutMs: 500 },
    kill: killer.kill,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });

  clock.advance(500);
  assert.equal(killer.calls.length, 1);
  // a beat after firing must NOT re-arm, and further time must NOT fire again
  hb.beat();
  clock.advance(10_000);
  assert.equal(killer.calls.length, 1, 'must fire exactly once');
});

test('an adapter with no timeoutMs uses the 30_000 default window', () => {
  const clock = fakeClock();
  const killer = recordingKiller();
  const hb = createHeartbeat({
    pid: 13,
    kill: killer.kill,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });

  assert.equal(hb.timeoutMs, 30_000);
  clock.advance(29_999);
  assert.equal(hb.fired(), false);
  clock.advance(1);
  assert.equal(hb.fired(), true);
});

test('the switch is armed from creation — a skill that NEVER beats is still killed', () => {
  const clock = fakeClock();
  const killer = recordingKiller();
  createHeartbeat({
    pid: 17,
    adapter: { timeoutMs: 1000 },
    kill: killer.kill,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  clock.advance(1000);
  assert.equal(killer.calls.length, 1, 'a never-beating skill must be killed');
});
