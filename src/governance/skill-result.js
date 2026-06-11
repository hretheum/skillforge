// Per-run skill_result (PASS/FAIL) at the PostToolUse seam (OBS-04).
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room). Realizes docs/10-telemetry-and-grafana.md §success-rate (OBS-04) +
// docs/13-tool-governance.md §"PostToolUse → telemetry / audit".
//
// WHY THIS EXISTS (OBS-04). The success-rate KPI must NOT be proxied by API-error counts: an
// API error is per-API-call (many per generation), a skill activation is per-skill — dividing
// one by the other answers "backend reliability", not "did the generation succeed". A run that
// succeeds after two retried transient errors would WRONGLY lower an api-error-derived rate.
// So success is defined at the GENERATION grain: a run PASSES iff it produced its artifact
// without a FATAL error, and FAILS otherwise. This module emits that per-run outcome as a
// structured `skillforge.skill_result` event at the same seam as the PostToolUse audit, so the
// dashboard reads a true generation-success signal instead of inferring one.
//
// TIES TO THE FAILURE CONTRACT (API-01, src/adapters/failure.js). "Fatal" is exactly the
// contract's fatal flag: a fatal AdapterFailure (auth, permanent, or transient-past-cap) or a
// denied tool gate is a FAIL; a clean artifact is a PASS. A RECOVERABLE failure that the run
// retried past is NOT a fail — it never aborted the generation. fromFailure() reads the typed
// failure's class so the event records WHY a run failed without re-deriving it.
//
// SECRET-FREE BY CONSTRUCTION (docs/11 + docs/10 privacy). The event carries only run-shape
// facts — skill, client identifier (the same handle docs/03 uses, never client *content*),
// outcome, and a classified failure reason — never a secret value, never raw source/artifact
// content. makeSkillResult() scans its own payload and refuses to emit a secret-bearing event
// (fail-closed: a telemetry leak is a leak).
//
// MODEL-INDEPENDENT & EMITTER-INJECTED. Like the PreToolUse hook, this is plain logic over
// data; it calls no model. The actual transport (OTLP/Loki, a collector, stdout in a test) is
// an injected `emit` sink, so the engine decides WHAT the event is while the deployment decides
// WHERE it goes — telemetry is an operational concern of the environment, not client data.

import { hasSecret, redactValue } from "./secret-scan.js";
import { FAILURE_CLASS, isAdapterFailure } from "../adapters/failure.js";

/** The two generation-grain outcomes (OBS-04). */
export const SKILL_RESULT = Object.freeze({ PASS: "PASS", FAIL: "FAIL" });

/** The event name, namespaced to skillforge (a custom event alongside Claude Code's native ones). */
export const SKILL_RESULT_EVENT = "skillforge.skill_result";

/** The hook seam this event is emitted at (docs/13 §PostToolUse). */
export const HOOK_EVENT_NAME = "PostToolUse";

/**
 * Build a generation-grain skill_result event. PURE — it constructs and validates the event but
 * does not emit it (emitSkillResult does). Refuses to build a secret-bearing event (fail-closed).
 *
 * @param {object} info
 * @param {("PASS"|"FAIL")} info.outcome   the generation-grain outcome
 * @param {string} info.skill              the skill that ran (e.g. "create-component")
 * @param {string} [info.client]           the client IDENTIFIER (a handle, never client content)
 * @param {string|null} [info.project]     the active project handle (scope), if any
 * @param {object|null} [info.failure]     for FAIL: a secret-free failure descriptor
 *        ({ failureClass, fatal, reason, edge, rotationHint }) — typically AdapterFailure.toData()
 * @returns {{
 *   event: string, hookEventName: string, outcome: string, skill: string,
 *   client: string|null, project: string|null, failure: object|null,
 * }}
 * @throws {TypeError} on a bad outcome, a missing skill, or a secret detected in the event
 */
export function makeSkillResult({ outcome, skill, client = null, project = null, failure = null } = {}) {
  if (outcome !== SKILL_RESULT.PASS && outcome !== SKILL_RESULT.FAIL) {
    throw new TypeError(`skill_result outcome must be "PASS" or "FAIL", got ${JSON.stringify(outcome)}`);
  }
  if (typeof skill !== "string" || skill.length === 0) {
    throw new TypeError("skill_result requires a non-empty skill name");
  }

  const event = {
    event: SKILL_RESULT_EVENT,
    hookEventName: HOOK_EVENT_NAME,
    outcome,
    skill,
    client,
    project,
    // For a PASS there is no failure; for a FAIL we carry only the secret-free classified
    // descriptor (never the raw error, never source/artifact content).
    failure: outcome === SKILL_RESULT.FAIL ? normalizeFailure(failure) : null,
  };

  // Telemetry must not become a secret-leak surface (docs/11). Scan the whole event we are
  // about to emit; if anything credential-shaped slipped into a field (e.g. a misused rotation
  // hint), refuse to emit — fail-closed, the same discipline as the PreToolUse secret-scan.
  if (hasSecret(event)) {
    throw new TypeError(
      "refusing to emit a skill_result event: it carries a credential-shaped value " +
        "(telemetry is secret-free — references, never values)",
    );
  }
  return event;
}

/**
 * Construct a FAIL event from a typed failure (the common case). Reads the failure's class/
 * reason so the event records WHY without re-deriving. A non-AdapterFailure (an unexpected raw
 * error) still yields a FAIL with a generic, secret-free reason — an unclassified abort is a
 * fail, not a silent pass.
 *
 * @param {unknown} failure   the error that aborted the run (ideally an AdapterFailure)
 * @param {object} ctx        { skill, client?, project? }
 * @returns {object} a skill_result FAIL event
 */
export function fromFailure(failure, { skill, client = null, project = null } = {}) {
  let descriptor;
  if (isAdapterFailure(failure)) {
    descriptor = failure.toData();
  } else {
    // An unexpected, unclassified error: record a permanent-fatal FAIL with a generic reason.
    // We do NOT copy the raw error's message verbatim into telemetry (it could carry content);
    // the reason is a fixed, safe string and the class is the fail-closed permanent.
    descriptor = {
      failureClass: FAILURE_CLASS.PERMANENT,
      fatal: true,
      reason: "the run aborted with an unclassified error (treated as a fatal generation failure)",
      edge: null,
      rotationHint: null,
    };
  }
  return makeSkillResult({ outcome: SKILL_RESULT.FAIL, skill, client, project, failure: descriptor });
}

/** Construct a PASS event for a run that produced its artifact without a fatal error. */
export function fromSuccess({ skill, client = null, project = null } = {}) {
  return makeSkillResult({ outcome: SKILL_RESULT.PASS, skill, client, project });
}

/**
 * Emit a skill_result event through an injected sink. The sink is the deployment's transport
 * (OTLP/Loki exporter, a collector, or a no-op/buffer in a test). A sink that throws must not
 * take down the run — telemetry is best-effort and never the reason a generation fails — so an
 * emit error is swallowed (the event is still returned for the caller/tests to assert on).
 *
 * @param {object} event   the event from makeSkillResult/fromFailure/fromSuccess
 * @param {(event: object) => void} [emit]  the sink (default: no-op)
 * @returns {object} the event that was emitted (for chaining/assertions)
 */
export function emitSkillResult(event, emit) {
  if (typeof emit === "function") {
    // Redact on the wire (AC: scan + REDACT on outbound). makeSkillResult already REFUSED a
    // secret-bearing event at build time (fail-closed); redaction is the defense-in-depth pass that
    // strips any credential-shaped span a build slipped past, so the sink never receives a value.
    const safe = redactValue(event);
    try {
      emit(safe);
    } catch {
      // Best-effort: a broken telemetry sink does not fail the generation. (A persistent sink
      // outage is itself observable via the absence of events — not by crashing the factory.)
    }
  }
  return event;
}

// --- internals ----------------------------------------------------------------------------

/**
 * Normalize a failure descriptor to the secret-free shape the event carries. Accepts an
 * AdapterFailure (calls toData), a plain descriptor object, or null.
 */
function normalizeFailure(failure) {
  if (failure === null || failure === undefined) {
    // A FAIL with no descriptor — still a defined (if sparse) outcome.
    return { failureClass: FAILURE_CLASS.PERMANENT, fatal: true, reason: "generation failed", edge: null, rotationHint: null };
  }
  if (isAdapterFailure(failure)) return failure.toData();
  // A plain object: keep only the known secret-free fields (never spread arbitrary keys into
  // telemetry — that is how content leaks).
  return {
    failureClass: failure.failureClass ?? FAILURE_CLASS.PERMANENT,
    fatal: typeof failure.fatal === "boolean" ? failure.fatal : true,
    reason: typeof failure.reason === "string" ? failure.reason : "generation failed",
    edge: failure.edge ?? null,
    rotationHint: failure.rotationHint ?? null,
  };
}
