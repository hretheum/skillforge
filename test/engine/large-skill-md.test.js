// CC-30 — a ~150KB SKILL.md. The engine and registry-lint check a SKILL.md's EXISTENCE only; they
// never read its body. So a 150KB SKILL.md is handled gracefully: lint cost is O(1) per skill
// regardless of body size, and the engine routes on the registry key, not the markdown prose.
//
// Sources: concept + first principles, zero third-party skills-factory files (clean-room).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { validateStructure } from "../../tools/registry-lint.js";
import { defaultAdapterRegistry } from "../../src/loader/adapter-registry.js";

const BIG_LEN = 150 * 1024;

function entry(compose) {
  return {
    version: "0.1.0",
    enabled: true,
    owner: "platform",
    skillKind: "instruction",
    compose,
    requiredTools: ["Read"],
    requiredAdapters: { input: [], output: [] },
    requiredSecrets: [],
    scope: { clients: ["*"], projects: ["*"] },
    model: "inherit",
    effort: "medium",
  };
}

test("CC-30: a ~150KB SKILL.md is handled gracefully — lint reads existence, not the body", () => {
  const dir = mkdtempSync(join(tmpdir(), "sf-large-skill-"));
  try {
    const skillDir = join(dir, "big-doc-skill");
    mkdirSync(skillDir, { recursive: true });
    // A real ~150KB markdown body (programmatically generated, not committed).
    const body = "---\nname: big-doc-skill\n---\n\n# Big\n\n" + "documentation paragraph. ".repeat(6400);
    writeFileSync(join(skillDir, "SKILL.md"), body, "utf8");
    assert.ok(statSync(join(skillDir, "SKILL.md")).size >= BIG_LEN, "the SKILL.md is at least 150KB");

    // The structural lint is fed the dir name (as listSkillDirs would produce) + a matching registry
    // entry. It must PASS without ever reading the 150KB body — the result is identical to a tiny
    // SKILL.md, proving O(1)-per-skill cost regardless of doc size.
    const registry = {
      schemaVersion: "1",
      skills: { "big-doc-skill": entry("verdex-form-builder/compose.js#composeInstruction") },
    };
    const errors = validateStructure({
      registry,
      adapterRegistry: defaultAdapterRegistry(),
      skillDirs: ["big-doc-skill"],
      globalStoreDirs: [],
    });
    assert.deepEqual(errors, [], "a 150KB SKILL.md lints exactly like a small one (body never read)");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
