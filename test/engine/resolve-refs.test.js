// resolveRefs — the instruction family's reference edge under the runtime-failure contract.
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room). The instruction family has no input adapter, but its references are
// still a RUNTIME edge: a file that resolved at load time can be missing or malformed at call
// time. resolveRefs reads + parses each resolvable reference behind the SAME classifier the
// input adapter uses, so a compose step receives ALREADY-PARSED data (never a raw fs/JSON throw).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveRefs } from "../../src/adapters/run-edges.js";
import { isAdapterFailure } from "../../src/adapters/failure.js";

let DIR;
let GOOD;
let BAD;

before(() => {
  DIR = mkdtempSync(join(tmpdir(), "sf-resolverefs-"));
  GOOD = join(DIR, "good.json");
  BAD = join(DIR, "bad.json");
  writeFileSync(GOOD, JSON.stringify({ identity: { name: "x" }, offer: [] }));
  writeFileSync(BAD, "{ not valid json");
});

after(() => {
  if (DIR) rmSync(DIR, { recursive: true, force: true });
});

test("resolveRefs parses a resolvable reference into .data (compose never touches the fs)", () => {
  const out = resolveRefs({
    competitiveContext: { ref: "./good.json", resolvedPath: GOOD, local: true },
  });
  assert.deepEqual(out.competitiveContext.data, { identity: { name: "x" }, offer: [] });
  // original fields preserved
  assert.equal(out.competitiveContext.resolvedPath, GOOD);
  assert.equal(out.competitiveContext.local, true);
});

test("resolveRefs leaves an unresolved reference with data:null (does not fail blindly)", () => {
  // A remote/unresolved ref the skill may not need — passed through, not read.
  const out = resolveRefs({
    designSystem: { ref: "figma://abc", resolvedPath: null, local: false },
  });
  assert.equal(out.designSystem.data, null);
  assert.equal(out.designSystem.resolvedPath, null);
});

test("resolveRefs: a MISSING reference file is a typed, FATAL failure (not a raw fs throw)", () => {
  const missing = join(DIR, "does-not-exist.json");
  let caught;
  try {
    resolveRefs({ competitiveContext: { ref: "./missing.json", resolvedPath: missing, local: true } });
  } catch (e) {
    caught = e;
  }
  assert.ok(caught, "a missing reference file must throw");
  assert.ok(isAdapterFailure(caught), "the throw is a typed AdapterFailure, not a raw fs error");
  assert.equal(caught.fatal, true);
  assert.equal(caught.edge, "input");
});

test("resolveRefs: a MALFORMED JSON reference is a typed, FATAL failure (permanent class)", () => {
  let caught;
  try {
    resolveRefs({ competitiveContext: { ref: "./bad.json", resolvedPath: BAD, local: true } });
  } catch (e) {
    caught = e;
  }
  assert.ok(caught, "a malformed JSON reference must throw");
  assert.ok(isAdapterFailure(caught), "the throw is a typed AdapterFailure, not a raw SyntaxError");
  assert.equal(caught.fatal, true);
  assert.equal(caught.failureClass, "permanent");
});

test("resolveRefs: an empty references map yields an empty resolved map (no-op)", () => {
  assert.deepEqual(resolveRefs({}), {});
  assert.deepEqual(resolveRefs(), {});
});
