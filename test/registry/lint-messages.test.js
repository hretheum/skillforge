// Registry-lint message hardening — two governance-pass error messages were sharpened so they (a)
// NAME the problematic skill, (b) state what IS expected (not just "missing"/"invalid"), and (c)
// reference the rule name. This test pins those properties so the messages cannot silently regress
// to the generic form.
//
//   - LINT-TOOL-ALLOWLIST  — a requiredTool outside the org allow-list.
//   - LINT-SECRET-REF-SHAPE — a requiredSecrets entry that is not a reference string.
//
// Sources: concept + first principles, zero third-party skills-factory files (clean-room).

import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePolicy } from "../../tools/registry-lint.js";
import { defaultAdapterRegistry } from "../../src/loader/adapter-registry.js";

const ALLOWLIST = { allowed: ["Read", "Write", "Edit"] };

function baseEntry(overrides = {}) {
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
    ...overrides,
  };
}

test("LINT-TOOL-ALLOWLIST: the message names the skill, the tool, the rule, and the expectation", () => {
  const registry = {
    schemaVersion: "1",
    skills: { "rogue-tool-skill": baseEntry({ requiredTools: ["Bash"] }) },
  };
  const errors = validatePolicy({
    registry,
    allowlist: ALLOWLIST,
    adapterRegistry: defaultAdapterRegistry(),
  });
  const msg = errors.find((e) => e.includes("rogue-tool-skill") && e.includes("Bash"));
  assert.ok(msg, `an allowlist violation is reported — got: ${JSON.stringify(errors)}`);
  assert.match(msg, /LINT-TOOL-ALLOWLIST/, "references the rule name");
  assert.match(msg, /rogue-tool-skill/, "names the problematic skill");
  assert.match(msg, /Bash/, "names the offending tool");
  // States what IS expected: subsumption by one of the allowed patterns, listing them.
  assert.match(msg, /expected ⊑ one of:/, "states the expectation");
  assert.match(msg, /Read, Write, Edit/, "lists the allowed patterns");
});

test("LINT-SECRET-REF-SHAPE: the message names the skill, the rule, and the expected shape", () => {
  const registry = {
    schemaVersion: "1",
    // A non-string requiredSecrets entry (a number) — the shape violation.
    skills: { "bad-secret-skill": baseEntry({ requiredSecrets: [42] }) },
  };
  const errors = validatePolicy({
    registry,
    allowlist: ALLOWLIST,
    adapterRegistry: defaultAdapterRegistry(),
  });
  const msg = errors.find((e) => e.includes("bad-secret-skill"));
  assert.ok(msg, `a secret-ref shape violation is reported — got: ${JSON.stringify(errors)}`);
  assert.match(msg, /LINT-SECRET-REF-SHAPE/, "references the rule name");
  assert.match(msg, /bad-secret-skill/, "names the problematic skill");
  // States what IS expected: a secret-reference string (a name the deployment resolves).
  assert.match(msg, /secret-reference string/, "states the expected shape");
  assert.match(msg, /never an inline value/, "states the reference-not-value discipline");
});

test("a clean skill produces neither hardened message (no false positives)", () => {
  const registry = {
    schemaVersion: "1",
    skills: { "clean-skill": baseEntry({ requiredTools: ["Read"], requiredSecrets: ["a/b/c"] }) },
  };
  const errors = validatePolicy({
    registry,
    allowlist: ALLOWLIST,
    adapterRegistry: defaultAdapterRegistry(),
  });
  assert.ok(!errors.some((e) => e.includes("LINT-TOOL-ALLOWLIST")), "no allowlist false positive");
  assert.ok(!errors.some((e) => e.includes("LINT-SECRET-REF-SHAPE")), "no secret-shape false positive");
});
