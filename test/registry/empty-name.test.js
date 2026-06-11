// CC-23 / — the empty-name guard (LINT-NAME-REQUIRED). A registry whose `skills` object has
// an entry keyed by the empty string "" is malformed: the name is the engine's routing key AND the
// on-disk directory (skills/<name>/SKILL.md), and "" is neither addressable nor a valid path. The
// lint must fire an EXPLICIT, clean error naming the rule and stating the name must be a non-empty
// string — not the confusing "skills//SKILL.md" inventory-drift path it produced before.
//
// Sources: concept + first principles, zero third-party skills-factory files (clean-room).

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateStructure, lintRegistry } from "../../tools/registry-lint.js";
import { defaultAdapterRegistry } from "../../src/loader/adapter-registry.js";

const ALLOWLIST = { allowed: ["Read", "Write", "Edit", "Bash", "WebFetch", "WebSearch"] };

function registryWithEmptyName() {
  return {
    schemaVersion: "1",
    skills: {
      "": {
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
      },
    },
  };
}

test("CC-23: an empty skill name fires LINT-NAME-REQUIRED with a non-empty-string message", () => {
  const errors = validateStructure({
    registry: registryWithEmptyName(),
    adapterRegistry: defaultAdapterRegistry(),
    skillDirs: [],
    globalStoreDirs: [],
  });

  assert.ok(
    errors.some((e) => e.includes("LINT-NAME-REQUIRED")),
    `the empty-name rule fires by name — got: ${JSON.stringify(errors)}`,
  );
  assert.ok(
    errors.some((e) => /skill name must be a non-empty string/.test(e)),
    "the message states the name must be a non-empty string",
  );
});

test("CC-23: the empty-name entry does NOT produce the ugly skills//SKILL.md drift cascade", () => {
  const errors = validateStructure({
    registry: registryWithEmptyName(),
    adapterRegistry: defaultAdapterRegistry(),
    skillDirs: [],
    globalStoreDirs: [],
  });

  assert.ok(
    !errors.some((e) => e.includes("skills//SKILL.md")),
    `the empty key must be skipped by inventory drift — got: ${JSON.stringify(errors)}`,
  );
});

test("CC-23: lintRegistry surfaces the empty-name error end to end", () => {
  const errors = lintRegistry({
    registry: registryWithEmptyName(),
    allowlist: ALLOWLIST,
    adapterRegistry: defaultAdapterRegistry(),
    skillDirs: [],
    globalStoreDirs: [],
  });
  assert.ok(errors.some((e) => e.includes("LINT-NAME-REQUIRED")), "fires through the composed lint");
});

test("CC-23: a non-empty name with a present SKILL.md does NOT fire the empty-name rule", () => {
  const reg = {
    schemaVersion: "1",
    skills: {
      "real-skill": {
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
      },
    },
  };
  const errors = validateStructure({
    registry: reg,
    adapterRegistry: defaultAdapterRegistry(),
    skillDirs: ["real-skill"],
    globalStoreDirs: [],
  });
  assert.ok(!errors.some((e) => e.includes("LINT-NAME-REQUIRED")), "no false positive on a real name");
});
