// CC-14 — compose returns an intentionally EMPTY value. DECISION (documented in executor.js): the
// engine rejects ABSENT output (null/undefined, CC-10) but NOT deliberately-empty output. Whether ""
// is acceptable is the per-KIND compose contract's call — "intentionally empty" is a real regulated
// case (a jurisdiction with no disclosure requirement) and must not be conflated with "compose
// failed". This test pins each kind's contract decision:
//   • instruction: {instructions: ""} is VALID (validateOutput checks `typeof === "string"`).
//   • analysis: {report: ""} is REJECTED — its contract requires a truthy report field, so an empty
//     string is a contract violation, the loud signal that the report was not assembled.
//
// Sources: concept + first principles, zero third-party skills-factory files (clean-room).

import { test } from "node:test";
import assert from "node:assert/strict";
import { execute } from "../../src/engine/executor.js";
import { instructionDescriptor, analysisDescriptor } from "../../src/registry/kinds/index.js";

function fakeClientContext() {
  return {
    identifier: "fake-client",
    adapters: { input: "fake-input", output: "fake-output" },
    references: {},
    profile: null,
  };
}

function deps() {
  return {
    loadClientConfig: () => fakeClientContext(),
    activate: (a) => ({ skill: a.skillName, client: "fake-client", project: a.project, entry: {} }),
    resolveRefs: (r) => r,
    emitTelemetry: () => {},
  };
}

const registry = { skills: { "fake-skill": { requiredTools: [] } } };

test("CC-14: an instruction kind ACCEPTS {instructions: ''} (intentionally empty is valid)", async () => {
  const out = await execute({
    descriptor: instructionDescriptor,
    request: {},
    skillName: "fake-skill",
    client: "fake-client",
    compose: () => ({ instructions: "" }),
    deps: deps(),
    loadArgs: {},
    registry,
  });
  assert.equal(out.instructions, "", "an empty instruction is a valid, deliberate output");
});

test("CC-14: an analysis kind REJECTS {report: ''} (its contract requires a truthy report)", async () => {
  await assert.rejects(
    () =>
      execute({
        descriptor: analysisDescriptor,
        request: {},
        skillName: "fake-skill",
        client: "fake-client",
        compose: () => ({ report: "" }),
        deps: deps(),
        loadArgs: {},
        registry,
      }),
    /violates its kind contract/,
    "an empty report is a contract violation — analysis must assemble a report",
  );
});

test("CC-14: '' is NOT confused with null — the engine's own null-check does not fire on ''", async () => {
  // The CC-10 null-check is for ABSENT output only; "" passes it and reaches validateOutput, which
  // is where the per-kind decision is made. Proven by the instruction case above succeeding (no
  // "compose() returned null" error).
  const out = await execute({
    descriptor: instructionDescriptor,
    request: {},
    skillName: "fake-skill",
    client: "fake-client",
    compose: () => ({ instructions: "" }),
    deps: deps(),
    loadArgs: {},
    registry,
  });
  assert.equal(typeof out.instructions, "string");
});
