// execution-posture — assert the skill-execution posture (egress + timeout) AGAINST AN ADAPTER'S
// DECLARATION, deny-first.
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room). Sibling of residency-posture.js — same asserted-posture shape: a
// contract encoded as data, a total/fail-closed evaluator that never throws and never reads
// through as compliant when the declaration is absent or malformed.
//
// WHY THIS EXISTS. A skill adapter that can reach the network by default is a data-exfiltration
// surface: the safe default is egress-DENIED, and any adapter that wants the network must SAY SO
// and JUSTIFY it. So the posture is egress-deny-by-default + require-justification: a declaration
// that opens egress without a justification, or names an unknown egress class, is a violation;
// a declaration that says nothing inherits the safe default and is compliant.
//
// FAIL-CLOSED. Like the residency sibling, a null/non-object adapter is UNPROVEN (the posture
// cannot be proven → it is not kept), never a silent pass.

/** The egress classes an adapter may declare. */
export const EGRESS = Object.freeze({
  DENIED: 'egress-denied',
  ALLOWED: 'egress-allowed',
});

/** A posture finding's kind — every non-OK finding fails the check (deny-first). */
export const POSTURE_FINDING = Object.freeze({
  OK: 'ok',
  VIOLATION: 'violation', // an asserted invariant is violated by the adapter declaration
  UNPROVEN: 'unproven', // the declaration is absent/malformed → the posture cannot be proven (fail-closed)
});

/** The asserted execution posture contract (the single copy, encoded as data). */
export const EXECUTION_POSTURE = Object.freeze({
  defaultEgress: EGRESS.DENIED, // an adapter that says nothing gets the deny-by-default
  requireJustification: true, // egress-allowed must carry a non-empty justification
});

/** The default skill-execution timeout (ms) when the adapter does not declare one. */
const DEFAULT_TIMEOUT_MS = 30_000;

function violation(detail) {
  return Object.freeze({ type: POSTURE_FINDING.VIOLATION, detail });
}
function unproven(detail) {
  return Object.freeze({ type: POSTURE_FINDING.UNPROVEN, detail });
}

/**
 * @typedef {Object} ExecutionAdapter  a skill adapter's execution declaration (all fields optional;
 *   an absent field inherits the asserted default).
 * @property {string} [egress]        one of EGRESS (default: EGRESS.DENIED)
 * @property {string} [justification] required (non-empty string) when egress is EGRESS.ALLOWED
 * @property {number} [timeoutMs]     positive number (default: 30_000)
 */

/**
 * Assert the execution posture against an adapter declaration.
 *
 * TOTAL and FAIL-CLOSED: never throws. Returns `{ ok, findings }` where `ok` is true ONLY when
 * `findings` is empty (every asserted invariant holds). A null/non-object adapter is UNPROVEN.
 *
 * @param {ExecutionAdapter} adapter
 * @param {Object} [opts]  reserved (unused) — kept for the generic assertPosture(adapter, opts) call shape
 * @returns {{ ok: boolean, findings: Array<{type:string,detail:string}> }}
 */
export function assertExecutionPosture(adapter, opts = {}) {
  void opts;

  if (adapter === null || typeof adapter !== 'object') {
    return Object.freeze({
      ok: false,
      findings: Object.freeze([unproven('adapter must be a non-null object')]),
    });
  }

  const findings = [];

  // Egress: an unknown declaration is a violation; egress-allowed requires a justification.
  if (adapter.egress !== undefined) {
    if (adapter.egress !== EGRESS.DENIED && adapter.egress !== EGRESS.ALLOWED) {
      findings.push(violation('unknown egress declaration'));
    } else if (adapter.egress === EGRESS.ALLOWED) {
      if (typeof adapter.justification !== 'string' || adapter.justification.trim() === '') {
        findings.push(violation('egress-allowed requires a non-empty justification'));
      }
    }
  }

  // Timeout: if declared, it must be a positive number.
  if (adapter.timeoutMs !== undefined) {
    if (typeof adapter.timeoutMs !== 'number' || !(adapter.timeoutMs > 0)) {
      findings.push(violation('timeoutMs must be a positive number'));
    }
  }

  const ok = findings.length === 0;
  return Object.freeze({ ok, findings: Object.freeze(findings) });
}

/** Alias — the governance spine calls `assertPosture()` generically. */
export const assertPosture = assertExecutionPosture;

/**
 * The effective execution timeout (ms) for an adapter: its declared `timeoutMs` if valid and
 * positive, otherwise the asserted default (30_000).
 *
 * @param {ExecutionAdapter} adapter
 * @returns {number}
 */
export function getEffectiveTimeout(adapter) {
  if (
    adapter !== null &&
    typeof adapter === 'object' &&
    typeof adapter.timeoutMs === 'number' &&
    adapter.timeoutMs > 0
  ) {
    return adapter.timeoutMs;
  }
  return DEFAULT_TIMEOUT_MS;
}

// --- heartbeat dead-man switch (process-group SIGKILL on stall) ---------------------------
//
// A skill that stalls past its declared timeout must be FORCE-KILLED, not merely abandoned: a
// hung child can hold a network egress channel or a credential open indefinitely, so the safe
// posture is a watchdog that SIGKILLs the whole PROCESS GROUP (the child + anything it spawned)
// the moment it stalls. The watchdog is a dead-man switch: each beat() re-arms the timer; if no
// beat arrives within the timeout window, it fires.
//
// The kill action and the clock are injectable so the watchdog is deterministic and testable
// offline (a fake timer + a recording killer), while the default fires a REAL process-group
// SIGKILL — same shape as the residency sibling injecting an evidence provider.

/** The signal the dead-man switch sends on stall (force-kill; cannot be trapped/ignored). */
export const HEARTBEAT_SIGNAL = 'SIGKILL';

/**
 * The default kill action: SIGKILL the target's PROCESS GROUP. Node addresses a process group by
 * passing a NEGATIVE pid to process.kill (kill(2) semantics), so the child and everything it
 * spawned die together — a lone child-kill would leak grandchildren still holding resources.
 */
function killProcessGroup(pid, signal) {
  process.kill(-Math.abs(pid), signal);
}

/**
 * Create a heartbeat dead-man switch for a running skill execution.
 *
 * The watchdog arms a timer for the effective timeout; every `beat()` re-arms it. If the timeout
 * elapses without a beat (the skill stalled), it fires the kill action against the target process
 * group and latches FIRED (it fires at most once). `clear()` disarms it on clean completion.
 *
 * @param {Object} args
 * @param {number} args.pid                    the skill child's pid (its process-group leader)
 * @param {Object} [args.adapter]              the adapter (its timeoutMs sets the window; default 30_000)
 * @param {(pid:number, signal:string)=>void} [args.kill]  injectable kill action (default: process-group SIGKILL)
 * @param {(fn:()=>void, ms:number)=>any} [args.setTimer]  injectable timer set (default: setTimeout)
 * @param {(handle:any)=>void} [args.clearTimer]           injectable timer clear (default: clearTimeout)
 * @returns {{ beat: ()=>void, clear: ()=>void, fired: ()=>boolean, timeoutMs: number }}
 */
export function createHeartbeat({
  pid,
  adapter,
  kill = killProcessGroup,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
    throw new TypeError('createHeartbeat requires a positive integer pid');
  }

  const timeoutMs = getEffectiveTimeout(adapter);
  let handle = null;
  let fired = false;
  let cleared = false;

  function disarm() {
    if (handle !== null) {
      clearTimer(handle);
      handle = null;
    }
  }

  function arm() {
    disarm();
    if (cleared || fired) return;
    handle = setTimer(() => {
      handle = null;
      if (cleared || fired) return;
      fired = true;
      kill(pid, HEARTBEAT_SIGNAL);
    }, timeoutMs);
  }

  arm(); // the switch is armed from creation — a skill that never beats still gets killed

  return Object.freeze({
    beat() {
      if (cleared || fired) return;
      arm();
    },
    clear() {
      cleared = true;
      disarm();
    },
    fired() {
      return fired;
    },
    timeoutMs,
  });
}
