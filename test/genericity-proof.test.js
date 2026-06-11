// Tests for the genericity-proof gate (Gate 2, docs/07 §Verification) — THE P2 milestone.
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room). See docs/07-build-plan.md §"Gate 2", docs/04-adapters.md step 6.
//
// Two halves, and the SECOND is the load-bearing one:
//   (A) GREEN  — the real proof passes: one skill decision, two output adapters, equivalent
//                results, distinct forms, zero engine-code change between forms.
//   (B) BITE   — the gate FAILS when producing the second form required a core change. A green
//                read alone proves nothing; the gate is only a gate if it demonstrably bites.
//                We simulate "the 2nd form needed a core change" by injecting a leaky form
//                builder that mutates the skill's decision for the second adapter (an adapter
//                deciding content of its own — exactly what a generic engine forbids). The proof
//                must return ok:false. We also prove a no-op second form (same artifact) fails
//                pillar 2, and a form that cannot be built (throws) fails loud.
//
// The harness's injectable seam is `buildForm(adapterName, spec) -> { result, artifact }` (it
// drives the SKILL→makeResult→render path directly, not run()), so the bite tests inject a
// buildForm — they do NOT wrap run().

import { test } from "node:test";
import assert from "node:assert/strict";

import { proveGenericity, PROOF_ADAPTERS } from "../tools/genericity-proof.js";
import { getOutputAdapter } from "../src/adapters/index.js";
import { makeResult } from "../src/core/index.js";

// The real build for one adapter (mirrors the harness's defaultBuildForm, which is not exported):
// resolve the adapter by name, make the result, render the artifact.
function realBuild(adapterName, spec) {
  const adapter = getOutputAdapter(adapterName);
  const result = adapter.makeResult(spec, spec.componentName);
  return { result, artifact: adapter.render(result) };
}

// --- (A) the real proof passes --------------------------------------------------------------

test("GREEN: one skill decision + react + web-components → equivalent results, distinct forms", () => {
  const { ok, failures, forms } = proveGenericity();
  assert.equal(ok, true, `proof should pass; failures: ${failures.join(" | ")}`);
  assert.deepEqual(PROOF_ADAPTERS, ["react", "web-components"]);
  assert.equal(forms.length, 2);
  // Both forms render the SAME result-kind (the skill's one decision) into two artifacts.
  assert.ok(forms.every((r) => r.kind === "frontend-component"));
  const filenames = forms.map((r) => r.filename).sort();
  assert.deepEqual(filenames, ["Button.tsx", "x-button.js"]);
});

// --- (B) THE BITE: the gate must FAIL on a leaky engine -------------------------------------

test("BITE: a 2nd form that CHANGED the skill's decision (needed a core change) FAILS the proof", () => {
  // Simulate a leaky engine: for the SECOND adapter only, the form builder mutates the
  // normalized result (the skill's decision) — as if rendering that form forced the core to
  // decide differently. A truly generic engine cannot do this; the proof must catch the
  // non-equivalence as a LEAK.
  let call = 0;
  const leakyBuild = (adapterName, spec) => {
    call += 1;
    if (call === 2) {
      // Re-decide the payload (different baseClass) → no longer equivalent to the first result.
      const leakedResult = makeResult({
        kind: "frontend-component",
        identity: spec.componentName,
        payload: { ...spec, baseClass: "hbtn-LEAKED", sourceClasses: ["hbtn-LEAKED"] },
      });
      const artifact = { filename: "x-button.js", language: "js", source: "/* leaked */" };
      return { result: leakedResult, artifact };
    }
    return realBuild(adapterName, spec);
  };

  const { ok, failures } = proveGenericity({ buildForm: leakyBuild });
  assert.equal(ok, false, "a leaked (re-decided) second result MUST fail the proof");
  assert.ok(
    failures.some((f) => /LEAK/.test(f) && /NOT equivalent/.test(f)),
    `expected a LEAK/non-equivalence failure, got: ${failures.join(" | ")}`,
  );
});

test("BITE: a no-op second form producing the SAME artifact FAILS pillar 2 (two forms)", () => {
  // A "second adapter" that renders the identical artifact proves nothing (it is the same form).
  // Build an equivalent result but copy the FIRST form's artifact → the proof must reject it.
  let firstArtifact = null;
  const cloningBuild = (adapterName, spec) => {
    const built = realBuild(adapterName, spec);
    if (firstArtifact === null) {
      firstArtifact = built.artifact;
      return built;
    }
    return { result: built.result, artifact: firstArtifact }; // same form as the first
  };

  const { ok, failures } = proveGenericity({ buildForm: cloningBuild });
  assert.equal(ok, false, "two identical artifact forms must fail the proof");
  assert.ok(
    failures.some((f) => /SAME artifact form/.test(f)),
    `expected a same-form failure, got: ${failures.join(" | ")}`,
  );
});

test("BITE: a 2nd form that is unbuildable (throws) FAILS the proof", () => {
  // If producing the second form is impossible without a core change, the builder throws — the
  // proof must surface that as a failure, never a silent pass.
  let call = 0;
  const throwingBuild = (adapterName, spec) => {
    call += 1;
    if (call === 2) throw new Error("second form requires a core change (simulated coupling)");
    return realBuild(adapterName, spec);
  };
  const { ok, failures } = proveGenericity({ buildForm: throwingBuild });
  assert.equal(ok, false);
  assert.ok(failures.some((f) => /threw/.test(f)), `expected a threw failure, got: ${failures.join(" | ")}`);
});

test("the proof needs at least two adapters (a single form proves nothing)", () => {
  const { ok, failures } = proveGenericity({ adapters: ["react"] });
  assert.equal(ok, false);
  assert.ok(failures.some((f) => /at least two/.test(f)));
});
