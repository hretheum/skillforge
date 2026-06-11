// Tests for the normalized form: envelope + description + result tagged union,
// round-trip, determinism, content-hash binding, and payload equality.
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room). See docs/04a-normalized-form.md.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SCHEMA_VERSION,
  EDGE,
  makeDescription,
  makeResult,
  validateNormalized,
  serialize,
  deserialize,
  payloadsEqual,
  contentHash,
  isContentHash,
} from "../src/core/index.js";

// A worked input-edge shape: a design-system source-kind payload (tokens + roles).
function designSystemDescription() {
  return makeDescription({
    kind: "design-system",
    identity: "tokens@v1",
    payload: {
      tokens: [
        { name: "color.ink", value: "#111111" },
        { name: "color.red", value: "#cc0000" },
      ],
      roles: { accent: "color.red", text: "color.ink" },
    },
  });
}

// A worked output-edge shape: a frontend-component result-kind payload.
function componentResult() {
  return makeResult({
    kind: "frontend-component",
    identity: "Button",
    payload: {
      element: "button",
      bindings: [
        { prop: "background", role: "accent" },
        { prop: "color", role: "text" },
      ],
    },
  });
}

test("a description carries the input edge and the four envelope fields", () => {
  const d = designSystemDescription();
  assert.equal(d.edge, EDGE.INPUT);
  assert.equal(d.envelope.kind, "design-system");
  assert.equal(d.envelope.identity, "tokens@v1");
  assert.equal(d.envelope.schemaVersion, SCHEMA_VERSION);
  assert.ok(isContentHash(d.envelope.contentHash));
});

test("a result carries the output edge and is tagged by its result-kind", () => {
  const r = componentResult();
  assert.equal(r.edge, EDGE.OUTPUT);
  assert.equal(r.envelope.kind, "frontend-component");
  assert.equal(r.envelope.identity, "Button");
});

test("the envelope is identical in shape on both edges", () => {
  const d = designSystemDescription();
  const r = componentResult();
  assert.deepEqual(Object.keys(d.envelope).sort(), Object.keys(r.envelope).sort());
});

test("content-hash is computed from the payload, not accepted from the caller", () => {
  const d = designSystemDescription();
  assert.equal(d.envelope.contentHash, contentHash(d.payload));
});

test("both worked shapes validate", () => {
  assert.equal(validateNormalized(designSystemDescription()), true);
  assert.equal(validateNormalized(componentResult()), true);
});

test("round-trip: deserialize(serialize(v)) re-serializes to identical bytes", () => {
  for (const v of [designSystemDescription(), componentResult()]) {
    const bytes = serialize(v);
    const back = deserialize(bytes);
    assert.equal(serialize(back), bytes);
    assert.equal(back.edge, v.edge);
    assert.equal(back.envelope.kind, v.envelope.kind);
    assert.equal(back.envelope.identity, v.envelope.identity);
    assert.equal(back.envelope.contentHash, v.envelope.contentHash);
    assert.deepEqual(back.payload, v.payload);
  }
});

test("determinism: same logical input serializes to the same bytes every run", () => {
  const first = serialize(designSystemDescription());
  for (let i = 0; i < 5; i++) {
    assert.equal(serialize(designSystemDescription()), first);
  }
});

test("determinism: payload key order does not change the bytes or the hash", () => {
  const a = makeDescription({
    kind: "design-system",
    identity: "x",
    payload: { b: 1, a: 2, nested: { y: 1, x: 2 } },
  });
  const b = makeDescription({
    kind: "design-system",
    identity: "x",
    payload: { nested: { x: 2, y: 1 }, a: 2, b: 1 },
  });
  assert.equal(serialize(a), serialize(b));
  assert.equal(a.envelope.contentHash, b.envelope.contentHash);
});

test("validateNormalized catches a payload that drifted from its content-hash", () => {
  const d = designSystemDescription();
  // Forge a value whose stored hash no longer matches its payload.
  const tampered = {
    edge: d.edge,
    envelope: { ...d.envelope },
    payload: { ...d.payload, roles: { accent: "color.ink" } },
  };
  assert.throws(() => validateNormalized(tampered), /does not match the payload/);
});

test("deserialize rejects bytes whose stored hash was tampered with", () => {
  const bytes = serialize(designSystemDescription());
  const obj = JSON.parse(bytes);
  obj.envelope.contentHash = "sha256:" + "0".repeat(64);
  const forged = JSON.stringify(obj);
  assert.throws(() => deserialize(forged), /does not match the stored content-hash/);
});

test("invalid envelope fields are rejected at construction (validate before acting)", () => {
  assert.throws(() => makeDescription({ kind: "Design System", identity: "x", payload: {} }), /kind/);
  assert.throws(() => makeDescription({ kind: "design-system", identity: "", payload: {} }), /identity/);
  assert.throws(() => makeDescription({ kind: "design-system", identity: "x" }), /payload is required/);
});

test("genericity: two equivalent descriptions of one source-kind have equal payloads", () => {
  // Same logical source reached two ways: different identity, same payload.
  const viaA = makeDescription({
    kind: "design-system",
    identity: "source-a",
    payload: { tokens: [{ name: "color.ink", value: "#111111" }] },
  });
  const viaB = makeDescription({
    kind: "design-system",
    identity: "source-b",
    payload: { tokens: [{ name: "color.ink", value: "#111111" }] },
  });
  // Identity and content-hash are equal here (same payload), but the point of
  // payloadsEqual is that it ignores identity: prove it with a differing one.
  assert.notEqual(viaA.envelope.identity, viaB.envelope.identity);
  assert.equal(payloadsEqual(viaA, viaB), true);
});

test("payloadsEqual is false across different kinds or different payloads", () => {
  const a = makeDescription({ kind: "design-system", identity: "x", payload: { t: 1 } });
  const b = makeDescription({ kind: "jira-project", identity: "x", payload: { t: 1 } });
  const c = makeDescription({ kind: "design-system", identity: "x", payload: { t: 2 } });
  assert.equal(payloadsEqual(a, b), false);
  assert.equal(payloadsEqual(a, c), false);
});

test("payloadsEqual is true across edges only when kind and payload match", () => {
  // An input and an output with the same kind+payload still differ by edge.
  const d = makeDescription({ kind: "frontend-component", identity: "x", payload: { e: "button" } });
  const r = makeResult({ kind: "frontend-component", identity: "x", payload: { e: "button" } });
  assert.equal(payloadsEqual(d, r), false);
});
