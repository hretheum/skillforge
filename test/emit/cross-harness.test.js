// Cross-harness adapter tests. The emit layer now carries MORE THAN ONE harness — the
// Claude flavour and a Codex/OpenAI flavour — over a shared adapter contract (src/emit/adapter.js).
// These tests pin: (1) the contract validates conforming adapters and rejects malformed ones;
// (2) the Claude path emits unchanged Claude surfaces (regression guard); (3) the Codex path emits
// the OpenAI function-calling format; (4) both stay additive/reversible (portability preserved).
//
// Sources: concept + first principles, zero files from any third-party skills-factory codebase
// (clean-room).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  emit,
  emitProfileNames,
  EMIT_PROFILES,
  CODEX_PROFILE,
  validateAdapter,
  ADAPTER_INTERFACE,
  ADAPTER_REQUIRED_FIELDS,
  claudeAdapter,
  codexAdapter,
  applyCodexFlavour,
  stripCodexFlavour,
  applyClaudeFlavour,
  stripClaudeFlavour,
  splitFrontmatter,
} from "../../src/emit/index.js";

// The real open-core artifact + its registry entry (the data each harness projects).
const SKILL_PATH = fileURLToPath(new URL("../../skills/create-component/SKILL.md", import.meta.url));
const SKILL_TEXT = readFileSync(SKILL_PATH, "utf8");
const REGISTRY = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../skillforge.registry.json", import.meta.url)), "utf8"),
);
const ENTRY = REGISTRY.skills["create-component"];

// ---------------------------------------------------------------------------
// 1. THE SHARED CONTRACT — validateAdapter.
// ---------------------------------------------------------------------------

test("validateAdapter accepts the Claude adapter", () => {
  const v = validateAdapter(claudeAdapter);
  assert.equal(v.valid, true, v.reason);
});

test("validateAdapter accepts the Codex adapter", () => {
  const v = validateAdapter(codexAdapter);
  assert.equal(v.valid, true, v.reason);
});

test("validateAdapter rejects a plain {} with a precise reason", () => {
  const v = validateAdapter({});
  assert.equal(v.valid, false);
  assert.match(v.reason, /missing required field "profile"/);
});

test("validateAdapter rejects non-objects loudly", () => {
  assert.equal(validateAdapter(null).valid, false);
  assert.equal(validateAdapter("not an adapter").valid, false);
  assert.equal(validateAdapter(undefined).valid, false);
});

test("validateAdapter checks field KINDS, not just presence", () => {
  const badApply = { profile: "x", apply: "not a function", strip: () => "" };
  const v = validateAdapter(badApply);
  assert.equal(v.valid, false);
  assert.match(v.reason, /field "apply" must be a function/);
});

test("validateAdapter rejects an empty profile string", () => {
  const v = validateAdapter({ profile: "", apply: () => ({}), strip: (s) => s });
  assert.equal(v.valid, false);
  assert.match(v.reason, /non-empty string/);
});

test("the documented interface lists exactly profile/apply/strip", () => {
  assert.deepEqual(ADAPTER_REQUIRED_FIELDS, ["profile", "apply", "strip"]);
  assert.equal(ADAPTER_INTERFACE.fields.length, 3);
});

// ---------------------------------------------------------------------------
// 2. BOTH HARNESSES ARE REGISTERED AND DISPATCH.
// ---------------------------------------------------------------------------

test("emitProfileNames lists open-core, claude AND codex (stable order)", () => {
  assert.deepEqual(emitProfileNames(), ["claude", "codex", "open-core"]);
});

test("the two adapters answer to distinct profile names", () => {
  assert.equal(claudeAdapter.profile, EMIT_PROFILES.CLAUDE);
  assert.equal(codexAdapter.profile, CODEX_PROFILE);
  assert.notEqual(claudeAdapter.profile, codexAdapter.profile);
});

// ---------------------------------------------------------------------------
// 3. CLAUDE PATH — REGRESSION GUARD (existing behaviour must be unaffected).
// ---------------------------------------------------------------------------

test("regression: Claude path still emits its native surfaces unchanged", () => {
  const out = emit({ skillText: SKILL_TEXT, profile: EMIT_PROFILES.CLAUDE, registryEntry: ENTRY });
  assert.equal(out.profile, EMIT_PROFILES.CLAUDE);
  // slash-command + managed-settings companions are the Claude-native artifacts.
  assert.ok(out.companions.some((c) => c.path === "commands/create-component.md"), "slash-command companion");
  assert.ok(
    out.companions.some((c) => c.path === "managed/create-component.settings.json"),
    "managed-settings companion",
  );
  // allowed-tools additive line projected from requiredTools (Claude-specific gating).
  assert.ok(out.additions.some((l) => l.startsWith("allowed-tools:")), "allowed-tools projected");
  // open core recoverable byte-for-byte.
  assert.equal(stripClaudeFlavour(out.skillMd), SKILL_TEXT);
});

test("regression: the Claude adapter's apply/strip are the original functions", () => {
  // The adapter object packages the SAME functions the named exports expose (no behavioural fork).
  assert.equal(claudeAdapter.apply, applyClaudeFlavour);
  assert.equal(claudeAdapter.strip, stripClaudeFlavour);
});

// ---------------------------------------------------------------------------
// 4. CODEX PATH — OpenAI function-calling format.
// ---------------------------------------------------------------------------

test("Codex path emits an OpenAI function-calling descriptor", () => {
  const out = emit({ skillText: SKILL_TEXT, profile: CODEX_PROFILE, registryEntry: ENTRY });
  assert.equal(out.profile, CODEX_PROFILE);
  const desc = out.companions.find((c) => c.path === "codex/create-component.function.json");
  assert.ok(desc, "function descriptor companion emitted");

  const parsed = JSON.parse(desc.content);
  // OpenAI shape: a tools array of { type:"function", function:{ name, description, parameters } }.
  assert.ok(Array.isArray(parsed.tools), "tools is an array");
  assert.equal(parsed.tools.length, 1);
  const tool = parsed.tools[0];
  assert.equal(tool.type, "function");
  assert.equal(tool.function.name, "create-component");
  assert.equal(typeof tool.function.description, "string");
  assert.ok(tool.function.description.length > 0, "description carried from the open core");
  // parameters must be a JSON Schema object.
  assert.equal(tool.function.parameters.type, "object");
  assert.ok(tool.function.parameters.properties, "parameters has a properties map");
  assert.deepEqual(tool.function.parameters.required, ["request"]);
});

test("Codex descriptor records requiredTools as advisory provenance", () => {
  const out = emit({ skillText: SKILL_TEXT, profile: CODEX_PROFILE, registryEntry: ENTRY });
  const parsed = JSON.parse(
    out.companions.find((c) => c.path.startsWith("codex/")).content,
  );
  assert.deepEqual(parsed.x_skillforge.requiredTools, ENTRY.requiredTools);
});

test("Codex flavour projects skillforge provenance frontmatter (additive)", () => {
  const { additions } = applyCodexFlavour({ skillText: SKILL_TEXT, registryEntry: ENTRY });
  assert.ok(additions.some((l) => l.includes("skillforge.emitProfile: codex")), "emitProfile projected");
});

// ---------------------------------------------------------------------------
// 5. PORTABILITY — Codex is additive and reversible (same invariant as Claude).
// ---------------------------------------------------------------------------

test("Codex flavour is reversible: strip(apply(x)) === x byte-for-byte", () => {
  const out = emit({ skillText: SKILL_TEXT, profile: CODEX_PROFILE, registryEntry: ENTRY });
  assert.notEqual(out.skillMd, SKILL_TEXT, "the codex flavour must ADD something");
  assert.equal(stripCodexFlavour(out.skillMd), SKILL_TEXT, "stripping recovers the open core exactly");
});

test("Codex flavour leaves the Markdown body untouched", () => {
  const before = splitFrontmatter(SKILL_TEXT);
  const out = emit({ skillText: SKILL_TEXT, profile: CODEX_PROFILE, registryEntry: ENTRY });
  const after = splitFrontmatter(out.skillMd);
  assert.equal(after.body, before.body, "body must be byte-identical");
});

test("Codex flavour does not clobber an existing metadata child", () => {
  // The real skill already declares metadata.skillforge.owner — the flavour must not re-emit it.
  const { additions } = applyCodexFlavour({ skillText: SKILL_TEXT, registryEntry: ENTRY });
  assert.ok(!additions.some((l) => l.includes("skillforge.owner")), "existing child not duplicated");
});

// ---------------------------------------------------------------------------
// 6. FAIL-LOUD CONTRACT shared across harnesses.
// ---------------------------------------------------------------------------

test('emit "codex" without a registryEntry fails loud', () => {
  assert.throws(() => emit({ skillText: SKILL_TEXT, profile: CODEX_PROFILE }), /requires a registryEntry/);
});

test("applyCodexFlavour rejects a malformed SKILL.md (no frontmatter) loudly", () => {
  assert.throws(
    () => applyCodexFlavour({ skillText: "# body only, no frontmatter\n", registryEntry: ENTRY }),
    /frontmatter/,
  );
});

test("Codex function descriptor: YAML block-scalar marker >- is stripped from description", () => {
  const skillWithBlockScalar = [
    "---",
    "name: block-scalar-skill",
    "description: >-",
    "  This is the actual description without the marker.",
    "---",
    "",
    "# Block Scalar Skill",
    "",
    "Body.",
  ].join("\n");
  const { companions } = applyCodexFlavour({
    skillText: skillWithBlockScalar,
    registryEntry: ENTRY,
  });
  const desc = companions.find((c) => c.path.endsWith(".function.json"));
  assert.ok(desc, "function descriptor companion must be present");
  const parsed = JSON.parse(desc.content);
  const fnDesc = parsed.tools[0].function.description;
  assert.ok(!fnDesc.startsWith(">"), `description must not start with YAML scalar marker; got: ${fnDesc}`);
  assert.match(fnDesc, /actual description/, "actual description text must be present");
});
