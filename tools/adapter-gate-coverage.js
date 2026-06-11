#!/usr/bin/env node
// adapter-gate-coverage — the gate-per-adapter REGISTRATION rule (T-P4-01).
//
// Sources: concept + first principles; zero files from any third-party skills-factory
// codebase (clean-room). See docs/04-adapters.md §"how to add a new adapter" (steps 5–6)
// and docs/07-build-plan.md §per-phase (P4).
//
// WHAT IT ASSERTS — "ship a gate with every adapter" is a REGISTRATION REQUIREMENT, not a
// reviewer's good intention. The engine's adapter catalog (src/loader/adapter-registry.js) is
// the single registration point; this check walks every adapter in it and confirms its proving
// gate ACTUALLY exists:
//
//   - every INPUT adapter must declare a determinism golden, and that golden fixture must be
//     present (Gate 1 proves the adapter is byte-deterministic);
//   - every OUTPUT adapter must declare a genericity-proof pairing, and the adapter name must
//     actually appear in the genericity proof's adapter list (Gate 2 proves the adapter adds
//     form, not content);
//   - an adapter with NO gate declared at all fails outright.
//
// So adding an adapter to the catalog without its gate FAILS here (wired into tools/gates.js),
// which means it fails review/CI: the catalog cannot grow ungated. The bite is proven by
// test/adapter-gate-coverage.test.js — a temp/extra adapter with a missing or absent gate makes
// checkGateCoverage() return violations and the tool exit non-zero.
//
// Why the catalog declares the gate, not the gate the catalog: the catalog is where docs/04
// step 3 registers a name, so it is the natural place to also record (step 5–6) HOW the adapter
// is proven. This tool then verifies the declaration is backed by a real artifact — a
// declaration that points at a missing golden, or an output adapter that names a pairing it is
// not actually in, is as much a failure as no declaration at all.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { defaultAdapterRegistry, EDGES, GATE_KINDS } from "../src/loader/adapter-registry.js";
import { PROOF_ADAPTERS } from "./genericity-proof.js";

const fixturePath = (name) => fileURLToPath(new URL(`../test/fixtures/${name}`, import.meta.url));

/**
 * Check that every adapter in `adapterRegistry` ships its required gate. Pure over its inputs so
 * it is unit-testable without the real FS or the real proof list (the bite test injects both).
 *
 * @param {object} args
 * @param {object} args.adapterRegistry  the engine adapter catalog (entries carry `gate`).
 * @param {string[]} args.proofAdapters  the output adapters the genericity proof actually pairs.
 * @param {(file: string) => boolean} [args.goldenExists]  does an input golden fixture exist?
 * @returns {string[]} violation messages (empty = every adapter is gated).
 */
export function checkGateCoverage({ adapterRegistry, proofAdapters, goldenExists = (f) => existsSync(fixturePath(f)) }) {
  const violations = [];
  const proofSet = new Set(proofAdapters);

  for (const edge of [EDGES.INPUT, EDGES.OUTPUT]) {
    for (const rec of adapterRegistry.entries(edge)) {
      const { name, gate } = rec;
      // (0) a gate MUST be declared — this is the registration requirement.
      if (!gate || typeof gate !== "object") {
        violations.push(
          `${edge} adapter "${name}" declares no gate — every adapter must ship its proof ` +
            `(input -> a ${GATE_KINDS[EDGES.INPUT]}; output -> a ${GATE_KINDS[EDGES.OUTPUT]}).`,
        );
        continue;
      }
      // (1) the declared gate KIND must match the edge (defence in depth; the catalog already
      // enforces this on construction, but the tool must not trust a hand-built registry).
      if (gate.kind !== GATE_KINDS[edge]) {
        violations.push(
          `${edge} adapter "${name}" declares gate kind "${gate.kind}" but the "${edge}" edge ` +
            `requires "${GATE_KINDS[edge]}".`,
        );
        continue;
      }
      // (2) the gate must be BACKED by a real artifact.
      if (edge === EDGES.INPUT) {
        if (typeof gate.golden !== "string" || gate.golden.length === 0) {
          violations.push(`input adapter "${name}" gate names no determinism golden fixture.`);
        } else if (!goldenExists(gate.golden)) {
          violations.push(
            `input adapter "${name}" gate names golden "${gate.golden}" but that fixture is absent ` +
              `(the determinism gate cannot prove an adapter whose golden does not exist).`,
          );
        }
      } else {
        // output: the adapter must actually be IN the genericity proof's pairing.
        if (!proofSet.has(name)) {
          violations.push(
            `output adapter "${name}" is not part of the genericity proof (PROOF_ADAPTERS = ` +
              `[${proofAdapters.join(", ")}]) — an output adapter must pair with another to prove it ` +
              `adds form, not content.`,
          );
        }
        if (typeof gate.pairsWith === "string" && gate.pairsWith === name) {
          violations.push(`output adapter "${name}" cannot pair the genericity proof with itself.`);
        }
      }
    }
  }

  return violations;
}

function main() {
  const violations = checkGateCoverage({
    adapterRegistry: defaultAdapterRegistry(),
    proofAdapters: PROOF_ADAPTERS,
  });

  if (violations.length > 0) {
    console.error(`adapter-gate-coverage: FAIL — ${violations.length} ungated adapter(s):`);
    for (const v of violations) console.error(`  - ${v}`);
    console.error("  (ship a gate with every adapter — docs/04 §how-to-add steps 5–6; the catalog cannot grow ungated)");
    process.exit(1);
  }

  const reg = defaultAdapterRegistry();
  const count = reg.names(EDGES.INPUT).length + reg.names(EDGES.OUTPUT).length;
  console.log(`adapter-gate-coverage: PASS — all ${count} adapter(s) ship their gate`);
}

// Run when invoked directly (not when imported by the bite test).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
