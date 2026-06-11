// LINT-ECC-DUPLICATE — a skill name must exist in exactly one source: the local
// registry or the global store (~/.skillforge/skills/), never both. checkGlobalStoreDuplicates
// is pure over its inputs (the store dir names are passed in), so these cases need no FS.

import { test } from "node:test";
import assert from "node:assert/strict";

import { checkGlobalStoreDuplicates } from "../../tools/registry-lint.js";

test("a name in both registry.skills and the global store is a hard error", () => {
  const registry = { skills: { "create-component": {}, "other-skill": {} } };
  const violations = checkGlobalStoreDuplicates({ registry, globalStoreDirs: ["create-component"] });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /LINT-ECC-DUPLICATE/);
  assert.match(violations[0], /create-component/);
});

test("a name only in the registry (not the store) is fine", () => {
  const registry = { skills: { "create-component": {} } };
  const violations = checkGlobalStoreDuplicates({ registry, globalStoreDirs: ["unrelated-store-skill"] });
  assert.deepEqual(violations, []);
});

test("a name only in the global store (not the registry) is fine", () => {
  const registry = { skills: { "create-component": {} } };
  const violations = checkGlobalStoreDuplicates({ registry, globalStoreDirs: ["store-only-skill"] });
  assert.deepEqual(violations, []);
});

test("an empty global store yields no violations", () => {
  const registry = { skills: { "create-component": {} } };
  const violations = checkGlobalStoreDuplicates({ registry, globalStoreDirs: [] });
  assert.deepEqual(violations, []);
});
