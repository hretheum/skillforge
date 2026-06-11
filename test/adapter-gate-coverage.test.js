// Tests for the gate-per-adapter REGISTRATION rule (T-P4-01) — and the proof it BITES.
//
// Sources: concept + first principles, zero third-party skills-factory files (clean-room).
// Covers docs/04 §how-to-add (steps 5–6): every adapter in the catalog must ship its proof
// (input -> a determinism golden; output -> a genericity-proof pairing). Adding an adapter
// without its gate must FAIL — proven below by adding a gateless/under-proven adapter and
// asserting the checker (and registry-lint, which folds it in) reports it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkGateCoverage } from "../tools/adapter-gate-coverage.js";
import { lintRegistry } from "../tools/registry-lint.js";
import { createAdapterRegistry, defaultAdapterRegistry, GATE_KINDS, EDGES } from "../src/loader/adapter-registry.js";

// The real proof list + a golden-existence stub that says "every golden exists" unless told
// otherwise — so a test isolates the ONE failure mode it is exercising.
const PROOF = ["react", "web-components"];
const allGoldensExist = () => true;

// --- the real catalog is fully gated (the positive baseline) ---------------

test("the real default catalog passes gate coverage", () => {
  const v = checkGateCoverage({ adapterRegistry: defaultAdapterRegistry(), proofAdapters: PROOF });
  assert.deepEqual(v, []);
});

// --- BITE 1: an input adapter added WITHOUT a gate -------------------------

test("BITE: an input adapter with no gate declared FAILS coverage", () => {
  const reg = defaultAdapterRegistry();
  reg.register(EDGES.INPUT, "redmine"); // a new reader, no gate
  const v = checkGateCoverage({ adapterRegistry: reg, proofAdapters: PROOF, goldenExists: allGoldensExist });
  assert.ok(v.some((m) => /input adapter "redmine" declares no gate/.test(m)), v.join("\n"));
});

// --- BITE 2: an input adapter whose declared golden is ABSENT --------------

test("BITE: an input adapter naming a golden that does not exist FAILS coverage", () => {
  const reg = createAdapterRegistry({
    input: [{ name: "csv", gate: { kind: GATE_KINDS.input, golden: "csv-golden.json" } }],
  });
  const v = checkGateCoverage({
    adapterRegistry: reg,
    proofAdapters: PROOF,
    goldenExists: (f) => f !== "csv-golden.json", // the csv golden is the missing one
  });
  assert.ok(v.some((m) => /golden "csv-golden.json" but that fixture is absent/.test(m)), v.join("\n"));
});

// --- BITE 3: an output adapter NOT in the genericity proof's pairing -------

test("BITE: an output adapter absent from the genericity proof FAILS coverage", () => {
  const reg = defaultAdapterRegistry();
  reg.register(EDGES.OUTPUT, "vue", { gate: { kind: GATE_KINDS.output, pairsWith: "react" } });
  // `vue` declares a gate but is not actually in the proof list -> not proven.
  const v = checkGateCoverage({ adapterRegistry: reg, proofAdapters: PROOF, goldenExists: allGoldensExist });
  assert.ok(v.some((m) => /output adapter "vue" is not part of the genericity proof/.test(m)), v.join("\n"));
});

// --- BITE 4: an output adapter that "pairs with itself" --------------------

test("BITE: an output adapter that pairs the proof with itself FAILS coverage", () => {
  const reg = createAdapterRegistry({
    output: [{ name: "react", gate: { kind: GATE_KINDS.output, pairsWith: "react" } }],
  });
  const v = checkGateCoverage({ adapterRegistry: reg, proofAdapters: ["react"], goldenExists: allGoldensExist });
  assert.ok(v.some((m) => /cannot pair the genericity proof with itself/.test(m)), v.join("\n"));
});

// --- the rule BITES THROUGH registry-lint (the wired gate) -----------------

const ALLOWLIST = { allowed: ["Read", "Edit", "Write"] };
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

test("registry-lint FAILS when the catalog has an ungated adapter (the gate is wired in)", () => {
  const reg = defaultAdapterRegistry();
  reg.register(EDGES.INPUT, "redmine"); // ungated
  const errs = lintRegistry({
    registry: validRegistry(),
    allowlist: ALLOWLIST,
    adapterRegistry: reg,
    skillDirs: ["create-component"],
    proofAdapters: PROOF,
    goldenExists: allGoldensExist,
  });
  assert.ok(errs.some((e) => /adapter-gate: input adapter "redmine" declares no gate/.test(e)), errs.join("\n"));
});

test("registry-lint PASSES gate coverage for the real catalog", () => {
  const errs = lintRegistry({
    registry: validRegistry(),
    allowlist: ALLOWLIST,
    adapterRegistry: defaultAdapterRegistry(),
    skillDirs: ["create-component"],
    proofAdapters: PROOF,
    goldenExists: allGoldensExist,
  });
  assert.deepEqual(errs, []);
});
