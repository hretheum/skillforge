// Tests for registry-lint (internal-consistency gate) and its pure helpers.
//
// Sources: concept + first principles, zero third-party skills-factory files
// (clean-room). Covers doc-12 §registry-lint checks and the doc-13 subsumption
// order, plus the exported tighten-only merge predicate (T-HARD-10(b)).

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  subsumes,
  lintRegistry,
  validateOverrideTightens,
  validateStructure,
  validatePolicy,
} from "../tools/registry-lint.js";
import { defaultAdapterRegistry } from "../src/loader/adapter-registry.js";

const LINT = fileURLToPath(new URL("../tools/registry-lint.js", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

function runLint(cwd) {
  const emptyHome = mkdtempSync(join(tmpdir(), "sf-lint-e2e-"));
  const env = { ...process.env, HOME: emptyHome, USERPROFILE: emptyHome };
  try {
    const stdout = execFileSync("node", [LINT], { cwd, encoding: "utf8", env });
    return { code: 0, stdout, stderr: "" };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  } finally {
    rmSync(emptyHome, { recursive: true, force: true });
  }
}

const ALLOWLIST = { allowed: ["Read", "Edit", "Write", "mcp__tracker__*"] };

function validRegistry() {
  return {
    schemaVersion: "1",
    skills: {
      "create-component": {
        version: "0.1.0",
        enabled: true,
        owner: "platform",
        skillKind: "artifact",
        compose: "create-component/compose.js#composeComponent",
        requiredTools: ["Read", "Edit", "Write"],
        sourceKind: "design-system",
        resultKind: "frontend-component",
        requiredAdapters: { input: ["dtcg-tokens"], output: ["react"] },
        requiredSecrets: [],
        scope: { clients: ["*"], projects: ["*"] },
        model: "inherit",
        effort: "medium",
      },
    },
  };
}

function lint(registry, { skillDirs = ["create-component"], allowlist = ALLOWLIST } = {}) {
  return lintRegistry({
    registry,
    allowlist,
    adapterRegistry: defaultAdapterRegistry(),
    skillDirs,
    globalStoreDirs: [],
  });
}

// --- end-to-end against the real checked-in registry -----------------------

test("the checked-in registry passes the real gate", () => {
  const r = runLint(REPO_ROOT);
  assert.equal(r.code, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /PASS/);
});

// --- subsumption order (doc 13) --------------------------------------------

test("subsumption: literal < prefix-* < *", () => {
  assert.equal(subsumes("*", "Read"), true);
  assert.equal(subsumes("*", "mcp__tracker__*"), true);
  assert.equal(subsumes("mcp__tracker__*", "mcp__tracker__create"), true);
  assert.equal(subsumes("mcp__tracker__*", "mcp__other__x"), false);
  assert.equal(subsumes("Read", "Read"), true);
  assert.equal(subsumes("Read", "Write"), false);
  assert.equal(subsumes("mcp__tracker__create", "mcp__tracker__*"), false); // literal can't subsume a prefix
  assert.equal(subsumes("mcp__tracker__*", "*"), false); // prefix-* can't subsume *
});

// --- happy path ------------------------------------------------------------

test("a well-formed registry lints clean", () => {
  assert.deepEqual(lint(validRegistry()), []);
});

// --- schema ----------------------------------------------------------------

test("bad schemaVersion fails", () => {
  const reg = validRegistry();
  reg.schemaVersion = "2";
  assert.ok(lint(reg).some((e) => /schemaVersion/.test(e)));
});

test("non-boolean enabled fails", () => {
  const reg = validRegistry();
  reg.skills["create-component"].enabled = "yes";
  assert.ok(lint(reg).some((e) => /enabled must be a boolean/.test(e)));
});

test("malformed requiredAdapters fails", () => {
  const reg = validRegistry();
  reg.skills["create-component"].requiredAdapters = { input: ["dtcg-tokens"] };
  assert.ok(lint(reg).some((e) => /requiredAdapters/.test(e)));
});

test("missing scope fails", () => {
  const reg = validRegistry();
  delete reg.skills["create-component"].scope;
  assert.ok(lint(reg).some((e) => /scope/.test(e)));
});

// --- inventory drift -------------------------------------------------------

test("registry entry with no SKILL.md is drift", () => {
  const reg = validRegistry();
  const errs = lint(reg, { skillDirs: [] });
  assert.ok(errs.some((e) => /no skills\/create-component\/SKILL\.md/.test(e)));
});

test("SKILL.md absent from registry is drift", () => {
  const reg = validRegistry();
  const errs = lint(reg, { skillDirs: ["create-component", "orphan-skill"] });
  assert.ok(errs.some((e) => /orphan-skill.*absent from the registry/.test(e)));
});

// --- adapter existence -----------------------------------------------------

test("unknown input adapter fails", () => {
  const reg = validRegistry();
  reg.skills["create-component"].requiredAdapters.input = ["no-such-reader"];
  assert.ok(lint(reg).some((e) => /unknown input adapter "no-such-reader"/.test(e)));
});

test("unknown output adapter fails", () => {
  const reg = validRegistry();
  reg.skills["create-component"].requiredAdapters.output = ["no-such-writer"];
  assert.ok(lint(reg).some((e) => /unknown output adapter "no-such-writer"/.test(e)));
});

// --- skill↔adapter result-kind typing (T-MVP-10) ---------------------------

test("a result-kind the wired output adapter does not accept fails the gate", () => {
  const reg = validRegistry();
  reg.skills["create-component"].resultKind = "openapi-spec"; // react accepts only frontend-component
  assert.ok(lint(reg).some((e) => /result-kind "openapi-spec" is not accepted by output adapter "react"/.test(e)));
});

test("a source-kind the wired input adapter does not produce fails the gate", () => {
  const reg = validRegistry();
  reg.skills["create-component"].sourceKind = "jira-project"; // dtcg-tokens produces only design-system
  assert.ok(lint(reg).some((e) => /source-kind "jira-project" is not produced by input adapter "dtcg-tokens"/.test(e)));
});

test("a well-typed registry (kinds match wired adapters) lints clean", () => {
  assert.deepEqual(lint(validRegistry()), []);
});

test("a non-string resultKind fails schema validation", () => {
  const reg = validRegistry();
  reg.skills["create-component"].resultKind = 42;
  assert.ok(lint(reg).some((e) => /resultKind must be a string/.test(e)));
});

// --- skillKind declaration (LINT-SKILLKIND-REQUIRED) -----------------------

test("a missing skillKind fails the gate", () => {
  const reg = validRegistry();
  delete reg.skills["create-component"].skillKind;
  assert.ok(lint(reg).some((e) => /skillKind must be declared/.test(e)));
});

test("an unknown skillKind fails the gate", () => {
  const reg = validRegistry();
  reg.skills["create-component"].skillKind = "bogus-kind";
  assert.ok(lint(reg).some((e) => /unknown skillKind "bogus-kind"/.test(e)));
});

test("a non-string skillKind fails the gate", () => {
  const reg = validRegistry();
  reg.skills["create-component"].skillKind = 42;
  assert.ok(lint(reg).some((e) => /skillKind must be declared/.test(e)));
});

// --- compose ref (LINT-COMPOSE-REQUIRED) -----------------------------------

test("a missing compose ref fails the gate", () => {
  const reg = validRegistry();
  delete reg.skills["create-component"].compose;
  assert.ok(lint(reg).some((e) => /compose ref must be declared/.test(e)));
});

test("a compose ref that does not resolve fails the gate", () => {
  const reg = validRegistry();
  reg.skills["create-component"].compose = "create-component/compose.js#noSuchExport";
  assert.ok(lint(reg).some((e) => /does not resolve to a known compose function/.test(e)));
});

test("a non-string compose ref fails the gate", () => {
  const reg = validRegistry();
  reg.skills["create-component"].compose = 42;
  assert.ok(lint(reg).some((e) => /compose ref must be declared/.test(e)));
});

// --- tool allow-list -------------------------------------------------------

test("requiredTool outside the org allow-list fails", () => {
  const reg = validRegistry();
  reg.skills["create-component"].requiredTools = ["Read", "Bash"];
  assert.ok(lint(reg).some((e) => /LINT-TOOL-ALLOWLIST.*requiredTool "Bash"/.test(e)));
});

test("a prefix-* requiredTool covered by the allow-list passes", () => {
  const reg = validRegistry();
  reg.skills["create-component"].requiredTools = ["mcp__tracker__create"];
  assert.deepEqual(lint(reg), []);
});

// --- tighten-only merge shape (T-HARD-10(b)) -------------------------------

test("override enabling a disabled base broadens", () => {
  const base = { enabled: false, requiredTools: [], scope: { clients: ["acme"], projects: ["*"] } };
  const v = validateOverrideTightens(base, { enabled: true }, "push-to-tracker");
  assert.ok(v.some((e) => /enables a skill the base disabled/.test(e)));
});

test("override adding an uncovered tool broadens", () => {
  const base = { enabled: true, requiredTools: ["Read"], scope: { clients: ["*"], projects: ["*"] } };
  const v = validateOverrideTightens(base, { requiredTools: ["Read", "Write"] });
  assert.ok(v.some((e) => /broadens tool "Write"/.test(e)));
});

test("override widening a narrow scope broadens", () => {
  const base = { enabled: true, requiredTools: [], scope: { clients: ["acme"], projects: ["checkout"] } };
  const v = validateOverrideTightens(base, { scope: { projects: ["billing"] } });
  assert.ok(v.some((e) => /widens scope\.projects to "billing"/.test(e)));
});

test("override that only tightens is accepted", () => {
  const base = { enabled: true, requiredTools: ["Read", "Write"], scope: { clients: ["*"], projects: ["*"] } };
  const tighten = {
    enabled: false, // turning off is a tighten
    requiredTools: ["Read"], // dropping a tool is a tighten
    scope: { clients: ["acme"], projects: ["checkout"] }, // narrowing from * is a tighten
  };
  assert.deepEqual(validateOverrideTightens(base, tighten), []);
});

// --- T-HARD-10(b): the split passes run independently (AC2/AC3) -------------

function structure(registry, { skillDirs = ["create-component"] } = {}) {
  return validateStructure({ registry, adapterRegistry: defaultAdapterRegistry(), skillDirs, globalStoreDirs: [] });
}
function policy(registry, { allowlist = ALLOWLIST } = {}) {
  return validatePolicy({ registry, allowlist, adapterRegistry: defaultAdapterRegistry() });
}

test("split: both passes are clean on a well-formed registry", () => {
  assert.deepEqual(structure(validRegistry()), []);
  assert.deepEqual(policy(validRegistry()), []);
});

test("split: validateStructure catches a STRUCTURAL fault and validatePolicy ignores it", () => {
  // A bad schemaVersion is structural. validateStructure must flag it; validatePolicy must NOT
  // (it is not its concern) — proving the two passes run as separate, focused checks.
  const reg = validRegistry();
  reg.schemaVersion = "2";
  assert.ok(structure(reg).some((e) => /schemaVersion/.test(e)), "structure flags the schema fault");
  assert.ok(!policy(reg).some((e) => /schemaVersion/.test(e)), "policy does not report a structural fault");
});

test("split: validatePolicy catches a GOVERNANCE fault and validateStructure ignores it", () => {
  // A requiredTool outside the org allow-list is a governance fault. validatePolicy must flag it;
  // validateStructure must NOT (the entry is structurally well-formed).
  const reg = validRegistry();
  reg.skills["create-component"].requiredTools = ["Read", "Bash"]; // Bash is not in ALLOWLIST
  assert.ok(policy(reg).some((e) => /LINT-TOOL-ALLOWLIST.*requiredTool "Bash".*not subsumed/.test(e)));
  assert.ok(
    !structure(reg).some((e) => /allow-list/.test(e)),
    "structure does not report the allow-list governance fault",
  );
});

test("split: validatePolicy flags an empty org allow-list independently", () => {
  assert.ok(
    policy(validRegistry(), { allowlist: { allowed: [] } }).some((e) => /allow-list is empty or missing/.test(e)),
  );
});

test("split: lintRegistry is the union of both passes (composition holds)", () => {
  // A registry with BOTH a structural fault (bad skillKind) and a governance fault (disallowed tool)
  // surfaces both findings through the composed entry point — neither pass swallows the other's.
  const reg = validRegistry();
  reg.skills["create-component"].skillKind = "bogus-kind"; // structural
  reg.skills["create-component"].requiredTools = ["Read", "Bash"]; // governance
  const all = lint(reg);
  assert.ok(all.some((e) => /unknown skillKind "bogus-kind"/.test(e)), "structural fault present");
  assert.ok(all.some((e) => /LINT-TOOL-ALLOWLIST.*requiredTool "Bash"/.test(e)), "governance fault present");
});

test("split: a fatally-malformed registry short-circuits to the structural fatal only", () => {
  // No well-formed registry means there is nothing for the policy pass to govern — lintRegistry
  // returns the single structural fatal and does not run policy (no double-report, no crash).
  assert.deepEqual(lint(null), ["registry must be a JSON object"]);
});
