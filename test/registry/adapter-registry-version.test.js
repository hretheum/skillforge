// Tests for the namespaced + versioned adapter registry (T-P4-02).
//
// Sources: concept + first principles, zero third-party skills-factory files (clean-room).
// Covers docs/04 §registry (API-06) + docs/12: per-adapter contract version, a config pin,
// semver-compatible resolution, and backward-compatibility with the bare-name seed shape.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createAdapterRegistry,
  defaultAdapterRegistry,
  versionSatisfies,
  DEFAULT_CONTRACT_VERSION,
  GATE_KINDS,
  EDGES,
} from "../../src/loader/adapter-registry.js";

// --- backward-compatible seed shapes ---------------------------------------

test("a bare-name seed still resolves (legacy shape, version defaulted)", () => {
  const reg = createAdapterRegistry({ input: ["dtcg-tokens"], output: ["react"] });
  assert.equal(reg.has(EDGES.INPUT, "dtcg-tokens"), true);
  assert.equal(reg.has(EDGES.OUTPUT, "react"), true);
  assert.deepEqual(reg.names(EDGES.INPUT), ["dtcg-tokens"]);
  // a name string gets the default contract version
  assert.equal(reg.version(EDGES.INPUT, "dtcg-tokens"), DEFAULT_CONTRACT_VERSION);
});

test("the legacy 2-arg register(edge, name) still works", () => {
  const reg = createAdapterRegistry();
  reg.register(EDGES.INPUT, "jira");
  assert.equal(reg.has(EDGES.INPUT, "jira"), true);
  assert.equal(reg.version(EDGES.INPUT, "jira"), DEFAULT_CONTRACT_VERSION);
});

// --- the edges are independent namespaces ----------------------------------

test("input.* and output.* are independent namespaces (same name, both edges)", () => {
  const reg = createAdapterRegistry({
    input: [{ name: "shared", version: "2.0.0", gate: { kind: GATE_KINDS.input, golden: "x.json" } }],
    output: [{ name: "shared", version: "1.3.0", gate: { kind: GATE_KINDS.output, pairsWith: "react" } }],
  });
  assert.equal(reg.version(EDGES.INPUT, "shared"), "2.0.0");
  assert.equal(reg.version(EDGES.OUTPUT, "shared"), "1.3.0");
});

// --- the version-compat predicate ------------------------------------------

test("versionSatisfies: no pin is always satisfied (backward-compatible path)", () => {
  assert.equal(versionSatisfies("1.0.0", null), true);
  assert.equal(versionSatisfies("9.9.9", undefined), true);
});

test("versionSatisfies: same MAJOR, available >= pin is satisfied", () => {
  assert.equal(versionSatisfies("1.2.3", "1.2.3"), true);
  assert.equal(versionSatisfies("1.3.0", "1.2.9"), true); // newer minor
  assert.equal(versionSatisfies("1.2.4", "1.2.3"), true); // newer patch
});

test("versionSatisfies: a MAJOR mismatch is a breaking contract change (not satisfied)", () => {
  assert.equal(versionSatisfies("2.0.0", "1.0.0"), false);
  assert.equal(versionSatisfies("1.0.0", "2.0.0"), false);
});

test("versionSatisfies: an available OLDER than the pin is not satisfied", () => {
  assert.equal(versionSatisfies("1.2.0", "1.3.0"), false); // older minor
  assert.equal(versionSatisfies("1.2.3", "1.2.4"), false); // older patch
});

test("versionSatisfies: a malformed version throws", () => {
  assert.throws(() => versionSatisfies("1.0", "1.0.0"), /not "MAJOR\.MINOR\.PATCH"/);
  assert.throws(() => versionSatisfies("1.0.0", "v1"), /not "MAJOR\.MINOR\.PATCH"/);
});

// --- resolve: existence + pin enforcement (the loader/lint primitive) ------

test("resolve returns the record when the name exists and no pin is given", () => {
  const reg = defaultAdapterRegistry();
  const rec = reg.resolve(EDGES.OUTPUT, "react");
  assert.equal(rec.name, "react");
  assert.equal(rec.version, "1.0.0");
});

test("resolve passes when the catalog satisfies a compatible pin", () => {
  const reg = defaultAdapterRegistry(); // react@1.0.0
  assert.doesNotThrow(() => reg.resolve(EDGES.OUTPUT, "react", "1.0.0"));
});

test("resolve THROWS on an unknown name", () => {
  const reg = defaultAdapterRegistry();
  assert.throws(() => reg.resolve(EDGES.INPUT, "no-such"), /unknown input adapter "no-such"/);
});

test("resolve THROWS when the catalog does not satisfy the pin", () => {
  const reg = defaultAdapterRegistry(); // react@1.0.0
  assert.throws(
    () => reg.resolve(EDGES.OUTPUT, "react", "2.0.0"),
    /version 1\.0\.0 does not satisfy the config's pin "2\.0\.0"/,
  );
});

// --- construction validates version + gate shape ---------------------------

test("a gate whose kind does not match the edge fails construction", () => {
  assert.throws(
    () => createAdapterRegistry({ input: [{ name: "x", gate: { kind: GATE_KINDS.output } }] }),
    /does not match the "input" edge requirement/,
  );
});

test("a malformed version on a seed entry fails construction", () => {
  assert.throws(() => createAdapterRegistry({ output: [{ name: "x", version: "1.0" }] }), /not "MAJOR\.MINOR\.PATCH"/);
});

// --- the default catalog is fully versioned + gated ------------------------

test("the default catalog stamps every adapter with a version and a gate", () => {
  const reg = defaultAdapterRegistry();
  for (const edge of [EDGES.INPUT, EDGES.OUTPUT]) {
    for (const rec of reg.entries(edge)) {
      assert.equal(typeof rec.version, "string", `${edge}.${rec.name} has a version`);
      assert.ok(rec.gate && rec.gate.kind === GATE_KINDS[edge], `${edge}.${rec.name} ships its gate`);
    }
  }
});
