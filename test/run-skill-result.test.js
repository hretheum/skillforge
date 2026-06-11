// The per-run skill_result (PASS/FAIL) emitted by runSkill() at the PostToolUse seam (T-P2-06).
//
// Sources: concept + first principles, zero third-party skills-factory files (clean-room).
// docs/10 §success-rate (OBS-04) + docs/13 §PostToolUse. Asserts runSkill() emits EXACTLY ONE
// generation-grain skill_result event per run: PASS on a clean artifact, FAIL on a fatal
// adapter failure or a denied tool gate — wired into the run, not just available as a helper.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { runSkill } from "../src/engine/run.js";
import { SKILL_RESULT, SKILL_RESULT_EVENT } from "../src/governance/skill-result.js";

const REPO_CLIENTS_DIR = fileURLToPath(new URL("../clients", import.meta.url));
const FIXTURE_TOKENS = fileURLToPath(new URL("./fixtures/dtcg-example-studio.tokens.json", import.meta.url));
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

let CLIENTS_DIR;
let TMP_ROOT;
let HUB_PATH;

before(() => {
  TMP_ROOT = mkdtempSync(join(tmpdir(), "sf-skillresult-"));
  CLIENTS_DIR = join(TMP_ROOT, "clients");
  const bcDir = join(CLIENTS_DIR, "example-studio");
  cpSync(join(REPO_CLIENTS_DIR, "example-studio"), bcDir, { recursive: true });
  mkdirSync(join(bcDir, "resources"), { recursive: true });
  HUB_PATH = join(bcDir, "resources", "example-studio.tokens.json");
});

after(() => {
  if (TMP_ROOT) rmSync(TMP_ROOT, { recursive: true, force: true });
});

/** A buffering sink so a test can assert on the emitted event(s). */
function bufferSink() {
  const events = [];
  return { sink: (e) => events.push(e), events };
}

test("a clean run emits exactly one skill_result PASS (generation grain)", async () => {
  writeFileSync(HUB_PATH, readFileSync(FIXTURE_TOKENS, "utf8")); // real tokens → clean run
  const { sink, events } = bufferSink();
  const out = await runSkill({
    clientsDir: CLIENTS_DIR,
    client: "example-studio",
    skillName: "create-component",
    request: { ...buttonRequest(), componentName: "Button", variants: [{ prop: "variant", value: "acc", class: "hbtn--acc", role: "color.semantic.accent" }], sourceClasses: ["hbtn", "hbtn--acc"] },
    registry: REGISTRY,
    policyLayers: POLICY_LAYERS,
    skillResultSink: sink,
  });
  assert.ok(out.artifact, "the run produced an artifact");
  assert.equal(events.length, 1, "exactly one skill_result event per run");
  assert.equal(events[0].event, SKILL_RESULT_EVENT);
  assert.equal(events[0].outcome, SKILL_RESULT.PASS);
  assert.equal(events[0].skill, "create-component");
  assert.equal(events[0].client, "example-studio");
  assert.equal(events[0].failure, null);
});

test("a fatal adapter failure (malformed source) emits a skill_result FAIL (and still throws)", async () => {
  writeFileSync(HUB_PATH, "{ not json");
  const { sink, events } = bufferSink();
  await assert.rejects(() =>
    runSkill({
      clientsDir: CLIENTS_DIR,
      client: "example-studio",
      skillName: "create-component",
      request: buttonRequest(),
      registry: REGISTRY,
      policyLayers: POLICY_LAYERS,
      skillResultSink: sink,
    }),
  );
  assert.equal(events.length, 1, "one FAIL event even though the run threw");
  assert.equal(events[0].outcome, SKILL_RESULT.FAIL);
  assert.equal(events[0].failure.fatal, true);
  assert.equal(events[0].failure.edge, "input");
});

test("a denied tool gate emits a skill_result FAIL at the generation grain", async () => {
  writeFileSync(HUB_PATH, readFileSync(FIXTURE_TOKENS, "utf8"));
  const { sink, events } = bufferSink();
  await assert.rejects(() =>
    runSkill({
      clientsDir: CLIENTS_DIR,
      client: "example-studio",
      skillName: "create-component",
      request: { ...buttonRequest(), variants: [{ prop: "variant", value: "acc", class: "hbtn--acc", role: "color.semantic.accent" }], sourceClasses: ["hbtn", "hbtn--acc"] },
      registry: REGISTRY,
      policyLayers: { project: [{ pattern: "Write", decision: "deny" }] }, // deny-first → the Write is denied at the gate
      skillResultSink: sink,
    }),
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].outcome, SKILL_RESULT.FAIL);
});

test("the skill_result event is secret-free (no raw source/artifact content)", async () => {
  writeFileSync(HUB_PATH, readFileSync(FIXTURE_TOKENS, "utf8"));
  const { sink, events } = bufferSink();
  await runSkill({
    clientsDir: CLIENTS_DIR,
    client: "example-studio",
    skillName: "create-component",
    request: { ...buttonRequest(), variants: [{ prop: "variant", value: "acc", class: "hbtn--acc", role: "color.semantic.accent" }], sourceClasses: ["hbtn", "hbtn--acc"] },
    registry: REGISTRY,
    policyLayers: POLICY_LAYERS,
    skillResultSink: sink,
  });
  const json = JSON.stringify(events[0]);
  // No artifact source (the React wrapper text) and no token values bled into telemetry.
  assert.doesNotMatch(json, /forwardRef|className|hbtn--/);
  assert.doesNotMatch(json, /[A-Za-z0-9]{40,}/); // no long credential-shaped token
});

test("a missing sink does not break the run (telemetry is optional)", async () => {
  writeFileSync(HUB_PATH, readFileSync(FIXTURE_TOKENS, "utf8"));
  await assert.doesNotReject(() =>
    runSkill({
      clientsDir: CLIENTS_DIR,
      client: "example-studio",
      skillName: "create-component",
      request: { ...buttonRequest(), variants: [{ prop: "variant", value: "acc", class: "hbtn--acc", role: "color.semantic.accent" }], sourceClasses: ["hbtn", "hbtn--acc"] },
      registry: REGISTRY,
      policyLayers: POLICY_LAYERS,
    }),
  );
});
