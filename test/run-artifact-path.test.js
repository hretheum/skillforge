// Output-adapter-aware artifact path (T-P4-07 / docs/04 §output contract, docs/13 §PreToolUse).
//
// Sources: concept + first principles, zero third-party skills-factory files (clean-room).
//
// THE DEFECT THIS PINS (found in P3). run.js formed the gated `Write` intent with a HARDCODED
// `.tsx` extension, so a non-react output client's write was mis-named: a web-components client
// (Glasshouse, output adapter `web-components`) gated a `Write` to `Sprout.tsx` instead of the
// adapter's own `x-sprout.js`. The OUTPUT ADAPTER owns the artifact filename (docs/04) — the
// returned in-memory artifact was always correct (the adapter sets it), so the e2e / genericity /
// determinism proofs were unaffected; the bug was a latent genericity defect on the GATED WRITE
// PATH only. The fix derives the gated path from the rendered artifact's own filename.
//
// HOW THIS TEST SEES THE GATED PATH. The run returns the in-memory artifact but not the path it
// gated. So we inject a SPY PreToolUse hook that captures `toolInput.file_path` and then delegates
// to the real hook (the gate still runs for real). The captured path is the exact intent the run
// presented to the gate — the thing the defect corrupted.
//
// MEMBRANE-SAFE. Like the e2e keystone, the only client whose token VALUES are confidential
// (example-studio) is overlaid from a fixture; Glasshouse (a fictional client) is copied verbatim.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { runSkill } from "../src/engine/run.js";
import { createPreToolUseHook, HOOK_DECISION } from "../src/governance/index.js";

const REPO_CLIENTS_DIR = fileURLToPath(new URL("../clients", import.meta.url));
const REGISTRY = JSON.parse(
  readFileSync(fileURLToPath(new URL("../skillforge.registry.json", import.meta.url)), "utf8"),
);
const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const OVERLAY = {
  "example-studio": { tokensFile: "example-studio.tokens.json", fixture: "dtcg-example-studio.tokens.json" },
};
const CLIENT_NAMES = ["example-studio", "glasshouse"];

let CLIENTS_DIR;
let TMP_ROOT;

before(() => {
  TMP_ROOT = mkdtempSync(join(tmpdir(), "sf-artifact-path-"));
  CLIENTS_DIR = join(TMP_ROOT, "clients");
  for (const client of CLIENT_NAMES) {
    const dir = join(CLIENTS_DIR, client);
    cpSync(join(REPO_CLIENTS_DIR, client), dir, { recursive: true });
    const overlay = OVERLAY[client];
    if (overlay) {
      mkdirSync(join(dir, "resources"), { recursive: true });
      writeFileSync(join(dir, "resources", overlay.tokensFile), readFileSync(fixture(overlay.fixture), "utf8"));
    }
  }
});

after(() => {
  if (TMP_ROOT) rmSync(TMP_ROOT, { recursive: true, force: true });
});

// A spy hook: capture the gated Write's file_path, then delegate to a real gate so the run's
// gate behavior is unchanged (the path under test is exactly what the run hands the gate).
function spyHook(captured) {
  const real = createPreToolUseHook();
  return {
    check(call) {
      captured.path = call.toolInput?.file_path ?? null;
      return real.check(call);
    },
  };
}

const REQUEST = {
  glasshouse: {
    componentName: "Sprout",
    element: "article",
    baseClass: "gh-sprout",
    variants: [
      { prop: "size", value: "s", class: "gh-sprout--sm" },
      { prop: "tone", value: "accent", class: "gh-sprout--accent", role: "color.semantic.accent" },
    ],
    decorations: [{ element: "span", class: "gh-leaf", ariaHidden: true }],
    sourceClasses: ["gh-sprout", "gh-sprout--sm", "gh-sprout--accent", "gh-leaf"],
  },
  "example-studio": {
    componentName: "Button",
    element: "button",
    baseClass: "hbtn",
    variants: [{ prop: "size", value: "s", class: "hbtn--sm" }],
    decorations: [{ element: "span", class: "sq", ariaHidden: true }],
    sourceClasses: ["hbtn", "hbtn--sm", "sq"],
  },
};

const ALLOW_WRITE = { org: [{ pattern: "Write", decision: "allow" }] };

test("T-P4-07: a web-components client gates the ADAPTER-CORRECT path (x-sprout.js, not Sprout.tsx)", async () => {
  const captured = {};
  const out = await runSkill({
    clientsDir: CLIENTS_DIR,
    client: "glasshouse",
    skillName: "create-component",
    request: REQUEST.glasshouse,
    registry: REGISTRY,
    policyLayers: ALLOW_WRITE,
    preToolUseHook: spyHook(captured),
  });

  // The returned in-memory artifact was already correct (the adapter sets it) — establish the
  // adapter's own filename, then prove the GATED path matches it (the path the defect corrupted).
  assert.equal(out.artifact.filename, "x-sprout.js", "web-components adapter owns the filename");
  assert.equal(out.artifact.language, "js");

  // ★ The fix: the gated Write path uses the adapter's filename, joined onto the output dir
  // (glasshouse's componentOutputDir = "src/elements"). It is NOT the hardcoded .tsx.
  assert.equal(captured.path, "src/elements/x-sprout.js", "gated path uses the adapter's own filename + ext");
  assert.doesNotMatch(captured.path, /\.tsx$/, "the gated write path must NOT hardcode .tsx for a non-react client");
  assert.notEqual(out.gate.decision, HOOK_DECISION.DENY, "the (now correctly-named) write still passes the gate");
});

test("T-P4-07: a react client still gates the .tsx path (no regression)", async () => {
  const captured = {};
  const out = await runSkill({
    clientsDir: CLIENTS_DIR,
    client: "example-studio",
    skillName: "create-component",
    request: REQUEST["example-studio"],
    registry: REGISTRY,
    policyLayers: ALLOW_WRITE,
    preToolUseHook: spyHook(captured),
  });

  assert.equal(out.artifact.filename, "Button.tsx", "react adapter owns the .tsx filename");
  // example-studio's componentOutputDir = "src/components".
  assert.equal(captured.path, "src/components/Button.tsx", "react gated path is the adapter's .tsx, unchanged");
});

test("T-P4-07: the two output adapters gate DIFFERENT extensions for the same kind of request", async () => {
  // The generic point: one engine, one gated-write step, but the EXTENSION follows the output
  // adapter — the defect made it react-only. Prove the divergence is real, side by side.
  const bc = {};
  await runSkill({ clientsDir: CLIENTS_DIR, client: "example-studio", skillName: "create-component", request: REQUEST["example-studio"], registry: REGISTRY, policyLayers: ALLOW_WRITE, preToolUseHook: spyHook(bc) });
  const gh = {};
  await runSkill({ clientsDir: CLIENTS_DIR, client: "glasshouse", skillName: "create-component", request: REQUEST.glasshouse, registry: REGISTRY, policyLayers: ALLOW_WRITE, preToolUseHook: spyHook(gh) });

  assert.match(bc.path, /\.tsx$/, "react gates .tsx");
  assert.match(gh.path, /\.js$/, "web-components gates .js");
  assert.notEqual(bc.path.split(".").pop(), gh.path.split(".").pop(), "the extension follows the output adapter, not the engine");
});
