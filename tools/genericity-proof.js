#!/usr/bin/env node
// genericity-proof — Gate 2 of docs/07 §Verification (THE proof of genericity).
//
// Sources: concept + first principles; zero files from any third-party skills-factory
// codebase (clean-room). See docs/07-build-plan.md §"Gate 2 — the genericity proof",
// docs/04-adapters.md §"how to add a new adapter" (step 6), docs/04a-normalized-form.md
// §"Genericity (equivalence)".
//
// WHAT IT ASSERTS. The engine is generic, not "a hardcode in disguise": run the SAME skill
// (create-component), for the SAME client (Example Studio), through TWO different output adapters
// (`react` and `web-components`) and confirm the two are the SAME INTENT IN TWO FORMS — the
// difference is FORM (added by the adapter), not CONTENT (decided once by the skill). The proof
// has three pillars:
//
//   1. EQUIVALENCE — the two normalized RESULTS are equal under the T-P2-01 relation
//      (resultsEquivalent: same edge ∧ same kind ∧ canonically-equal payload). The skill
//      decided one thing; both adapters received that one decision.
//   2. TWO FORMS — the two rendered ARTIFACTS differ (a `.tsx` React wrapper vs a `.js` custom
//      element). Equal results, different artifacts → the adapter adds form, not content.
//   3. ZERO ENGINE-CODE CHANGE BETWEEN THE FORMS — the skill composes its decision ONCE; the
//      only thing that differs between the two forms is WHICH output adapter (a name resolved
//      from the registry, the config's `adapters.output` field) renders that one decision. No
//      src/ engine code differs between the two forms. If producing the second form required
//      touching the core, the difference would NOT be "one adapter name" — and that is the leak
//      the gate is built to catch.
//
// WHY IT DRIVES THE SKILL→makeResult→render PATH, NOT THE WHOLE run(). The proof exercises the
// genericity axis precisely — input adapter → SKILL COMPOSE (one decision) → the two output
// adapters — without depending on the run()/governance wrapper. That keeps Gate 2 INDEPENDENT
// of unrelated run-path work (the runtime-failure / skill_result wrappers): a red elsewhere in
// the run path must not mask or break the genericity proof, and vice versa. The composed spec IS
// the skill's single decision; feeding that ONE spec to both adapters is the sharpest form of
// "same content, two forms" (there is literally one decision object shared by both).
//
// HOW THE GATE BITES (the leak test). The proof is parameterized by an injectable output-form
// builder so a NEGATIVE test (test/genericity-proof.test.js) can simulate "the 2nd form required
// a core change": a leaky form that mutates the skill's decision (so the second result is no
// longer equivalent), a no-op form (same artifact, proving nothing), or a form that throws
// (unbuildable without a core change) — each makes proveGenericity() return ok:false and the gate
// exit non-zero. A green read alone is NOT proof — the gate must demonstrably FAIL on a coupled
// form, which the negative tests assert. (docs/07: "If producing the second form required
// touching the core, the gate fails: that would be the definition of a leaky generic.")
//
// MEMBRANE-SAFE (clean-room). Like the determinism gate, the proof reads a REAL design system:
// it points the committed input adapter at the real DTCG fixture (the brand values are CLIENT
// DATA that lives in the fixture, not the engine tree). No client values are written into the
// committed tree; the genuine chain (input adapter → compose) runs on real fixture data.

import { fileURLToPath } from "node:url";

import { resultsEquivalent, diagnoseEquivalence } from "../src/core/index.js";
import { readDesignSystem } from "../src/adapters/input/dtcg-tokens.js";
import { composeComponent } from "../src/skills/create-component/compose.js";
import { getOutputAdapter } from "../src/adapters/index.js";

const fixturePath = (name) => fileURLToPath(new URL(`../test/fixtures/${name}`, import.meta.url));

/** The two output adapters whose equivalence IS the proof (docs/07 §Gate 2). */
export const PROOF_ADAPTERS = Object.freeze(["react", "web-components"]);

/** The fixed Button request that, against the BC design system, both adapters render. */
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

/**
 * Read the real BC design system through the committed input adapter (same membrane-safe path
 * the determinism gate uses: the committed adapter, pointed at the real DTCG fixture).
 */
function readButtonCultDescription() {
  return readDesignSystem({
    references: {
      tokenHub: {
        ref: "./resources/example-studio.tokens.json",
        resolvedPath: fixturePath("dtcg-example-studio.tokens.json"),
        local: true,
      },
    },
    identity: "example-studio/tokens@genericity-proof",
  });
}

/**
 * The default output-form builder: resolve the adapter BY NAME from the registry and render the
 * skill's ONE composed spec into that form. This is the genuine engine path (getOutputAdapter →
 * makeResult → render); the ONLY input that varies per form is the adapter NAME.
 *
 * @param {string} adapterName  the output adapter to render through (a registry name).
 * @param {object} spec  the skill's composed `frontend-component` spec (the single decision).
 * @returns {{ result: object, artifact: object }}
 */
function defaultBuildForm(adapterName, spec) {
  const adapter = getOutputAdapter(adapterName);
  const result = adapter.makeResult(spec, spec.componentName);
  const artifact = adapter.render(result);
  return { result, artifact };
}

/**
 * THE PROOF. Compose the skill's decision ONCE, then build every output form and assert the
 * three pillars against the FIRST form as the reference: every other form's normalized result is
 * equivalent to it (pillar 1), and every other form's artifact differs from it (pillar 2). Pillar
 * 3 (zero engine change) is structural: the single composed spec is shared by every form; only
 * the output-adapter name varies.
 *
 * @param {object} [opts]
 * @param {string[]} [opts.adapters]   the output-adapter names to prove equivalent (>= 2).
 * @param {Function} [opts.buildForm]  injected (adapterName, spec) -> { result, artifact }; the
 *   negative tests pass a leaky builder to prove the gate bites.
 * @returns {{ ok: boolean, failures: string[], forms: Array<{adapter:string, kind:string, filename:string}> }}
 */
export function proveGenericity({ adapters = PROOF_ADAPTERS, buildForm = defaultBuildForm } = {}) {
  const failures = [];
  if (!Array.isArray(adapters) || adapters.length < 2) {
    return { ok: false, failures: ["the genericity proof needs at least two output adapters"], forms: [] };
  }

  // The skill's SINGLE decision — composed ONCE, shared by every output form (pillar 3).
  let spec;
  try {
    const description = readButtonCultDescription();
    spec = composeComponent({ request: buttonRequest(), description });
  } catch (e) {
    return { ok: false, failures: [`the skill failed to compose its decision: ${e.message}`], forms: [] };
  }

  const built = [];
  for (const name of adapters) {
    let form;
    try {
      form = buildForm(name, spec);
    } catch (e) {
      failures.push(`building the output form "${name}" threw: ${e.message}`);
      continue;
    }
    built.push({ name, ...form });
  }

  // If any form failed to build we cannot make the comparison — fail loud.
  if (built.length !== adapters.length) {
    return { ok: false, failures, forms: built.map(summarize) };
  }

  const [reference, ...rest] = built;
  for (const other of rest) {
    // Pillar 1 — EQUIVALENCE of the normalized results (the T-P2-01 relation).
    if (!resultsEquivalent(reference.result, other.result)) {
      const d = diagnoseEquivalence(reference.result, other.result);
      failures.push(
        `LEAK: results from "${reference.name}" and "${other.name}" are NOT equivalent ` +
          `(${d.mismatch} mismatch) — the second form changed the skill's decision, not just its ` +
          `form. A generic engine must add form, not content (docs/07 §Gate 2).`,
      );
    }
    // Pillar 2 — TWO FORMS: the rendered artifacts must actually differ.
    if (artifactsIdentical(reference.artifact, other.artifact)) {
      failures.push(
        `"${reference.name}" and "${other.name}" produced the SAME artifact form — the proof needs ` +
          `two DIFFERENT forms of one intent (a no-op second adapter proves nothing).`,
      );
    }
  }

  return { ok: failures.length === 0, failures, forms: built.map(summarize) };
}

function summarize({ name, result, artifact }) {
  return {
    adapter: name,
    kind: result?.envelope?.kind ?? "<none>",
    filename: artifact?.filename ?? "<none>",
  };
}

function artifactsIdentical(a, b) {
  if (!a || !b) return false;
  return a.filename === b.filename && a.language === b.language && a.source === b.source;
}

function main() {
  const { ok, failures, forms } = proveGenericity();
  if (!ok) {
    console.error(`genericity-proof: FAIL — ${failures.length} violation(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  const rendered = forms.map((r) => `${r.adapter}→${r.filename}`).join(", ");
  console.log(
    `genericity-proof: PASS — one skill decision, ${forms.length} output forms (${rendered}); ` +
      `results equivalent, forms distinct, zero engine-code change between forms`,
  );
}

// Run when invoked directly (not when imported by the tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
