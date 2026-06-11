// memory-posture — assert the cross-session MEMORY posture of a skill adapter, deny-first.
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room). Sibling of execution-posture.js / residency-posture.js — same
// asserted-posture shape: a contract encoded as data, a total/fail-closed evaluator that never
// throws and never reads through as compliant when the declaration is absent or malformed.
//
// WHY THIS EXISTS. Microsoft AI research demonstrated recommendation-poisoning attacks where a
// payload buried in untrusted content plants a memory fragment that lies dormant, then assembles
// with later fragments ACROSS SESSIONS into an instruction the operator never gave. The defense is
// scope isolation: a skill that processes UNTRUSTED content (competitive analysis, inbound docs)
// MUST NOT share long-lived memory state with trusted workflows — its memory must be NARROW (reset
// after each run) so a planted fragment cannot survive to assemble. Long-lived (persistent) memory
// is the SAFE default only for TRUSTED workflows; absent-scope on an untrusted workflow inherits
// persistent and is therefore wrong (fail-closed: silence is not a safe declaration here).

/** The memory scopes an adapter may declare (narrowest → widest). */
export const MEMORY_SCOPE = Object.freeze({
  NARROW: 'memory-narrow', // no cross-session persistence; state reset after each run
  SESSION: 'memory-session', // persists within one session; reset on session end
  PERSISTENT: 'memory-persistent', // long-lived (default — safe for trusted workflows only)
});

/** A posture finding's kind — every non-OK finding fails the check (deny-first). */
export const POSTURE_FINDING = Object.freeze({
  OK: 'ok',
  VIOLATION: 'violation', // an asserted invariant is violated by the adapter declaration
  UNPROVEN: 'unproven', // the declaration is absent/malformed → the posture cannot be proven (fail-closed)
});

/** The asserted memory posture contract (the single copy, encoded as data). */
export const MEMORY_POSTURE = Object.freeze({
  // A skill processing untrusted content MUST declare the narrow scope — no cross-session state to
  // carry a planted fragment forward.
  untrustedContentScope: MEMORY_SCOPE.NARROW,
});

const VALID_SCOPES = Object.freeze(Object.values(MEMORY_SCOPE));

function violation(detail) {
  return Object.freeze({ type: POSTURE_FINDING.VIOLATION, detail });
}
function unproven(detail) {
  return Object.freeze({ type: POSTURE_FINDING.UNPROVEN, detail });
}

/**
 * @typedef {Object} MemoryAdapter  a skill adapter's memory declaration.
 * @property {string}  [memoryScope]               one of MEMORY_SCOPE (absent inherits PERSISTENT)
 * @property {boolean} [processesUntrustedContent] true when the skill ingests untrusted content
 */

/**
 * Assert the memory posture against an adapter declaration.
 *
 * TOTAL and FAIL-CLOSED: never throws. Returns `{ ok, findings }` where `ok` is true ONLY when
 * `findings` is empty (every asserted invariant holds). A null/non-object adapter is UNPROVEN.
 *
 * @param {MemoryAdapter} adapter
 * @param {Object} [opts]  reserved (unused) — kept for the generic assertPosture(adapter, opts) call shape
 * @returns {{ ok: boolean, findings: Array<{type:string,detail:string}> }}
 */
export function assertMemoryPosture(adapter, opts = {}) {
  void opts;

  if (adapter === null || typeof adapter !== 'object') {
    return Object.freeze({
      ok: false,
      findings: Object.freeze([unproven('adapter must be a non-null object')]),
    });
  }

  const findings = [];

  // A declared scope, if present, must be one of the known scopes.
  if (adapter.memoryScope !== undefined && !VALID_SCOPES.includes(adapter.memoryScope)) {
    findings.push(violation('unknown memory scope declaration'));
  }

  // The core invariant: an untrusted-content workflow must declare NARROW. Absent scope inherits
  // persistent (the default) → it is NOT narrow → violation (fail-closed against silence).
  if (adapter.processesUntrustedContent === true) {
    if (adapter.memoryScope === undefined) {
      findings.push(
        violation(
          'untrusted-content workflow has no memory scope; absent scope inherits persistent and must declare narrow',
        ),
      );
    } else if (adapter.memoryScope !== MEMORY_SCOPE.NARROW) {
      findings.push(violation('untrusted-content workflow must declare narrow memory scope'));
    }
  }

  const ok = findings.length === 0;
  return Object.freeze({ ok, findings: Object.freeze(findings) });
}

/** Alias — the governance spine calls `assertPosture()` generically. */
export const assertPosture = assertMemoryPosture;

/**
 * Rotate (reset) a brand-state.json-style checkpoint after an untrusted-content run.
 *
 * Resets the checkpoint to the null-sentinel pattern (`{ session: null }`) so no memory fragment
 * from the run survives into the next session. The fs and clock are injectable so the rotation is
 * deterministic and offline-testable. A missing file is created (not an error); the write throws
 * only on an unrecoverable FS error.
 *
 * @param {string} checkpointPath
 * @param {Object} [opts]
 * @param {typeof import('node:fs/promises')} [opts.fs]  injectable fs (default: node:fs/promises)
 * @param {()=>string} [opts.now]  injectable ISO-timestamp source (default: () => new Date().toISOString())
 * @returns {Promise<{ rotated: boolean, path: string }>}
 */
export async function rotateCheckpoint(checkpointPath, opts = {}) {
  const fs = opts.fs ?? (await import('node:fs/promises'));
  const lastRotated = typeof opts.now === 'function' ? opts.now() : new Date().toISOString();

  const payload = JSON.stringify({ session: null, lastRotated }, null, 2);
  await fs.writeFile(checkpointPath, payload, 'utf8');

  return Object.freeze({ rotated: true, path: checkpointPath });
}
