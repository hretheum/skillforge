// residency-monitor — the monitoring LAYER on top of assertResidencyPosture (T-HARD-03).
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room). Builds on src/governance/residency-posture.js, which asserts the
// profile-A residency/retention contract AGAINST BACKEND EVIDENCE. This module turns that
// assertion into an OPERATIONAL signal: it checks whether the currently-active model backend
// honors the required ZDR/residency posture and, when it drifts, raises ONE structured alert
// event suitable for telemetry — secret-free by construction.
//
// WHY A SEPARATE LAYER. The posture evaluator answers "does the evidence prove the promise?"
// (a list of findings). A monitor answers a narrower operational question — "is the active
// backend compliant right now, and if not, emit an alert" — so a scheduled re-check (docs/15)
// can route a single event into telemetry/paging without re-deriving the posture contract.
// The required posture is INJECTED (a parameter), not hardcoded, so the same monitor wires per
// environment: profile A in compliance, a laxer profile elsewhere.
//
// SECRET-FREE EVENT (HARD invariant). The alert payload carries only the POSTURE FACTS needed to
// triage — endpoint class, active model id, finding kinds/invariants/details — and NEVER any
// credential value or secret material. The evidence's `source` field can be a live URL (possibly
// carrying a token query-param) and is therefore NOT copied verbatim into the event; only its
// presence is signalled. Model ids and endpoint classes are configuration identifiers, not secrets.
//
// TOTAL and FAIL-CLOSED. Like every evaluator in this spine, the monitor never throws and never
// reads through as compliant on null/malformed input: missing evidence or a missing required
// posture → ok:false with an alert event (the promise cannot be proven → it is not kept).

import { assertResidencyPosture, FINDING } from './residency-posture.js';

/** The alert event kinds this monitor emits (every non-ok check emits exactly one). */
export const RESIDENCY_ALERT = Object.freeze({
  // The active backend diverged from the required posture (one or more asserted invariants failed).
  DRIFT: 'residency-drift',
  // The required posture itself is absent/malformed → the monitor cannot judge → fail-closed.
  MISCONFIGURED: 'residency-monitor-misconfigured',
});

/**
 * Project the safe, secret-free subset of the evidence for the alert payload. Only configuration
 * identifiers are copied; `source` (which may be a tokened live URL) is reduced to a boolean so no
 * credential material can ride along.
 */
function safeEvidenceFacts(evidence) {
  if (evidence === null || typeof evidence !== 'object') {
    return Object.freeze({ endpointClass: null, activeModelId: null, hasSource: false });
  }
  return Object.freeze({
    endpointClass: typeof evidence.endpointClass === 'string' ? evidence.endpointClass : null,
    activeModelId: typeof evidence.activeModelId === 'string' ? evidence.activeModelId : null,
    evidenceAsOf: typeof evidence.evidenceAsOf === 'string' ? evidence.evidenceAsOf : null,
    hasSource: typeof evidence.source === 'string' && evidence.source.trim() !== '',
  });
}

/**
 * Is `posture` a usable required-posture object? The monitor delegates the deep invariant logic to
 * assertResidencyPosture, but it must first know the posture exists and names a required endpoint
 * class — otherwise it would silently judge against `undefined` and fail open.
 */
function postureIsUsable(posture) {
  return (
    posture !== null &&
    typeof posture === 'object' &&
    typeof posture.requiredEndpointClass === 'string' &&
    posture.requiredEndpointClass.trim() !== ''
  );
}

/**
 * @typedef {Object} ResidencyAlertEvent  a secret-free structured alert for telemetry.
 * @property {string} type      one of RESIDENCY_ALERT
 * @property {string} detail    a human-readable, secret-free summary
 * @property {Array<{finding:string,invariant:string,detail:string}>} findings  the posture findings
 * @property {{endpointClass:string|null,activeModelId:string|null,evidenceAsOf?:string|null,hasSource:boolean}} evidence
 *   the safe evidence projection (NO secret material, NO verbatim source URL)
 */

/**
 * Check the active backend's residency/retention posture against a REQUIRED posture and, on drift,
 * produce one structured alert event.
 *
 * TOTAL and FAIL-CLOSED: never throws. Returns `{ ok, event }`:
 *   - ok:true,  event:null            — the backend honors the required posture.
 *   - ok:false, event:{type,detail,…} — drift (DRIFT) or a missing/malformed required posture
 *                                       (MISCONFIGURED). The event is secret-free.
 *
 * @param {import('./residency-posture.js').BackendEvidence} backendConfig  what the backend reports
 * @param {import('./residency-posture.js').PROFILE_A_POSTURE} requiredPosture  the asserted contract (injected per env)
 * @param {Object} [opts]  reserved (unused) — kept for the generic monitor(config, posture, opts) call shape
 * @returns {{ ok: boolean, event: ResidencyAlertEvent|null }}
 */
export function monitorResidencyPosture(backendConfig, requiredPosture, opts = {}) {
  void opts;

  // Fail-closed on a missing/malformed required posture: the monitor cannot judge against nothing.
  if (!postureIsUsable(requiredPosture)) {
    return Object.freeze({
      ok: false,
      event: Object.freeze({
        type: RESIDENCY_ALERT.MISCONFIGURED,
        detail:
          'no usable required residency posture supplied; the monitor cannot verify the active backend (fail-closed)',
        findings: Object.freeze([
          Object.freeze({
            finding: FINDING.UNPROVEN,
            invariant: 'required-posture',
            detail: 'requiredPosture is absent or does not declare a required endpoint class',
          }),
        ]),
        evidence: safeEvidenceFacts(backendConfig),
      }),
    });
  }

  const report = assertResidencyPosture(backendConfig, requiredPosture);
  if (report.ok) {
    return Object.freeze({ ok: true, event: null });
  }

  const regressions = report.findings.filter((f) => f.finding === FINDING.REGRESSION).length;
  const unproven = report.findings.filter((f) => f.finding === FINDING.UNPROVEN).length;

  return Object.freeze({
    ok: false,
    event: Object.freeze({
      type: RESIDENCY_ALERT.DRIFT,
      detail: `active backend diverged from the required residency/retention posture: ${regressions} regression(s), ${unproven} unproven invariant(s)`,
      findings: Object.freeze(report.findings.map((f) => Object.freeze({ ...f }))),
      evidence: safeEvidenceFacts(backendConfig),
    }),
  });
}

/**
 * Factory that binds the required posture (per-environment wiring). Returns an object with a
 * `check(backendConfig)` method that runs the monitor against the bound posture.
 *
 * @param {import('./residency-posture.js').PROFILE_A_POSTURE} requiredPosture
 * @param {Object} [opts]  forwarded to monitorResidencyPosture
 * @returns {{ check: (backendConfig: any) => { ok: boolean, event: ResidencyAlertEvent|null } }}
 */
export function createResidencyMonitor(requiredPosture, opts = {}) {
  return Object.freeze({
    check(backendConfig) {
      return monitorResidencyPosture(backendConfig, requiredPosture, opts);
    },
  });
}
