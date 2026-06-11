// Tests for the canonical, byte-stable serializer.
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room).

import { test } from "node:test";
import assert from "node:assert/strict";

import { canonicalize, formatNumber, VOLATILE_KEYS } from "../src/core/canonical.js";

test("object keys are emitted in sorted order regardless of insertion order", () => {
  const a = canonicalize({ b: 1, a: 2, c: 3 });
  const b = canonicalize({ c: 3, a: 2, b: 1 });
  assert.equal(a, b);
  assert.equal(a, '{"a":2,"b":1,"c":3}');
});

test("nested objects sort recursively; arrays keep their order", () => {
  const out = canonicalize({ z: { y: 1, x: 2 }, list: [3, 1, 2] });
  assert.equal(out, '{"list":[3,1,2],"z":{"x":2,"y":1}}');
});

test("numbers have a stable, locale-independent format", () => {
  assert.equal(formatNumber(1), "1");
  assert.equal(formatNumber(1.5), "1.5");
  assert.equal(formatNumber(-0), "0");
  assert.equal(formatNumber(0), "0");
  assert.equal(formatNumber(1000000), "1000000");
  assert.equal(canonicalize({ n: 0.1 }), '{"n":0.1}');
});

test("negative zero and positive zero serialize identically", () => {
  assert.equal(canonicalize({ n: -0 }), canonicalize({ n: 0 }));
});

test("non-finite numbers are rejected (no canonical JSON form)", () => {
  assert.throws(() => canonicalize({ n: NaN }), /non-finite/);
  assert.throws(() => canonicalize({ n: Infinity }), /non-finite/);
  assert.throws(() => canonicalize({ n: -Infinity }), /non-finite/);
});

test("explicit-undefined and absent key serialize identically", () => {
  assert.equal(canonicalize({ a: 1, b: undefined }), canonicalize({ a: 1 }));
});

test("strings are escaped canonically", () => {
  assert.equal(canonicalize("a\"b\n"), '"a\\"b\\n"');
});

test("null, booleans serialize canonically", () => {
  assert.equal(canonicalize(null), "null");
  assert.equal(canonicalize(true), "true");
  assert.equal(canonicalize(false), "false");
});

test("volatile keys break byte-stability and are rejected", () => {
  for (const key of VOLATILE_KEYS) {
    assert.throws(() => canonicalize({ [key]: 1 }), /volatile key/, `expected ${key} to be rejected`);
  }
  // nested volatile keys are also caught
  assert.throws(() => canonicalize({ a: { b: { timestamp: 1 } } }), /volatile key/);
});

test("exotic objects are rejected (ambiguous / volatile JSON shape)", () => {
  assert.throws(() => canonicalize({ d: new Date(0) }), /plain objects/);
  assert.throws(() => canonicalize({ m: new Map() }), /plain objects/);
  class Foo {}
  assert.throws(() => canonicalize({ f: new Foo() }), /plain objects/);
});

test("bigint, function, symbol are rejected", () => {
  assert.throws(() => canonicalize({ n: 1n }), /bigint/);
  assert.throws(() => canonicalize({ f: () => {} }), /function/);
  assert.throws(() => canonicalize({ s: Symbol("x") }), /symbol/);
});

test("output is valid JSON that parses back to an equal value", () => {
  const value = { a: [1, 2, { x: "y" }], b: null, c: true };
  const bytes = canonicalize(value);
  assert.deepEqual(JSON.parse(bytes), value);
});
