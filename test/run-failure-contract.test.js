// The runtime-failure contract at the RUN path (T-P2-05 / API-01).
//
// Sources: concept + first principles, zero third-party skills-factory files (clean-room).
// docs/04 §"Adapter runtime-failure contract" + docs/06 "never start with half its context".
// Asserts the run ABORTS — with a typed, FATAL AdapterFailure, before any artifact — when the
// input read is degraded (malformed source) or empty. This is the run-path mirror of the unit
// tests in test/adapter-failure.test.js: the contract is wired into runSkill(), not just available.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { runSkill } from "../src/engine/run.js";
import { isAdapterFailure, FAILURE_CLASS } from "../src/adapters/failure.js";

const REPO_CLIENTS_DIR = fileURLToPath(new URL("../clients", import.meta.url));
const REGISTRY = JSON.parse(
  readFileSync(fileURLToPath(new URL("../skillforge.registry.json", import.meta.url)), "utf8"),
);
const POLICY_LAYERS = { org: [{ pattern: "Write", decision: "allow" }] };

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

// Build a temp clients dir whose BC tokenHub target we control — so we can point it at a
// malformed or empty token file and exercise the run path's degraded-read behavior on real data
// flow (loader → input adapter → contract), without writing client values into the engine tree.
let CLIENTS_DIR;
let TMP_ROOT;
let HUB_PATH;

before(() => {
  TMP_ROOT = mkdtempSync(join(tmpdir(), "sf-fail-"));
  CLIENTS_DIR = join(TMP_ROOT, "clients");
  const bcDir = join(CLIENTS_DIR, "example-studio");
  cpSync(join(REPO_CLIENTS_DIR, "example-studio"), bcDir, { recursive: true });
  mkdirSync(join(bcDir, "resources"), { recursive: true });
  HUB_PATH = join(bcDir, "resources", "example-studio.tokens.json");
});

after(() => {
  if (TMP_ROOT) rmSync(TMP_ROOT, { recursive: true, force: true });
});

test("a MALFORMED source aborts the run with a typed FATAL permanent failure (no artifact)", async () => {
  writeFileSync(HUB_PATH, "{ this is not valid json");
  let thrown;
  try {
    await runSkill({ clientsDir: CLIENTS_DIR, client: "example-studio", skillName: "create-component", request: buttonRequest(), registry: REGISTRY, policyLayers: POLICY_LAYERS });
  } catch (e) {
    thrown = e;
  }
  assert.ok(thrown, "the run must throw on a malformed source (not return a partial artifact)");
  assert.ok(isAdapterFailure(thrown), "the failure is the typed contract failure, not a raw error");
  assert.equal(thrown.fatal, true);
  assert.equal(thrown.failureClass, FAILURE_CLASS.PERMANENT);
  assert.equal(thrown.edge, "input");
});

test("an EMPTY source is refused — no empty-context assembly (typed fatal failure)", async () => {
  // A syntactically valid DTCG document with no tokens/roles → an empty normalized description.
  writeFileSync(HUB_PATH, JSON.stringify({ $description: "intentionally empty" }));
  let thrown;
  try {
    await runSkill({ clientsDir: CLIENTS_DIR, client: "example-studio", skillName: "create-component", request: buttonRequest(), registry: REGISTRY, policyLayers: POLICY_LAYERS });
  } catch (e) {
    thrown = e;
  }
  assert.ok(thrown, "the run must refuse an empty-context assembly");
  assert.ok(isAdapterFailure(thrown));
  assert.equal(thrown.fatal, true);
  assert.match(thrown.message, /empty/);
});

test("the failure is secret-free and reports the edge (data, not an opaque crash)", async () => {
  writeFileSync(HUB_PATH, "}{ broken");
  let thrown;
  try {
    await runSkill({ clientsDir: CLIENTS_DIR, client: "example-studio", skillName: "create-component", request: buttonRequest(), registry: REGISTRY, policyLayers: POLICY_LAYERS });
  } catch (e) {
    thrown = e;
  }
  const data = thrown.toData();
  assert.equal(data.edge, "input");
  assert.equal(data.fatal, true);
  // No raw source content and no credential-shaped token leaked into the surfaced reason.
  assert.doesNotMatch(data.reason, /broken/);
  assert.doesNotMatch(data.reason, /[A-Za-z0-9]{32,}/);
});
