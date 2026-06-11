// CC-20 — registry-lint at scale: 100 registered skills must lint in well under 5 seconds, and the
// lint must still find errors correctly with 100 entries. All per-skill work is in-memory (schema +
// a compose-ref map lookup + adapter resolve + kind typing); the only FS work is amortized once. This
// confirms lint cost is O(skills), sub-second for 100.
//
// Sources: concept + first principles, zero third-party skills-factory files (clean-room).

import { test } from "node:test";
import assert from "node:assert/strict";
import { lintRegistry } from "../../tools/registry-lint.js";
import { defaultAdapterRegistry } from "../../src/loader/adapter-registry.js";

const ALLOWLIST = { allowed: ["Read", "Write", "Edit", "Bash", "WebFetch", "WebSearch"] };

// A valid instruction-kind entry whose compose ref resolves to a known engine recipe (reused across
// all synthetic skills — a many-to-one name↔ref relationship is allowed, CC-12).
function validEntry() {
  return {
    version: "0.1.0",
    enabled: true,
    owner: "platform",
    skillKind: "instruction",
    compose: "verdex-form-builder/compose.js#composeInstruction",
    requiredTools: ["Read"],
    requiredAdapters: { input: [], output: [] },
    requiredSecrets: [],
    scope: { clients: ["*"], projects: ["*"] },
    model: "inherit",
    effort: "medium",
  };
}

function buildRegistry(n, mutate = () => {}) {
  const skills = {};
  const skillDirs = [];
  for (let i = 0; i < n; i++) {
    const name = `synthetic-skill-${i}`;
    skills[name] = validEntry();
    skillDirs.push(name); // a matching SKILL.md dir, so no inventory drift
  }
  mutate(skills, skillDirs);
  return { registry: { schemaVersion: "1", skills }, skillDirs };
}

test("CC-20: 100 valid skills lint in < 5s with no errors", () => {
  const { registry, skillDirs } = buildRegistry(100);
  const start = Date.now();
  const errors = lintRegistry({
    registry,
    allowlist: ALLOWLIST,
    adapterRegistry: defaultAdapterRegistry(),
    skillDirs,
    globalStoreDirs: [],
  });
  const elapsed = Date.now() - start;
  assert.deepEqual(errors, [], "100 valid synthetic skills lint cleanly");
  assert.ok(elapsed < 5000, `lint must finish in < 5000ms (took ${elapsed}ms)`);
});

test("CC-20: lint still finds errors correctly among 100 entries", () => {
  // Inject one entry with an unknown skillKind and one with a missing compose ref among the 100.
  const { registry, skillDirs } = buildRegistry(100, (skills) => {
    skills["synthetic-skill-7"].skillKind = "telekinesis";
    skills["synthetic-skill-42"].compose = "ghost/compose.js#nope";
  });
  const errors = lintRegistry({
    registry,
    allowlist: ALLOWLIST,
    adapterRegistry: defaultAdapterRegistry(),
    skillDirs,
    globalStoreDirs: [],
  });
  assert.ok(
    errors.some((e) => /synthetic-skill-7.*unknown skillKind "telekinesis"/.test(e)),
    "the unknown-kind error is found among 100 entries",
  );
  assert.ok(
    errors.some((e) => /synthetic-skill-42.*does not resolve to a known compose function/.test(e)),
    "the unresolvable-compose error is found among 100 entries",
  );
});
