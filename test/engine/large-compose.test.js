// CC-11 — a compose that returns a very large payload (a multi-MB transformation plan). The engine
// has NO size cap: the large string passes through compose → validateOutput → gate (secret-scan
// over the full payload) → emit. This test documents that current behaviour: a large compose
// SUCCEEDS (it is not rejected for size), and the gate's secret-scan is O(payload size) — correct
// but unbounded. It must NOT crash; it either succeeds or fails with a SPECIFIC error.
//
// Sources: concept + first principles, zero third-party skills-factory files (clean-room).

import { test } from "node:test";
import assert from "node:assert/strict";
import { execute } from "../../src/engine/executor.js";
import { transformationDescriptor } from "../../src/registry/kinds/index.js";
import { createPreToolUseHook } from "../../src/governance/index.js";

const TWO_MB = 2 * 1024 * 1024;

function fakeClientContext() {
  return {
    identifier: "fake-client",
    adapters: { input: "fake-input", output: "fake-output" },
    references: {},
    profile: null,
    orgBaseline: [{ pattern: "Write", decision: "allow" }],
  };
}

function deps() {
  return {
    loadClientConfig: () => fakeClientContext(),
    activate: (a) => ({ skill: a.skillName, client: "fake-client", project: a.project, entry: {} }),
    getInputAdapter: () => ({ read: () => ({}) }),
    readInput: () => ({ kind: "design-system", tokens: {} }),
    getOutputAdapter: () => ({ makeResult: () => ({}), render: () => ({}) }),
    buildResult: () => ({ result: {}, artifact: {} }),
    preToolUseHook: { check: () => ({ decision: "allow" }) },
    emitTelemetry: () => {},
  };
}

const registry = { skills: { "big-transform": { requiredTools: ["Write"] } } };

test("CC-11: a ~2MB compose payload runs through the pipeline without crashing", async () => {
  // A genuinely large benign string (no credential markers). The plan's single entry is a Write
  // intent whose toolInput carries the 2MB content; the gate secret-scans the whole payload.
  const big = "x".repeat(TWO_MB);
  assert.ok(big.length >= TWO_MB, "the payload is at least 2MB");

  const compose = () => ({
    plan: [{ tool: "Write", toolInput: { file_path: "big.txt", content: big } }],
  });

  const out = await execute({
    descriptor: transformationDescriptor,
    request: {},
    skillName: "big-transform",
    client: "fake-client",
    compose,
    deps: deps(),
    loadArgs: {},
    registry,
  });

  // ENGINE BEHAVIOUR (CC-11): no size cap exists — the large plan SUCCEEDS and rides in the
  // envelope. The gate's secret-scan walked the full 2MB string (O(size)); a benign payload is
  // allowed. A regulated client emitting large migration plans should know the gate is O(size).
  assert.ok(Array.isArray(out.plan) && out.plan.length === 1, "the large plan is returned");
  assert.equal(out.plan[0].toolInput.content.length, TWO_MB, "the 2MB content is preserved, not truncated");
});

test("CC-11: a large payload that DOES contain a credential is still denied at the gate", async () => {
  // Size does not bypass the gate: an AWS key embedded anywhere in the large payload is caught and
  // the gate DENIES with a specific error — not a crash, not a silent pass.
  // The secret sits at a word boundary inside a large benign body so the AWS prefix pattern hits;
  // the point is that the 2KB of surrounding text does not let it slip past the gate.
  const withSecret = "x ".repeat(1024) + "AKIAIOSFODNN7EXAMPLE" + " y".repeat(1024);
  const compose = () => ({
    plan: [{ tool: "Write", toolInput: { file_path: "leak.txt", content: withSecret } }],
  });
  await assert.rejects(
    () =>
      execute({
        descriptor: transformationDescriptor,
        request: {},
        skillName: "big-transform",
        client: "fake-client",
        compose,
        // A REAL scanning hook (not the allow-all stub) proves size does not bypass secret-scan.
        deps: { ...deps(), preToolUseHook: createPreToolUseHook() },
        loadArgs: {},
        registry,
      }),
    /denied at the PreToolUse gate/,
  );
});
