// CC-24 — a registry whose `skills` field is a string (or array), not an object. This is
// syntactically valid JSON but semantically wrong. validateStructure must return a single clean
// FATAL ("registry.skills must be an object keyed by skill name") and NOT crash with
// undefined.map() / Object.keys on a non-object; lintRegistry short-circuits the policy pass on the
// fatal so there is no misleading cascade.
//
// Sources: concept + first principles, zero third-party skills-factory files (clean-room).

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateStructure, lintRegistry } from "../../tools/registry-lint.js";
import { defaultAdapterRegistry } from "../../src/loader/adapter-registry.js";

const ALLOWLIST = { allowed: ["Read", "Write"] };

function ctx(skills) {
  return {
    registry: { schemaVersion: "1", skills },
    allowlist: ALLOWLIST,
    adapterRegistry: defaultAdapterRegistry(),
    skillDirs: [],
    globalStoreDirs: [],
  };
}

test("CC-24: skills as a string yields a single clean fatal, not a crash", () => {
  let errors;
  assert.doesNotThrow(() => {
    errors = validateStructure(ctx("see-other-file"));
  }, "a string skills field must not throw a TypeError");
  assert.deepEqual(errors, ["registry.skills must be an object keyed by skill name"]);
});

test("CC-24: skills as an array also yields the fatal (arrays are rejected too)", () => {
  const errors = validateStructure(ctx([{ name: "x" }]));
  assert.ok(
    errors.includes("registry.skills must be an object keyed by skill name"),
    "an array skills field is rejected with the same fatal",
  );
});

test("CC-24: lintRegistry short-circuits the policy pass on the fatal (no cascade)", () => {
  const errors = lintRegistry(ctx("see-other-file"));
  // Exactly the one fatal — the policy pass (allowlist/governance) is skipped because there is
  // nothing well-formed to govern.
  assert.deepEqual(errors, ["registry.skills must be an object keyed by skill name"]);
});

test("CC-24: a null registry is the other fatal, also handled without a crash", () => {
  let errors;
  assert.doesNotThrow(() => {
    errors = validateStructure({
      registry: null,
      adapterRegistry: defaultAdapterRegistry(),
      skillDirs: [],
      globalStoreDirs: [],
    });
  });
  assert.deepEqual(errors, ["registry must be a JSON object"]);
});
