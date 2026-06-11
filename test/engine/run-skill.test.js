// runSkill — the public orchestrator over the GenericExecutor.
//
// Sources: concept + first principles, zero files from any third-party skills-factory codebase (clean-room).
//
// Proves the ONE descriptor-driven entry point is behavior-equivalent to the two existing
// top-level paths it will (in Phase B) replace: the artifact family produces the SAME golden
// React artifact as run(), and the instruction family produces the SAME instructions+context as
// runInstruction(). Plus the dispatch error paths (unregistered skill, unknown kind) and the
// best-effort telemetry emitter. Fixture setup mirrors run-end-to-end.test.js / run-instruction.test.js
// (a temp clients dir so client data stays out of the engine repo — clean-room).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { runSkill, defaultEmitTelemetry } from "../../src/engine/run.js";
import { HOOK_DECISION } from "../../src/governance/index.js";

const REPO_CLIENTS_DIR = fileURLToPath(new URL("../../clients", import.meta.url));
const FIXTURE_TOKENS = fileURLToPath(new URL("../fixtures/dtcg-example-studio.tokens.json", import.meta.url));
const REGISTRY = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../skillforge.registry.json", import.meta.url)), "utf8"),
);

// ECC instruction skills migrated to @skillforge-core/ecc-bundle — removed from the
// local registry but compose.js stays in src/skills/. Integration tests that exercise those
// paths supply an inline fixture registry entry so tests stay independent of the registry file.
const ECC_INSTRUCTION_BASE = {
  version: "0.1.0",
  enabled: true,
  owner: "platform",
  skillKind: "instruction",
  requiredAdapters: { input: [], output: [] },
  requiredSecrets: [],
  scope: { clients: ["*"], projects: ["*"] },
  model: "inherit",
  effort: "high",
};
const ECC_REGISTRY = {
  schemaVersion: "1",
  skills: {
    "competitive-platform-analysis": {
      ...ECC_INSTRUCTION_BASE,
      compose: "competitive-platform-analysis/compose.js#composeInstruction",
      requiredTools: ["Read", "WebSearch", "WebFetch"],
    },
    "benchmark-methodology": {
      ...ECC_INSTRUCTION_BASE,
      compose: "benchmark-methodology/compose.js#composeInstruction",
      requiredTools: ["Read", "WebSearch", "WebFetch"],
    },
    "competitive-report-structure": {
      ...ECC_INSTRUCTION_BASE,
      compose: "competitive-report-structure/compose.js#composeInstruction",
      requiredTools: ["Read", "Write"],
      effort: "medium",
    },
  },
};
const GOLDEN_ARTIFACT = readFileSync(
  fileURLToPath(new URL("../fixtures/react-golden-Button.tsx", import.meta.url)),
  "utf8",
);

// The org baseline authorizes the engine to WRITE component artifacts (docs/13 Layer 1).
const POLICY_LAYERS = { org: [{ pattern: "Write", decision: "allow" }] };

let CLIENTS_DIR;
let TMP_ROOT;

before(() => {
  TMP_ROOT = mkdtempSync(join(tmpdir(), "sf-runskill-"));
  CLIENTS_DIR = join(TMP_ROOT, "clients");
  const bcDir = join(CLIENTS_DIR, "example-studio");
  cpSync(join(REPO_CLIENTS_DIR, "example-studio"), bcDir, { recursive: true });
  mkdirSync(join(bcDir, "resources"), { recursive: true });
  writeFileSync(join(bcDir, "resources", "example-studio.tokens.json"), readFileSync(FIXTURE_TOKENS, "utf8"));
});

after(() => {
  if (TMP_ROOT) rmSync(TMP_ROOT, { recursive: true, force: true });
});

function buttonRequest() {
  return {
    componentName: "Button",
    element: "button",
    baseClass: "hbtn",
    variants: [
      { prop: "size", value: "s", class: "hbtn--sm" },
      { prop: "variant", value: "acc", class: "hbtn--acc", role: "color.semantic.accent" },
    ],
    decorations: [{ element: "span", class: "sq", ariaHidden: true }],
    sourceClasses: ["hbtn", "hbtn--acc", "hbtn--sm", "sq"],
  };
}

// --- artifact family: behavior-equivalent to run() ---------------------------------------

test("runSkill (artifact): BC create-component produces the golden React artifact through activation + gate", async () => {
  const out = await runSkill({
    clientsDir: CLIENTS_DIR,
    client: "example-studio",
    skillName: "create-component",
    request: buttonRequest(),
    registry: REGISTRY,
    policyLayers: POLICY_LAYERS,
  });

  // The artifact envelope (artifactDescriptor.envelope) — byte-identical to the golden.
  assert.equal(out.artifact.filename, "Button.tsx");
  assert.equal(out.artifact.source, GOLDEN_ARTIFACT, "runSkill artifact drifted from the golden React wrapper");
  assert.deepEqual(out.artifact.sourceClasses, ["hbtn", "hbtn--acc", "hbtn--sm", "sq"]);

  // Passed activation + the tool gate.
  assert.equal(out.activation.skill, "create-component");
  assert.equal(out.activation.client, "example-studio");
  assert.notEqual(out.gate.decision, HOOK_DECISION.DENY);

  // The normalized result is tagged frontend-component; the DS was actually read.
  assert.equal(out.result.envelope.kind, "frontend-component");
  assert.equal(out.description.envelope.kind, "design-system");

  // The stability-tiers seam is present.
  assert.deepEqual(out.promptTiers.tier1, { engine: "skillforge", skill: "create-component" });
  assert.equal(out.promptTiers.tier2, out.description);
});

test("runSkill (artifact): a denied gate aborts the run (deny-first, no artifact)", async () => {
  await assert.rejects(
    () =>
      runSkill({
        clientsDir: CLIENTS_DIR,
        client: "example-studio",
        skillName: "create-component",
        request: buttonRequest(),
        registry: REGISTRY,
        policyLayers: { project: [{ pattern: "Write", decision: "deny" }] }, // deny-first wins over the config org-baseline allow
      }),
    /denied at the PreToolUse gate/,
  );
});

// --- instruction family: behavior-equivalent to runInstruction() -------------------------

const INSTRUCTION_SKILLS = [
  "competitive-platform-analysis",
  "benchmark-methodology",
  "competitive-report-structure",
];

for (const skillName of INSTRUCTION_SKILLS) {
  test(`runSkill (instruction): ${skillName} activates + composes for example-studio (no adapter/gate)`, async () => {
    const out = await runSkill({
      clientsDir: CLIENTS_DIR,
      client: "example-studio",
      skillName,
      registry: ECC_REGISTRY,
    });

    // The instruction envelope (instructionDescriptor.envelope).
    assert.equal(typeof out.instructions, "string");
    assert.ok(out.instructions.length > 0, "instructions must be non-empty");
    assert.ok(out.instructions.includes("---"), "instructions should carry SKILL.md frontmatter");
    assert.ok(out.context && typeof out.context === "object");
    assert.ok(out.context.identity?.name, "context.identity.name present");
    assert.equal(out.activation.skill, skillName);
    assert.equal(out.activation.client, "example-studio");

    // No artifact/result/gate keys on the instruction envelope (it produced a prompt).
    assert.equal(out.artifact, undefined);
    assert.equal(out.gate, undefined);
  });
}

// --- dispatch error paths ----------------------------------------------------------------

test("runSkill: throws on an unregistered skill (no registry entry)", async () => {
  await assert.rejects(
    () =>
      runSkill({
        clientsDir: CLIENTS_DIR,
        client: "example-studio",
        skillName: "no-such-skill",
        request: buttonRequest(),
        registry: REGISTRY,
      }),
    /no registry entry/,
  );
});

test("runSkill: throws with the known-kinds list on an unknown skillKind", async () => {
  // A registry whose entry declares a kind the catalog does not know.
  const bogusRegistry = {
    schemaVersion: "1",
    skills: { "weird-skill": { enabled: true, skillKind: "telepathy", requiredAdapters: { input: [], output: [] } } },
  };
  await assert.rejects(
    () =>
      runSkill({
        clientsDir: CLIENTS_DIR,
        client: "example-studio",
        skillName: "weird-skill",
        registry: bogusRegistry,
      }),
    /unknown skillKind "telepathy" \(known:/,
  );
});

test("runSkill: throws on a MISSING skillKind — no silent default to artifact (CC-19)", async () => {
  // CC-19: a kindless entry previously defaulted to the write-class "artifact" at runtime while
  // lint rejected it — a lint↔runtime divergence. The runtime now rejects it too, the same way lint
  // does, so a registry that bypassed lint cannot run a kindless skill as a write-class artifact.
  const kindlessRegistry = {
    schemaVersion: "1",
    skills: { "kindless-skill": { enabled: true, requiredAdapters: { input: ["dtcg-tokens"], output: ["react"] } } },
  };
  await assert.rejects(
    () =>
      runSkill({
        clientsDir: CLIENTS_DIR,
        client: "example-studio",
        skillName: "kindless-skill",
        request: buttonRequest(),
        registry: kindlessRegistry,
      }),
    /skillKind must be declared/,
  );
});

test("runSkill: throws when no compose step is registered for the skill", async () => {
  // An entry that declares the artifact kind (CC-19: kind must be explicit — no silent default)
  // but names a skill with no compose entry, so it fails at compose resolution.
  const registry = {
    schemaVersion: "1",
    skills: { "ghost-artifact": { enabled: true, skillKind: "artifact", requiredAdapters: { input: ["dtcg-tokens"], output: ["react"] } } },
  };
  await assert.rejects(
    () =>
      runSkill({
        clientsDir: CLIENTS_DIR,
        client: "example-studio",
        skillName: "ghost-artifact",
        request: buttonRequest(),
        registry,
      }),
    /no compose step registered/,
  );
});

// --- skill_result emission (generation-grain PASS/FAIL) ----------------------------------

test("runSkill: emits a PASS skill_result on a successful artifact run", async () => {
  const events = [];
  await runSkill({
    clientsDir: CLIENTS_DIR,
    client: "example-studio",
    skillName: "create-component",
    request: buttonRequest(),
    registry: REGISTRY,
    policyLayers: POLICY_LAYERS,
    skillResultSink: (e) => events.push(e),
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].outcome, "PASS");
  assert.equal(events[0].skill, "create-component");
});

test("runSkill: emits a FAIL skill_result then re-throws on a denied gate", async () => {
  const events = [];
  await assert.rejects(
    () =>
      runSkill({
        clientsDir: CLIENTS_DIR,
        client: "example-studio",
        skillName: "create-component",
        request: buttonRequest(),
        registry: REGISTRY,
        policyLayers: { project: [{ pattern: "Write", decision: "deny" }] }, // deny-first wins over the config org-baseline allow
        skillResultSink: (e) => events.push(e),
      }),
    /denied at the PreToolUse gate/,
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].outcome, "FAIL");
});

// --- defaultEmitTelemetry (best-effort, secret-free) -------------------------------------

test("defaultEmitTelemetry: no sink → no-op (does not throw)", async () => {
  assert.doesNotThrow(() => defaultEmitTelemetry(undefined, { skillName: "x", client: "c", promptTiers: null }));
});

test("defaultEmitTelemetry: a throwing sink is swallowed (best-effort)", async () => {
  const sink = () => { throw new Error("collector down"); };
  assert.doesNotThrow(() =>
    defaultEmitTelemetry(sink, {
      skillName: "create-component",
      client: "example-studio",
      promptTiers: { tier1: { engine: "skillforge", skill: "create-component" }, tier2: null, tier3: { request: {}, project: null } },
    }),
  );
});
