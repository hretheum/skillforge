// validateRequiredToolsInventory — the startup-time check that every tool a skill DECLARES in
// requiredTools is one the deployment actually exposes (CC-36, docs/13 §"requiredTools").
//
// Sources: concept + first principles, zero files from any third-party skills-factory codebase
// (clean-room). The per-call PreToolUse gate denies tools a skill never declared; this is the
// reverse direction — a declared tool the surface lacks — checked once, deployment-wide.

import { test } from "node:test";
import assert from "node:assert/strict";

import { validateRequiredToolsInventory } from "../../src/governance/index.js";

test("empty toolInventory → valid (no inventory declared = no constraint)", () => {
  assert.deepEqual(validateRequiredToolsInventory(["Read", "Write"], []), { valid: true, missing: [] });
});

test("undefined toolInventory → valid (no constraint)", () => {
  assert.deepEqual(validateRequiredToolsInventory(["Bash"], undefined), { valid: true, missing: [] });
});

test("all required tools present → valid", () => {
  assert.deepEqual(
    validateRequiredToolsInventory(["Read", "Edit", "Write"], ["Read", "Edit", "Write", "Bash"]),
    { valid: true, missing: [] },
  );
});

test("one tool missing → invalid, names the missing tool", () => {
  assert.deepEqual(
    validateRequiredToolsInventory(["Read", "Bash"], ["Read", "Edit", "Write"]),
    { valid: false, missing: ["Bash"] },
  );
});

test("multiple tools missing → all captured in order", () => {
  assert.deepEqual(
    validateRequiredToolsInventory(["Read", "Bash", "WebFetch"], ["Read", "Edit"]),
    { valid: false, missing: ["Bash", "WebFetch"] },
  );
});

test("pattern matching: an mcp__* inventory entry covers a concrete mcp__figma__foo requirement", () => {
  assert.deepEqual(
    validateRequiredToolsInventory(["mcp__figma__foo"], ["Read", "mcp__*"]),
    { valid: true, missing: [] },
  );
});

test("pattern matching: a prefix-* inventory entry covers a literal under that prefix", () => {
  assert.deepEqual(
    validateRequiredToolsInventory(["WebSearch", "WebFetch"], ["Web*"]),
    { valid: true, missing: [] },
  );
});

test("no false positives: a present tool is never reported missing", () => {
  const { missing } = validateRequiredToolsInventory(["Read", "Write"], ["Read", "Write", "Edit"]);
  assert.ok(!missing.includes("Read"));
  assert.ok(!missing.includes("Write"));
});

test("empty requiredTools against a real inventory → valid (skill declares nothing)", () => {
  assert.deepEqual(validateRequiredToolsInventory([], ["Read", "Write"]), { valid: true, missing: [] });
});

test("a wildcard inventory ('*') covers every required tool", () => {
  assert.deepEqual(
    validateRequiredToolsInventory(["Read", "Bash", "mcp__figma__x"], ["*"]),
    { valid: true, missing: [] },
  );
});
