// Tests for the Claude-flavour emit profile (T-P4-06; docs/05 §"Open core vs the optional
// Claude flavour", docs/12 §"Claude flavour — an optional emit-adapter", docs/13 §hardened tier).
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room).
//
// THE KEY ACCEPTANCE (T-P4-06): a skill authored to the open core runs UNCHANGED on a
// non-Claude agent (portability preserved); the flavour only ADDS capability, never required.
// The centerpiece is "portability — same open-core skill, two emits": the open-core emit is
// byte-identical to the input, and the open core is recoverable byte-for-byte from the flavoured
// output.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  emit,
  emitProfileNames,
  EMIT_PROFILES,
  applyClaudeFlavour,
  stripClaudeFlavour,
  splitFrontmatter,
  topLevelKeys,
  metadataKeys,
} from "../src/emit/index.js";

// The real open-core artifact: the create-component skill exactly as authored (portable).
const SKILL_PATH = fileURLToPath(new URL("../skills/create-component/SKILL.md", import.meta.url));
const SKILL_TEXT = readFileSync(SKILL_PATH, "utf8");

// The real registry entry for that skill (the governance data the flavour projects).
const REGISTRY = JSON.parse(
  readFileSync(fileURLToPath(new URL("../skillforge.registry.json", import.meta.url)), "utf8"),
);
const ENTRY = REGISTRY.skills["create-component"];

// ---------------------------------------------------------------------------
// 1. THE PORTABILITY PROOF — same open-core skill, emitted two ways.
// ---------------------------------------------------------------------------

test("portability: open-core emit is BYTE-IDENTICAL to the authored SKILL.md (default off)", () => {
  // Default profile is open-core — no profile argument needed (opt-in flavour).
  const out = emit({ skillText: SKILL_TEXT });
  assert.equal(out.profile, EMIT_PROFILES.OPEN_CORE);
  assert.equal(out.skillMd, SKILL_TEXT, "open-core emit must not alter a single byte");
  assert.deepEqual(out.companions, [], "open-core emit produces no Claude-only companions");
});

test("portability: the same skill flavoured for Claude still yields the open core byte-for-byte", () => {
  const flavoured = emit({ skillText: SKILL_TEXT, profile: EMIT_PROFILES.CLAUDE, registryEntry: ENTRY });
  // (a) the flavour added capability (the augmented SKILL.md differs from the open core)...
  assert.notEqual(flavoured.skillMd, SKILL_TEXT, "the claude flavour must ADD something");
  // (b) ...but the open core is recoverable EXACTLY — flavour only ADDS, never replaces.
  assert.equal(
    stripClaudeFlavour(flavoured.skillMd),
    SKILL_TEXT,
    "stripping the flavour must recover the authored SKILL.md byte-for-byte",
  );
});

test("portability: every open-core frontmatter field and the whole body are untouched by the flavour", () => {
  const before = splitFrontmatter(SKILL_TEXT);
  const flavoured = emit({ skillText: SKILL_TEXT, profile: EMIT_PROFILES.CLAUDE, registryEntry: ENTRY });
  const after = splitFrontmatter(flavoured.skillMd);
  // body byte-identical
  assert.equal(after.body, before.body, "the Markdown body must be untouched");
  // every original top-level key still present, none removed/renamed
  const beforeKeys = [...topLevelKeys(before.frontmatter)].sort();
  const afterKeys = [...topLevelKeys(after.frontmatter)];
  for (const k of beforeKeys) {
    assert.ok(afterKeys.includes(k), `open-core key "${k}" must survive flavouring`);
  }
  // the original frontmatter lines all still appear verbatim in the flavoured frontmatter
  for (const line of before.frontmatter.split("\n")) {
    assert.ok(
      after.frontmatter.split("\n").includes(line),
      `open-core frontmatter line must be preserved verbatim: ${JSON.stringify(line)}`,
    );
  }
});

// ---------------------------------------------------------------------------
// 2. THE FLAVOUR ACTUALLY ADDS CAPABILITY (projected from the registry).
// ---------------------------------------------------------------------------

test("claude flavour projects model/effort from the registry when concrete", () => {
  const entry = { ...ENTRY, model: "high", effort: "high" };
  const { additions } = applyClaudeFlavour({ skillText: SKILL_TEXT, registryEntry: entry });
  assert.ok(additions.includes("model: high"), "model projected");
  assert.ok(additions.includes("effort: high"), "effort projected");
});

test('claude flavour does NOT project model when registry says "inherit"', () => {
  // The real entry has model:"inherit" → no model line (faithful to declared capability).
  const { additions } = applyClaudeFlavour({ skillText: SKILL_TEXT, registryEntry: ENTRY });
  assert.ok(!additions.some((l) => l.startsWith("model:")), 'model "inherit" must not be projected');
});

test("claude flavour projects allowed-tools file-path gating from requiredTools", () => {
  const { additions } = applyClaudeFlavour({ skillText: SKILL_TEXT, registryEntry: ENTRY });
  const line = additions.find((l) => l.startsWith("allowed-tools:"));
  assert.ok(line, "allowed-tools projected from requiredTools");
  for (const t of ENTRY.requiredTools) {
    assert.ok(line.includes(t), `requiredTool "${t}" appears in allowed-tools`);
  }
});

test("claude flavour emits a slash-command companion (explicit invocation)", () => {
  const { companions } = applyClaudeFlavour({ skillText: SKILL_TEXT, registryEntry: ENTRY });
  const cmd = companions.find((c) => c.path === "commands/create-component.md");
  assert.ok(cmd, "slash-command companion emitted");
  assert.match(cmd.content, /create-component/);
});

test("claude flavour emits managed-settings (hardened tier) projected from the registry", () => {
  const { companions } = applyClaudeFlavour({ skillText: SKILL_TEXT, registryEntry: ENTRY });
  const managed = companions.find((c) => c.path === "managed/create-component.settings.json");
  assert.ok(managed, "managed-settings companion emitted");
  const parsed = JSON.parse(managed.content);
  // enabled skill → Skill(...) allow, requiredTools pre-approved, deny empty
  assert.ok(parsed.permissions.allow.includes("Skill(create-component)"));
  for (const t of ENTRY.requiredTools) assert.ok(parsed.permissions.allow.includes(t));
  assert.deepEqual(parsed.permissions.deny, []);
});

test("claude flavour projects a Skill DENY when the registry disables the skill", () => {
  const disabled = { ...ENTRY, enabled: false };
  const { companions } = applyClaudeFlavour({ skillText: SKILL_TEXT, registryEntry: disabled });
  const managed = JSON.parse(
    companions.find((c) => c.path.startsWith("managed/")).content,
  );
  assert.ok(managed.permissions.deny.includes("Skill(create-component)"), "disabled → hard Skill deny");
  assert.ok(!managed.permissions.allow.includes("Skill(create-component)"));
});

test("claude flavour emits a runtime-context-injection descriptor only when declared", () => {
  // Not declared on the real entry → no injection companion.
  const plain = applyClaudeFlavour({ skillText: SKILL_TEXT, registryEntry: ENTRY });
  assert.ok(
    !plain.companions.some((c) => c.path.startsWith("context/")),
    "no injection when registry does not declare one",
  );
  // Declared → a descriptor that runs a command before the skill, inlining its output.
  const withInj = {
    ...ENTRY,
    contextInjection: { command: "git status --porcelain", inlineAs: "repo-state" },
  };
  const flavoured = applyClaudeFlavour({ skillText: SKILL_TEXT, registryEntry: withInj });
  const inj = flavoured.companions.find((c) => c.path === "context/create-component.inject.json");
  assert.ok(inj, "injection descriptor emitted when declared");
  const parsed = JSON.parse(inj.content);
  assert.equal(parsed.runBeforeSkill, "git status --porcelain");
  assert.equal(parsed.inlineAs, "repo-state");
});

// ---------------------------------------------------------------------------
// 3. OPT-IN / FAIL-LOUD CONTRACT.
// ---------------------------------------------------------------------------

test("emit defaults to open-core (flavour is opt-in, default off)", () => {
  const out = emit({ skillText: SKILL_TEXT });
  assert.equal(out.profile, EMIT_PROFILES.OPEN_CORE);
});

test("emit rejects an unknown profile loud and early", () => {
  assert.throws(() => emit({ skillText: SKILL_TEXT, profile: "gemini-flavour" }), /unknown emit profile/);
});

test('emit "claude" without a registryEntry fails loud (validate before acting)', () => {
  assert.throws(() => emit({ skillText: SKILL_TEXT, profile: EMIT_PROFILES.CLAUDE }), /requires a registryEntry/);
});

test("emitProfileNames includes the claude profile (stable, sorted order)", () => {
  const names = emitProfileNames();
  assert.ok(names.includes("claude"), "claude profile registered");
  assert.ok(names.includes("open-core"), "open-core profile registered");
  assert.deepEqual(names, [...names].sort(), "profile names are stably sorted");
});

test("applyClaudeFlavour rejects a malformed SKILL.md (no frontmatter) loudly", () => {
  assert.throws(
    () => applyClaudeFlavour({ skillText: "# just a body, no frontmatter\n", registryEntry: ENTRY }),
    /frontmatter/,
  );
});

// ---------------------------------------------------------------------------
// 4. THE FRONTMATTER READER — collision detection (ADD, never replace).
// ---------------------------------------------------------------------------

test("flavour does not duplicate a field the open core already declares", () => {
  // Author a skill that already sets allowed-tools; the flavour must NOT add a second one.
  const withTools = SKILL_TEXT.replace(
    /^license: .*$/m,
    "license: SEE LICENSE IN LICENSE\nallowed-tools: Read",
  );
  const { additions } = applyClaudeFlavour({ skillText: withTools, registryEntry: ENTRY });
  assert.ok(
    !additions.some((l) => l.startsWith("allowed-tools:")),
    "an open-core allowed-tools must not be overwritten by the flavour",
  );
});

test("metadataKeys detects existing skillforge.* children so the flavour does not clobber them", () => {
  const before = splitFrontmatter(SKILL_TEXT);
  const meta = metadataKeys(before.frontmatter);
  assert.ok(meta.present, "the create-component skill declares a metadata block");
  assert.ok(meta.childKeys.has("skillforge.owner"), "existing metadata child detected");
  // Flavour must not re-emit an existing child.
  const { additions } = applyClaudeFlavour({ skillText: SKILL_TEXT, registryEntry: ENTRY });
  assert.ok(
    !additions.some((l) => l.includes("skillforge.owner")),
    "an existing metadata child must not be duplicated",
  );
});
