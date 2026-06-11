// CC-36 engine gate — runSkill rejects a skill whose requiredTools are not all in the
// deployment's tool inventory, BEFORE any side effect runs; with no inventory supplied the run
// is unchanged (backward compatible). Fixture setup mirrors run-skill.test.js (a temp clients
// dir so client data stays out of the engine repo — clean-room).
//
// Sources: concept + first principles, zero files from any third-party skills-factory codebase
// (clean-room).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { runSkill } from "../../src/engine/run.js";

const REPO_CLIENTS_DIR = fileURLToPath(new URL("../../clients", import.meta.url));
const FIXTURE_TOKENS = fileURLToPath(new URL("../fixtures/dtcg-example-studio.tokens.json", import.meta.url));
const REGISTRY = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../skillforge.registry.json", import.meta.url)), "utf8"),
);

// create-component declares requiredTools ["Read", "Edit", "Write"]; the org baseline authorizes Write.
const POLICY_LAYERS = { org: [{ pattern: "Write", decision: "allow" }] };

let CLIENTS_DIR;
let TMP_ROOT;

before(() => {
  TMP_ROOT = mkdtempSync(join(tmpdir(), "sf-toolinv-"));
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
    variants: [{ prop: "size", value: "s", class: "hbtn--sm" }],
    decorations: [],
    sourceClasses: ["hbtn", "hbtn--sm"],
  };
}

function runArgs(extra) {
  return {
    clientsDir: CLIENTS_DIR,
    client: "example-studio",
    skillName: "create-component",
    request: buttonRequest(),
    registry: REGISTRY,
    policyLayers: POLICY_LAYERS,
    ...extra,
  };
}

test("toolInventory excludes a required tool → throws with .gate === 'tool-inventory'", async () => {
  // create-component needs Write; a Write-less inventory must be rejected at the CC-36 gate.
  await assert.rejects(
    () => runSkill(runArgs({ toolInventory: ["Read", "Edit"] })),
    (err) => {
      assert.equal(err.gate, "tool-inventory");
      assert.match(err.message, /requires tools the deployment does not expose/);
      assert.match(err.message, /Write/);
      return true;
    },
  );
});

test("no toolInventory arg → succeeds (backward compatible, gate not engaged)", async () => {
  const out = await runSkill(runArgs());
  assert.equal(out.activation.skill, "create-component");
  assert.equal(out.artifact.filename, "Button.tsx");
});

test("toolInventory covering all requiredTools → succeeds", async () => {
  const out = await runSkill(runArgs({ toolInventory: ["Read", "Edit", "Write", "Bash"] }));
  assert.equal(out.activation.skill, "create-component");
  assert.equal(out.artifact.filename, "Button.tsx");
});

test("a wildcard toolInventory ('*') covers every requiredTool → succeeds", async () => {
  const out = await runSkill(runArgs({ toolInventory: ["*"] }));
  assert.equal(out.activation.skill, "create-component");
});

test("the CC-36 gate fires before activation/side effects → multiple missing tools all reported", async () => {
  await assert.rejects(
    () => runSkill(runArgs({ toolInventory: ["Read"] })),
    (err) => {
      assert.equal(err.gate, "tool-inventory");
      assert.match(err.message, /Edit/);
      assert.match(err.message, /Write/);
      return true;
    },
  );
});
