#!/usr/bin/env node
// determinism-gate — Gate 1 of docs/07 §Verification (byte-diff on the normalized
// description + the rendered artifact + the prompt prefix).
//
// Sources: concept + first principles; zero files from any third-party skills-factory
// codebase (clean-room). See docs/07-build-plan.md §"Gate 1 — the determinism gate".
//
// WHAT IT ASSERTS. For fixed source inputs, the engine's byte-stable outputs are byte-for-byte
// identical to the checked-in goldens. A reordered key, a reformatted number, a stray
// timestamp, or whitespace churn FAILS the gate — that drift is exactly the regression that
// silently forfeits the prompt-cache saving (docs/04 §determinism rule). Updating a golden is
// a deliberate, reviewed commit; this gate never overwrites — it only diffs.
//
// GOLDENS, regenerated from the engine's OWN canonical path (not re-read blindly). They span
// TWO clients on DIFFERENT adapter edges, which is the P3 point: the gate is CLIENT-GENERIC, not
// BC-specific. If the gate only ever proved Example Studio it could be hiding a BC hardcode; proving
// a second client (Glasshouse) through the OTHER edges (flat-tokens input, web-components output)
// shows the determinism contract holds across the engine, not just one wiring.
//
//   Example Studio (dtcg-tokens → react):
//   1. dtcg-golden-description.json     — the DTCG input adapter's normalized description
//      (serialize(readDtcgDesignSystem(fixture))).
//   2. golden-description.json          — a normalized description round-trips through the
//      canonical serializer byte-identically (deserialize → serialize). Client-agnostic.
//   3. react-golden-Button.tsx          — the React output adapter's artifact for the Button spec
//      (renderReact(makeComponentResult(spec))).
//   4. prompt-prefix-golden.txt         — the tier-1+tier-2 cacheable prefix (renderPromptTiers).
//
//   Glasshouse (flat-tokens → web-components) — the second client, the OTHER edges. Glasshouse is
//   a FICTIONAL client, so these read its COMMITTED resource directly (no placeholder/fixture
//   overlay — that is BC-only, for a real brand's confidential values):
//   5. flat-glasshouse-description.json     — the FLAT input adapter's normalized description
//      (serialize(readFlatDesignSystem(committed resource))) — a different input FORMAT, same shape.
//   6. web-components-golden-Sprout.js.txt  — the web-components output adapter's artifact for the
//      Sprout spec (renderWebComponent(makeWcResult(spec))) — a different artifact KIND.
//   7. prompt-prefix-glasshouse-golden.txt  — Glasshouse's tier-1+tier-2 prefix from a REAL run()
//      against the committed clients/ dir (DIRECT mode), proving the cacheable prefix is byte-stable
//      for the 2nd client too — the cache-hit saving (docs/10) is a per-client guarantee, not BC-only.
//
// GOLDEN PROVENANCE (the tier-2 identity caveat, reviewer-a's #13 finding, resolved option-b).
// The prompt prefix carries the tier-2 source IDENTITY (a reference ADDRESS, not client
// content). Rather than reconstruct a synthetic tier shape that must be kept in sync, the gate
// drives the prefix from a REAL run() — request → loader → input adapter → … → promptTiers —
// exactly how the golden is generated. A single source of truth: the same code path produces
// the golden and the gate's regeneration, so there is no synthetic-shape drift to false-fail
// on. The run uses the committed BC client config overlaid (in a temp dir) with the real DTCG
// fixture at its tokenHub address — the same membrane-safe pattern the e2e test uses (client
// values stay out of the committed tree; the real chain runs on real fixture data).

import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { serialize, deserialize, renderPromptTiers } from "../src/core/index.js";
import { readDesignSystem as readDtcgDesignSystem } from "../src/adapters/input/dtcg-tokens.js";
import { readDesignSystem as readFlatDesignSystem } from "../src/adapters/input/flat-tokens.js";
import { renderReact, makeComponentResult } from "../src/adapters/output/react.js";
import { renderWebComponent, makeComponentResult as makeWcResult } from "../src/adapters/output/web-components.js";
import { runSkill } from "../src/engine/run.js";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const fixturePath = (name) => fileURLToPath(new URL(`../test/fixtures/${name}`, import.meta.url));
// A client's COMMITTED resource path. For a FICTIONAL client (e.g. glasshouse) the real values
// live directly in the committed tree — there is no confidentiality reason for a placeholder +
// fixture-overlay split (that pattern exists for BC only because BC is a REAL brand whose values
// are clean-room-confidential). So the gate reads the fictional client's committed source as the
// single source of truth, rather than duplicating it into a fixture.
const clientResourcePath = (client, name) =>
  fileURLToPath(new URL(`../clients/${client}/resources/${name}`, import.meta.url));

// --- regenerators: each returns the engine's current output for a fixed input -----------

function regenDtcgDescription() {
  const desc = readDtcgDesignSystem({
    references: {
      tokenHub: {
        ref: "./resources/example-studio.tokens.json",
        resolvedPath: fixturePath("dtcg-example-studio.tokens.json"),
        local: true,
      },
    },
    identity: "example-studio/tokens@golden",
  });
  return serialize(desc);
}

// --- Glasshouse (the second client) regenerators — flat-tokens → web-components ----------
// Same canonical paths as the BC regenerators above, only through the OTHER adapter edges.
// Glasshouse is a FICTIONAL client, so its real token DATA lives directly in the committed tree
// (no placeholder/fixture split — that is BC-only, for a real brand's confidential values). The
// gate therefore reads the COMMITTED client resource as the single source of truth. That these run
// through different adapters and still byte-match is the P3 proof that the determinism contract is
// client-generic, not a BC hardcode.

function regenFlatGlasshouseDescription() {
  const desc = readFlatDesignSystem({
    references: {
      tokenHub: {
        ref: "./resources/glasshouse.tokens.json",
        resolvedPath: clientResourcePath("glasshouse", "glasshouse.tokens.json"),
        local: true,
      },
    },
    identity: "glasshouse/tokens@golden",
  });
  return serialize(desc);
}

/**
 * The fixed Glasshouse component spec the web-components output adapter renders to a golden — the
 * SAME request impl-client proved the 2nd client e2e with (T-P3-01 handoff). The output-golden spec
 * drops the role binding (the output adapter renders structure only); the run-path regenerator
 * below restores it (the run's compose step DS-compliance-checks color.semantic.accent).
 */
function glasshouseSpec() {
  return {
    componentName: "Sprout",
    element: "article",
    baseClass: "gh-sprout",
    variants: [
      { prop: "size", value: "s", class: "gh-sprout--sm" },
      { prop: "tone", value: "accent", class: "gh-sprout--accent" },
    ],
    decorations: [{ element: "span", class: "gh-leaf", ariaHidden: true }],
    sourceClasses: ["gh-sprout", "gh-sprout--sm", "gh-sprout--accent", "gh-leaf"],
  };
}

function regenWebComponentArtifact() {
  return renderWebComponent(makeWcResult(glasshouseSpec(), "Sprout")).source;
}

function regenGenericDescription() {
  // The generic golden's contract is round-trip byte-stability of the canonical serializer:
  // deserialize → serialize must reproduce the bytes. A corrupt/edited golden that no longer
  // parses IS drift (the golden changed), so surface it as a DRIFT message, not an opaque
  // "regeneration threw" (reviewer-a's note (a)) — same exit 1, clearer cause.
  const golden = readFileSync(fixturePath("golden-description.json"), "utf8");
  let value;
  try {
    value = deserialize(golden);
  } catch (e) {
    throw new Error(`golden no longer parses as a canonical normalized value (drift/corruption): ${e.message}`);
  }
  return serialize(value);
}

function regenReactArtifact() {
  const spec = {
    componentName: "Button",
    element: "button",
    baseClass: "hbtn",
    variants: [
      { prop: "variant", value: "acc", class: "hbtn--acc" },
      { prop: "size", value: "s", class: "hbtn--sm" },
    ],
    decorations: [{ element: "span", class: "sq", ariaHidden: true }],
    sourceClasses: ["hbtn", "hbtn--acc", "hbtn--sm", "sq"],
  };
  return renderReact(makeComponentResult(spec, "Button")).source;
}

/**
 * Drive a client's tier-1+tier-2 prompt prefix from a REAL run() (single source of truth with
 * the golden — see the GOLDEN PROVENANCE note above). CLIENT-PARAMETERIZED so the SAME path
 * produces the prefix for both clients — the prefix's byte-stability is proven per client, not
 * just for BC. Two membrane postures, selected by whether a `fixture` is given:
 *
 *  - OVERLAY (BC): BC is a REAL brand whose token values are clean-room-confidential, so the
 *    committed resource is a PLACEHOLDER. Build a temp clients dir, copy the committed config, and
 *    overlay the real token fixture at the tokenHub address — the genuine chain runs on real data
 *    without writing client values into the committed tree.
 *  - DIRECT (Glasshouse): a FICTIONAL client whose real (fictional) values live directly in the
 *    committed resource — there is nothing confidential to keep out of the tree, so the gate runs
 *    against the committed clients/ directory as the single source of truth (no overlay, no temp).
 *
 * @param {object} o
 * @param {string} o.client        the client directory/identifier to load.
 * @param {string} [o.tokensFile]  (overlay only) the committed config's tokenHub filename.
 * @param {string} [o.fixture]     (overlay only) the test/fixtures file overlaid at the tokenHub;
 *        omit for DIRECT mode (run against the committed clients/ resource).
 * @param {object} o.request       the create-component request to run.
 * @returns {string} the rendered tier-1+tier-2 prefix.
 */
async function runPromptPrefix({ client, tokensFile, fixture, request }) {
  const registry = JSON.parse(readFileSync(join(REPO, "skillforge.registry.json"), "utf8"));
  const doRun = async (clientsDir) =>
    renderPromptTiers(
      (
        await runSkill({
          clientsDir,
          client,
          skillName: "create-component",
          request,
          registry,
          policyLayers: { org: [{ pattern: "Write", decision: "allow" }] },
        })
      ).promptTiers,
    ).prefix;

  // DIRECT mode — run against the committed clients/ directory (fictional client, values in-tree).
  if (!fixture) return doRun(join(REPO, "clients"));

  // OVERLAY mode — temp clients dir with the real fixture overlaid (real brand, confidential).
  const tmp = mkdtempSync(join(tmpdir(), "sf-detgate-"));
  try {
    const clientsDir = join(tmp, "clients");
    const clientDir = join(clientsDir, client);
    cpSync(join(REPO, "clients", client), clientDir, { recursive: true });
    mkdirSync(join(clientDir, "resources"), { recursive: true });
    writeFileSync(join(clientDir, "resources", tokensFile), readFileSync(fixturePath(fixture), "utf8"));
    return await doRun(clientsDir);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function regenPromptPrefix() {
  return runPromptPrefix({
    client: "example-studio",
    tokensFile: "example-studio.tokens.json",
    fixture: "dtcg-example-studio.tokens.json",
    request: {
      componentName: "Button",
      element: "button",
      baseClass: "hbtn",
      variants: [
        { prop: "size", value: "s", class: "hbtn--sm" },
        { prop: "variant", value: "acc", class: "hbtn--acc", role: "color.semantic.accent" },
      ],
      decorations: [{ element: "span", class: "sq", ariaHidden: true }],
      sourceClasses: ["hbtn", "hbtn--acc", "hbtn--sm", "sq"],
    },
  });
}

function regenGlasshousePromptPrefix() {
  // DIRECT mode (no overlay): glasshouse is fictional, its values are committed in-tree. The spec
  // carries the role binding (color.semantic.accent) the run's compose step checks for DS-
  // compliance; the golden-artifact spec drops `role` because the output adapter renders structure
  // only. Same component, the run path additionally verifies the role.
  const s = glasshouseSpec();
  return runPromptPrefix({
    client: "glasshouse",
    request: {
      ...s,
      variants: [
        { prop: "size", value: "s", class: "gh-sprout--sm" },
        { prop: "tone", value: "accent", class: "gh-sprout--accent", role: "color.semantic.accent" },
      ],
    },
  });
}

const GOLDENS = [
  // Example Studio — dtcg-tokens → react.
  { name: "dtcg-golden-description.json", regen: regenDtcgDescription, kind: "BC normalized description (DTCG adapter)" },
  { name: "golden-description.json", regen: regenGenericDescription, kind: "canonical serializer round-trip (client-agnostic)" },
  { name: "react-golden-Button.tsx", regen: regenReactArtifact, kind: "BC React artifact (output adapter)" },
  { name: "prompt-prefix-golden.txt", regen: regenPromptPrefix, kind: "BC tier-1+tier-2 prompt prefix" },
  // Glasshouse — flat-tokens → web-components (the second client, the OTHER edges).
  { name: "flat-glasshouse-description.json", regen: regenFlatGlasshouseDescription, kind: "Glasshouse normalized description (flat adapter)" },
  { name: "web-components-golden-Sprout.js.txt", regen: regenWebComponentArtifact, kind: "Glasshouse web-component artifact (output adapter)" },
  { name: "prompt-prefix-glasshouse-golden.txt", regen: regenGlasshousePromptPrefix, kind: "Glasshouse tier-1+tier-2 prompt prefix" },
];

async function main() {
  const failures = [];
  for (const g of GOLDENS) {
    let golden;
    try {
      golden = readFileSync(fixturePath(g.name), "utf8");
    } catch {
      failures.push(`${g.name}: golden fixture missing (cannot run the determinism gate without it)`);
      continue;
    }
    let actual;
    try {
      // await is harmless on a synchronous regen (resolves to the value) and required for the
      // prompt-prefix regens that go through the now-async runSkill (CC-09).
      actual = await g.regen();
    } catch (e) {
      failures.push(`${g.name}: regeneration threw — ${e.message}`);
      continue;
    }
    if (actual !== golden) {
      failures.push(
        `${g.name}: DRIFT — the ${g.kind} no longer byte-matches the golden ` +
          `(${firstDiff(actual, golden)})`,
      );
    }
  }

  if (failures.length > 0) {
    console.error(`determinism-gate: FAIL — ${failures.length} golden(s) drifted:`);
    for (const f of failures) console.error(`  - ${f}`);
    console.error("  (a golden update is a deliberate, reviewed commit — never an automatic overwrite)");
    process.exit(1);
  }

  console.log(`determinism-gate: PASS — ${GOLDENS.length} goldens byte-match`);
}

/** Locate the first differing offset for a readable failure message (no secret content). */
function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return `first diff at byte ${i}`;
  }
  if (a.length !== b.length) return `length differs: actual ${a.length} vs golden ${b.length}`;
  return "byte mismatch";
}

main().catch((e) => {
  console.error(`determinism-gate: ERROR — ${e && e.message ? e.message : String(e)}`);
  process.exit(1);
});
