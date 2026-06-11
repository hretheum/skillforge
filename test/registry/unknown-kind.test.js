// CC-18 — a registry entry with an unknown skillKind ("telekinesis"). LINT-SKILLKIND-REQUIRED must
// fire at lint time with a message that LISTS the valid kinds, and the runtime must fail the same
// way (defense in depth: a registry that skipped lint still cannot mis-route an unknown kind).
//
// Sources: concept + first principles, zero third-party skills-factory files (clean-room).

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateStructure } from "../../tools/registry-lint.js";
import { defaultAdapterRegistry } from "../../src/loader/adapter-registry.js";
import { defaultSkillKinds } from "../../src/registry/skill-kinds.js";
import { runSkill } from "../../src/engine/run.js";

const KNOWN = defaultSkillKinds().kinds(); // [artifact, instruction, validation, analysis, transformation, sync]

function entry(skillKind) {
  return {
    version: "0.1.0",
    enabled: true,
    owner: "platform",
    skillKind,
    compose: "verdex-form-builder/compose.js#composeInstruction",
    requiredTools: ["Read"],
    requiredAdapters: { input: [], output: [] },
    requiredSecrets: [],
    scope: { clients: ["*"], projects: ["*"] },
    model: "inherit",
    effort: "medium",
  };
}

test("CC-18: LINT-SKILLKIND-REQUIRED fires on an unknown kind and lists the valid kinds", () => {
  const errors = validateStructure({
    registry: { schemaVersion: "1", skills: { "telekinesis-skill": entry("telekinesis") } },
    adapterRegistry: defaultAdapterRegistry(),
    skillDirs: ["telekinesis-skill"],
    globalStoreDirs: [],
  });
  const hit = errors.find((e) => /unknown skillKind "telekinesis"/.test(e));
  assert.ok(hit, "the unknown-kind error fired");
  // The message must enumerate the valid kinds so the author can correct the typo.
  for (const k of KNOWN) {
    assert.ok(hit.includes(k), `the error lists the valid kind "${k}"`);
  }
});

test("CC-18: the runtime ALSO rejects an unknown kind (defense in depth)", async () => {
  await assert.rejects(
    () =>
      runSkill({
        clientsDir: "/unused",
        client: "verdex",
        skillName: "telekinesis-skill",
        registry: { schemaVersion: "1", skills: { "telekinesis-skill": entry("telekinesis") } },
      }),
    /unknown skillKind "telekinesis"/,
    "the runtime fails loud on an unknown kind, the same way lint does",
  );
});
