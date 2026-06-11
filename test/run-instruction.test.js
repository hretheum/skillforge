// runInstruction — end-to-end test for the instruction-skill family.
//
// Verifies that the three competitive-analysis instruction skills activate, compose their
// SKILL.md instructions, and inject the client's competitive-context — all without adapters
// or a PreToolUse gate (instruction skills produce a prompt, not a file artifact).
//
// Pattern mirrors run-end-to-end.test.js: a temp clients dir so real client resources stay
// out of the engine repo (clean-room); the competitive-context.json is the real fixture.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, cpSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { runSkill } from "../src/engine/run.js";
import { SKILL_RESULT, SKILL_RESULT_EVENT } from "../src/governance/skill-result.js";

const REPO_CLIENTS_DIR = fileURLToPath(new URL("../clients", import.meta.url));
const REGISTRY = JSON.parse(
  readFileSync(fileURLToPath(new URL("../skillforge.registry.json", import.meta.url)), "utf8"),
);

// ECC skills were migrated to @skillforge-core/ecc-bundle and removed from the local
// registry. Integration tests that exercise those instruction-skill code paths supply a minimal
// inline fixture registry so the tests remain independent of where the skills are deployed.
const ECC_SKILL_ENTRY_BASE = {
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
      ...ECC_SKILL_ENTRY_BASE,
      compose: "competitive-platform-analysis/compose.js#composeInstruction",
      requiredTools: ["Read", "WebSearch", "WebFetch"],
    },
    "benchmark-methodology": {
      ...ECC_SKILL_ENTRY_BASE,
      compose: "benchmark-methodology/compose.js#composeInstruction",
      requiredTools: ["Read", "WebSearch", "WebFetch"],
    },
    "competitive-report-structure": {
      ...ECC_SKILL_ENTRY_BASE,
      compose: "competitive-report-structure/compose.js#composeInstruction",
      requiredTools: ["Read", "Write"],
      effort: "medium",
    },
    "brand-discovery": {
      ...ECC_SKILL_ENTRY_BASE,
      compose: "brand-discovery/compose.js#composeInstruction",
      requiredTools: ["Read", "Write"],
    },
  },
};

let CLIENTS_DIR;
let TMP_ROOT;

before(() => {
  TMP_ROOT = mkdtempSync(join(tmpdir(), "sf-instr-"));
  CLIENTS_DIR = join(TMP_ROOT, "clients");
  cpSync(join(REPO_CLIENTS_DIR, "example-studio"), join(CLIENTS_DIR, "example-studio"), { recursive: true });
  // Reset brand-state to null-sentinel so a live in-progress session doesn't flip the test
  // into resume mode. The fixture must always start clean regardless of real client state.
  writeFileSync(
    join(CLIENTS_DIR, "example-studio", "resources", "brand-state.json"),
    JSON.stringify(
      { session: null, vaultPath: null, statePath: null, completedModules: [], inProgressModule: null, nextModule: null, participants: [], lastUpdated: null },
      null,
      2,
    ),
  );
});

after(() => {
  if (TMP_ROOT) rmSync(TMP_ROOT, { recursive: true, force: true });
});

const INSTRUCTION_SKILLS = [
  "competitive-platform-analysis",
  "benchmark-methodology",
  "competitive-report-structure",
];

for (const skillName of INSTRUCTION_SKILLS) {
  test(`runInstruction: ${skillName} activates and composes for example-studio`, async () => {
    const result = await runSkill({
      clientsDir: CLIENTS_DIR,
      client: "example-studio",
      skillName,
      registry: ECC_REGISTRY,
    });

    // instructions: non-empty string containing the SKILL.md content
    assert.equal(typeof result.instructions, "string");
    assert.ok(result.instructions.length > 0, "instructions must be non-empty");
    assert.ok(
      result.instructions.includes("---"),
      "instructions should contain SKILL.md frontmatter",
    );

    // context: parsed competitive-context.json with expected shape
    assert.ok(result.context && typeof result.context === "object", "context must be an object");
    assert.ok(result.context.identity?.name, "context.identity.name must be present");
    assert.ok(Array.isArray(result.context.offer), "context.offer must be an array");
    assert.ok(result.context.strategicTension?.name, "context.strategicTension.name must be present");
    assert.ok(result.context.brandBalance, "context.brandBalance must be present");

    // activation record returned
    assert.equal(result.activation.skill, skillName);
    assert.equal(result.activation.client, "example-studio");
  });
}

test("runInstruction: emits a generation-grain skill_result PASS (OBS-04 seam, Phase B)", async () => {
  // Phase B routes runInstruction through runSkill → the executor, so instruction skills now emit
  // the same per-run skill_result event the artifact family does (governance:none, but the
  // generation-grain outcome is still recorded). A clean instruction run is exactly one PASS.
  const events = [];
  const result = await runSkill({
    clientsDir: CLIENTS_DIR,
    client: "example-studio",
    skillName: "competitive-platform-analysis",
    registry: ECC_REGISTRY,
    skillResultSink: (e) => events.push(e),
  });
  assert.ok(result.instructions.length > 0, "the instruction run produced its prompt");
  assert.equal(events.length, 1, "exactly one skill_result event per instruction run");
  assert.equal(events[0].event, SKILL_RESULT_EVENT);
  assert.equal(events[0].outcome, SKILL_RESULT.PASS);
  assert.equal(events[0].skill, "competitive-platform-analysis");
  assert.equal(events[0].client, "example-studio");
  assert.equal(events[0].failure, null);
});

test("composeInstruction: fresh-start interview mode when no competitive context is resolved", async () => {
  const { composeInstruction } = await import(
    "../src/skills/competitive-platform-analysis/compose.js"
  );

  // "# Brand Discovery interview" is the INTERVIEW.md heading — present only when appended.
  const INTERVIEW_MARKER = "# Brand Discovery interview";

  // Reference absent entirely.
  const noRef = composeInstruction({ references: {} });
  assert.equal(noRef.context, null, "context is null in interview mode");
  assert.ok(noRef.instructions.includes(INTERVIEW_MARKER), "interview section appended");
  assert.ok(noRef.instructions.includes("AskUserQuestion"), "interview names the asking tool");

  // Reference present but unresolved (data:null) — same fresh-start branch.
  const nullData = composeInstruction({
    references: { competitiveContext: { ref: "x", resolvedPath: null, local: true, data: null } },
  });
  assert.equal(nullData.context, null);
  assert.ok(nullData.instructions.includes(INTERVIEW_MARKER));
});

test("composeInstruction: existing context passes through unchanged (backward compat)", async () => {
  const { composeInstruction } = await import(
    "../src/skills/competitive-platform-analysis/compose.js"
  );
  const data = { identity: { name: "Acme" }, offer: ["x"] };
  const out = composeInstruction({
    references: { competitiveContext: { ref: "c", resolvedPath: "/c.json", local: true, data } },
  });
  assert.equal(out.context, data, "context is the resolved reference data");
  assert.ok(
    !out.instructions.includes("# Brand Discovery interview"),
    "no interview appended when context present",
  );
});

test("runInstruction: brand-discovery activates in fresh-start mode (null sentinel)", async () => {
  // Integration path: runSkill → loader (resolves brandState sentinel) → compose → BOOTSTRAP appended.
  const result = await runSkill({
    clientsDir: CLIENTS_DIR,
    client: "example-studio",
    skillName: "brand-discovery",
    registry: ECC_REGISTRY,
  });

  assert.equal(typeof result.instructions, "string");
  assert.ok(result.instructions.length > 0, "instructions must be non-empty");
  assert.ok(
    result.instructions.includes("# Brand Discovery — First Session Setup"),
    "BOOTSTRAP appended in fresh-start mode",
  );
  assert.ok(
    result.instructions.includes("AskUserQuestion"),
    "BOOTSTRAP references AskUserQuestion",
  );
  // context carries statePath (not full state) in fresh-start
  assert.ok(
    result.context !== null && typeof result.context === "object",
    "context is an object even in fresh-start mode",
  );
  assert.ok("statePath" in result.context, "context exposes statePath for BOOTSTRAP");

  assert.equal(result.activation.skill, "brand-discovery");
  assert.equal(result.activation.client, "example-studio");
});

test("composeInstruction (brand-discovery): fresh-start mode when state.session is null", async () => {
  const { composeInstruction } = await import(
    "../src/skills/brand-discovery/compose.js"
  );

  const BOOTSTRAP_MARKER = "# Brand Discovery — First Session Setup";

  // Null sentinel state (uninitialized brand-state.json).
  const sentinel = composeInstruction({
    references: {
      brandState: {
        ref: "./resources/brand-state.json",
        resolvedPath: "/tmp/brand-state.json",
        local: true,
        data: { session: null, vaultPath: null, completedModules: [] },
      },
    },
  });
  assert.ok(sentinel.instructions.includes(BOOTSTRAP_MARKER), "BOOTSTRAP appended for null session");
  assert.ok(sentinel.context?.statePath === "/tmp/brand-state.json", "statePath forwarded in context");
  assert.ok(sentinel.instructions.includes("AskUserQuestion"), "BOOTSTRAP references AskUserQuestion");

  // Reference entirely absent.
  const noRef = composeInstruction({ references: {} });
  assert.ok(noRef.instructions.includes(BOOTSTRAP_MARKER), "BOOTSTRAP appended when ref absent");
  assert.equal(noRef.context?.statePath, null, "statePath is null when ref absent");
});

test("composeInstruction (brand-discovery): resume mode when state.session is set", async () => {
  const { composeInstruction } = await import(
    "../src/skills/brand-discovery/compose.js"
  );

  const BOOTSTRAP_MARKER = "# Brand Discovery — First Session Setup";
  const activeState = {
    session: "acme-brand-2026-06",
    vaultPath: "/vault/brand-identity",
    statePath: "/clients/acme/resources/brand-state.json",
    completedModules: ["10_purpose-why.md"],
    inProgressModule: "20_positioning.md",
    nextModule: "30_audience-niche.md",
    participants: ["founder-A"],
    lastUpdated: "2026-06-10T00:00:00Z",
  };

  const out = composeInstruction({
    references: {
      brandState: {
        ref: "./resources/brand-state.json",
        resolvedPath: "/clients/acme/resources/brand-state.json",
        local: true,
        data: activeState,
      },
    },
    request: { participant: "founder-A", phase: "discovery" },
  });

  assert.ok(!out.instructions.includes(BOOTSTRAP_MARKER), "BOOTSTRAP not appended in resume mode");
  assert.equal(out.context.state, activeState, "context.state is the resolved state data");
  assert.equal(out.context.participant, "founder-A", "participant forwarded from request");
  assert.equal(out.context.phase, "discovery", "phase forwarded from request");
});

test("runInstruction: throws for an unregistered instruction skill", async () => {
  await assert.rejects(
    () =>
      runSkill({
        clientsDir: CLIENTS_DIR,
        client: "example-studio",
        skillName: "no-such-skill",
        registry: REGISTRY,
      }),
    { message: /no-such-skill/ },
  );
});

test("runInstruction: throws when client has not adopted the skill", async () => {
  // Build a minimal registry with the skill enabled but example-studio not adopting it.
  const strippedRegistry = {
    schemaVersion: "1",
    skills: {
      "competitive-platform-analysis": ECC_REGISTRY.skills["competitive-platform-analysis"],
    },
  };
  // Use a temp clients dir where example-studio config has no competitive skills.
  const tmpClients = mkdtempSync(join(tmpdir(), "sf-no-skill-"));
  try {
    cpSync(join(REPO_CLIENTS_DIR, "example-studio"), join(tmpClients, "example-studio"), { recursive: true });
    // Overwrite config to remove competitive skills from skills array.
    const configPath = join(tmpClients, "example-studio", "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.skills = ["create-component"]; // competitive skills stripped
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    await assert.rejects(
      () =>
        runSkill({
          clientsDir: tmpClients,
          client: "example-studio",
          skillName: "competitive-platform-analysis",
          registry: strippedRegistry,
        }),
      /has not adopted skill/,
    );
  } finally {
    rmSync(tmpClients, { recursive: true, force: true });
  }
});
