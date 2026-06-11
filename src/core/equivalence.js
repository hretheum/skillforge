// The equivalence relation for the genericity proof — "same intent, two forms".
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room). See docs/04-adapters.md §"how to add a new adapter" (step 6, the
// genericity proof), docs/04a-normalized-form.md §"Why this is the only language of the core
// — and how it proves genericity" (point 2, "Genericity (equivalence)"), and
// docs/07-build-plan.md §"Gate 2".
//
// WHAT THIS DEFINES. The two-adapter genericity proof (Gate 2) renders ONE skill result
// through TWO different output adapters and asserts the two runs "express the same intent".
// "Same intent" is NOT "same rendered bytes" — two adapters legitimately produce two
// different artifact FORMS (a React file vs a Web Component). What must coincide is the
// normalized RESULT the core decided once, before either adapter rendered it. So the thing
// being compared is the tagged-union normalized value (envelope + payload), and the relation
// below is the precise, documented predicate over it that Gate 2 consumes.
//
// THE RELATION. Two normalized values `a`, `b` are EQUIVALENT (`≈`) iff:
//
//   1. they belong to the same edge        (a.edge === b.edge), AND
//   2. they carry the same `kind` tag       (a.envelope.kind === b.envelope.kind), AND
//   3. their payloads are canonically equal  (canonicalize(a.payload) === canonicalize(b.payload)).
//
// What it deliberately IGNORES — and why these may legitimately differ between the two runs:
//   - `envelope.identity`     — a human handle for "which thing" (e.g. the source reference,
//                               or an adapter-supplied name). docs/04a says equivalence holds
//                               "up to the envelope's identity/content-hash".
//   - `envelope.contentHash`  — a pure function of the payload; if payloads are canonically
//                               equal the hashes already match, but the relation does not
//                               depend on it (it is derived, not load-bearing for intent).
//   - `envelope.schemaVersion`— the contract version is part of validation (validateNormalized),
//                               not of "is this the same intent"; two values that pass
//                               validation and agree on edge+kind+payload express one intent.
//
// WHY edge AND kind ARE PART OF THE RELATION. A `frontend-component` payload and an
// `openapi-spec` payload could in principle canonicalize to the same bytes by coincidence;
// without the `kind` tag they would be wrongly judged equivalent (the tagged union's tag is
// what disambiguates — docs/04a §"a tagged union over the shared envelope"). Likewise an
// input DESCRIPTION and an output RESULT with the same kind+payload are NOT the same intent —
// one describes a source, the other an artifact; the edge separates them.
//
// THIS IS A TRUE EQUIVALENCE RELATION over the set of valid normalized values:
//   - REFLEXIVE:  a ≈ a            (an equality of canonical bytes is reflexive).
//   - SYMMETRIC:  a ≈ b ⇒ b ≈ a    (every clause is symmetric).
//   - TRANSITIVE: a ≈ b ∧ b ≈ c ⇒ a ≈ c (string equality of canonical bytes is transitive).
// The unit tests assert all three laws, so "same intent" is a checkable mathematical property,
// not a convention. The genericity-proof harness (T-P2-03) is exactly the assertion `≈` holds
// between the React run's result and the second adapter's run's result, with no engine-code
// change between the two runs.

import { canonicalize } from "./canonical.js";
import { validateNormalized } from "./normalized-form.js";

/** The reasons two normalized values fail to express the same intent (stable, machine-usable). */
export const EQUIVALENCE_MISMATCH = Object.freeze({
  EDGE: "edge",
  KIND: "kind",
  PAYLOAD: "payload",
});

/**
 * Whether two normalized values express the SAME INTENT — the equivalence relation `≈` the
 * genericity proof (Gate 2) asserts. True iff same edge, same `kind` tag, and canonically
 * equal payloads; `identity`, `contentHash`, and `schemaVersion` are ignored (they may
 * legitimately differ between two runs / two adapters).
 *
 * Both arguments are validated first (validate before acting) so the relation is only ever
 * applied to well-formed normalized values — a malformed value is an error, not "not
 * equivalent".
 *
 * This is the boolean face of {@link diagnoseEquivalence}; it reuses the same comparison the
 * core's `payloadsEqual` uses (canonical bytes), so there is one definition of "same payload".
 *
 * @param {object} a  a normalized value (envelope + payload), input or output edge.
 * @param {object} b  a normalized value to compare against.
 * @returns {boolean} true iff `a ≈ b`.
 */
export function resultsEquivalent(a, b) {
  return diagnoseEquivalence(a, b).equivalent;
}

/**
 * The structured form of the relation: not just whether `a ≈ b`, but — when they differ —
 * WHICH clause failed and the two offending values, so the harness and its error messages can
 * localize a genericity break to "the two adapters disagreed on the payload" vs "they were
 * tagged with different kinds" rather than an opaque false.
 *
 * @param {object} a  a normalized value (validated here).
 * @param {object} b  a normalized value (validated here).
 * @returns {{ equivalent: boolean, mismatch: (string|null), detail: (object|null) }}
 *   `equivalent` is the relation's truth value; on `false`, `mismatch` is one of
 *   EQUIVALENCE_MISMATCH and `detail` carries the two conflicting values for that clause.
 */
export function diagnoseEquivalence(a, b) {
  validateNormalized(a);
  validateNormalized(b);

  if (a.edge !== b.edge) {
    return mismatch(EQUIVALENCE_MISMATCH.EDGE, { a: a.edge, b: b.edge });
  }
  if (a.envelope.kind !== b.envelope.kind) {
    return mismatch(EQUIVALENCE_MISMATCH.KIND, { a: a.envelope.kind, b: b.envelope.kind });
  }
  const bytesA = canonicalize(a.payload);
  const bytesB = canonicalize(b.payload);
  if (bytesA !== bytesB) {
    return mismatch(EQUIVALENCE_MISMATCH.PAYLOAD, { a: bytesA, b: bytesB });
  }

  return { equivalent: true, mismatch: null, detail: null };
}

/**
 * Assert two normalized values express the same intent; throw a localized error if not. The
 * genericity-proof harness uses this so a broken proof fails loud with the exact clause and
 * the conflicting values, not a bare assertion.
 *
 * @param {object} a  a normalized value.
 * @param {object} b  a normalized value.
 * @param {string} [context]  a label for the message (e.g. "react vs web-components").
 * @throws {Error} naming the failing clause; carries `.mismatch` and `.detail`.
 */
export function assertEquivalent(a, b, context = "two normalized results") {
  const outcome = diagnoseEquivalence(a, b);
  if (outcome.equivalent) return;

  const { mismatch: clause, detail } = outcome;
  const err = new Error(
    `${context} do not express the same intent: ${clause} mismatch ` +
      `(a=${JSON.stringify(detail.a)} b=${JSON.stringify(detail.b)})`,
  );
  err.mismatch = clause;
  err.detail = detail;
  throw err;
}

function mismatch(clause, detail) {
  return { equivalent: false, mismatch: clause, detail };
}
