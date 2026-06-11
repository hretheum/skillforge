// Tests for the equivalence relation `≈` the genericity proof (Gate 2) consumes.
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room). See docs/04-adapters.md step 6, docs/04a §"Genericity (equivalence)",
// docs/07-build-plan.md §"Gate 2".
//
// The relation: a ≈ b iff same edge, same `kind` tag, and canonically-equal payloads —
// ignoring identity / contentHash / schemaVersion. The suite proves (1) the genericity
// meaning ("same intent, two forms"), (2) the three equivalence-relation LAWS (reflexive,
// symmetric, transitive), and (3) the structured diagnosis + assertion the harness needs.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  makeDescription,
  makeResult,
  resultsEquivalent,
  diagnoseEquivalence,
  assertEquivalent,
  EQUIVALENCE_MISMATCH,
} from "../src/core/index.js";

// A frontend-component result, parameterized by identity + schemaVersion so we can build
// "the same intent reached two ways" (the two-output-adapter case Gate 2 exercises).
function componentResult({ identity = "Button", schemaVersion } = {}) {
  return makeResult({
    kind: "frontend-component",
    identity,
    schemaVersion,
    payload: {
      componentName: "Button",
      element: "button",
      baseClass: "hbtn",
      variants: [{ prop: "variant", value: "acc", class: "hbtn--acc" }],
      sourceClasses: ["hbtn", "hbtn--acc"],
    },
  });
}

// ---------------------------------------------------------------------------------------------
// (1) the genericity meaning: same intent regardless of which adapter rendered it
// ---------------------------------------------------------------------------------------------

test("equivalent: same edge + kind + payload, even when identity differs (two adapters, one intent)", () => {
  // The React run and the second adapter's run produce the SAME normalized result but may
  // stamp a different identity handle — the relation must see them as one intent.
  const viaReact = componentResult({ identity: "react:Button" });
  const viaWebComponents = componentResult({ identity: "web-components:Button" });
  assert.notEqual(viaReact.envelope.identity, viaWebComponents.envelope.identity);
  assert.equal(resultsEquivalent(viaReact, viaWebComponents), true);
});

test("equivalent: differing schemaVersion is ignored when edge+kind+payload agree", () => {
  const v1 = componentResult({ schemaVersion: 1 });
  const v2 = componentResult({ schemaVersion: 2 });
  assert.notEqual(v1.envelope.schemaVersion, v2.envelope.schemaVersion);
  assert.equal(resultsEquivalent(v1, v2), true);
});

test("equivalent: payload key order does not affect the relation (canonical comparison)", () => {
  const a = makeResult({ kind: "frontend-component", identity: "x", payload: { b: 1, a: 2 } });
  const b = makeResult({ kind: "frontend-component", identity: "y", payload: { a: 2, b: 1 } });
  assert.equal(resultsEquivalent(a, b), true);
});

test("NOT equivalent: a real content difference (the leak the proof must catch)", () => {
  const intended = componentResult();
  const tampered = makeResult({
    kind: "frontend-component",
    identity: "Button",
    // a second adapter that decided something of its own → different payload
    payload: { ...intended.payload, baseClass: "hbtn-tampered", sourceClasses: ["hbtn-tampered"] },
  });
  assert.equal(resultsEquivalent(intended, tampered), false);
});

test("NOT equivalent: different kind tag even if payload bytes coincide", () => {
  const a = makeResult({ kind: "frontend-component", identity: "x", payload: { e: "button" } });
  const b = makeResult({ kind: "openapi-spec", identity: "x", payload: { e: "button" } });
  assert.equal(resultsEquivalent(a, b), false);
});

test("NOT equivalent: different edge even if kind + payload coincide", () => {
  const d = makeDescription({ kind: "frontend-component", identity: "x", payload: { e: "button" } });
  const r = makeResult({ kind: "frontend-component", identity: "x", payload: { e: "button" } });
  assert.equal(resultsEquivalent(d, r), false);
});

// ---------------------------------------------------------------------------------------------
// (2) the three equivalence-relation laws
// ---------------------------------------------------------------------------------------------

test("law — reflexive: a ≈ a", () => {
  const a = componentResult();
  assert.equal(resultsEquivalent(a, a), true);
});

test("law — symmetric: a ≈ b ⇒ b ≈ a (and ¬(a ≈ c) ⇒ ¬(c ≈ a))", () => {
  const a = componentResult({ identity: "p" });
  const b = componentResult({ identity: "q" });
  assert.equal(resultsEquivalent(a, b), resultsEquivalent(b, a));

  const c = makeResult({ kind: "openapi-spec", identity: "r", payload: { x: 1 } });
  assert.equal(resultsEquivalent(a, c), resultsEquivalent(c, a));
  assert.equal(resultsEquivalent(a, c), false);
});

test("law — transitive: a ≈ b ∧ b ≈ c ⇒ a ≈ c", () => {
  const a = componentResult({ identity: "a", schemaVersion: 1 });
  const b = componentResult({ identity: "b", schemaVersion: 2 });
  const c = componentResult({ identity: "c", schemaVersion: 3 });
  assert.equal(resultsEquivalent(a, b), true);
  assert.equal(resultsEquivalent(b, c), true);
  assert.equal(resultsEquivalent(a, c), true);
});

// ---------------------------------------------------------------------------------------------
// (3) structured diagnosis + assertion (what the harness reports on)
// ---------------------------------------------------------------------------------------------

test("diagnoseEquivalence: equivalent values report no mismatch", () => {
  const out = diagnoseEquivalence(componentResult({ identity: "a" }), componentResult({ identity: "b" }));
  assert.equal(out.equivalent, true);
  assert.equal(out.mismatch, null);
  assert.equal(out.detail, null);
});

test("diagnoseEquivalence: localizes an edge mismatch", () => {
  const d = makeDescription({ kind: "frontend-component", identity: "x", payload: { e: "button" } });
  const r = makeResult({ kind: "frontend-component", identity: "x", payload: { e: "button" } });
  const out = diagnoseEquivalence(d, r);
  assert.equal(out.equivalent, false);
  assert.equal(out.mismatch, EQUIVALENCE_MISMATCH.EDGE);
  assert.deepEqual(out.detail, { a: "input", b: "output" });
});

test("diagnoseEquivalence: localizes a kind mismatch", () => {
  const a = makeResult({ kind: "frontend-component", identity: "x", payload: { e: 1 } });
  const b = makeResult({ kind: "openapi-spec", identity: "x", payload: { e: 1 } });
  const out = diagnoseEquivalence(a, b);
  assert.equal(out.mismatch, EQUIVALENCE_MISMATCH.KIND);
  assert.deepEqual(out.detail, { a: "frontend-component", b: "openapi-spec" });
});

test("diagnoseEquivalence: localizes a payload mismatch with the canonical bytes", () => {
  const a = makeResult({ kind: "frontend-component", identity: "x", payload: { e: "button" } });
  const b = makeResult({ kind: "frontend-component", identity: "y", payload: { e: "a" } });
  const out = diagnoseEquivalence(a, b);
  assert.equal(out.mismatch, EQUIVALENCE_MISMATCH.PAYLOAD);
  assert.equal(out.detail.a, '{"e":"button"}');
  assert.equal(out.detail.b, '{"e":"a"}');
});

test("assertEquivalent: passes silently when equivalent", () => {
  assert.doesNotThrow(() =>
    assertEquivalent(componentResult({ identity: "a" }), componentResult({ identity: "b" })),
  );
});

test("assertEquivalent: throws a localized error carrying mismatch + detail", () => {
  const a = componentResult();
  const b = makeResult({
    kind: "frontend-component",
    identity: "Button",
    payload: { ...a.payload, baseClass: "x", sourceClasses: ["x"] },
  });
  try {
    assertEquivalent(a, b, "react vs web-components");
    assert.fail("expected assertEquivalent to throw");
  } catch (err) {
    assert.match(err.message, /react vs web-components do not express the same intent/);
    assert.match(err.message, /payload mismatch/);
    assert.equal(err.mismatch, EQUIVALENCE_MISMATCH.PAYLOAD);
    assert.ok(err.detail && typeof err.detail.a === "string");
  }
});

// ---------------------------------------------------------------------------------------------
// validate-before-acting: the relation only applies to well-formed normalized values
// ---------------------------------------------------------------------------------------------

test("the relation validates both operands (a malformed value is an error, not 'not equivalent')", () => {
  const good = componentResult();
  const malformed = { edge: "output", envelope: { ...good.envelope }, payload: { changed: true } };
  assert.throws(() => resultsEquivalent(good, malformed), /does not match the payload/);
  assert.throws(() => diagnoseEquivalence(good, malformed), /does not match the payload/);
});
