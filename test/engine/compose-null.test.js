// CC-10 — a compose that returns null/undefined must FAIL LOUD at the source, before validateOutput
// (which may itself dereference a field and throw an opaque TypeError on null) and before build/gate.
//
// Sources: concept + first principles, zero third-party skills-factory files (clean-room).

import { test } from "node:test";
import assert from "node:assert/strict";
import { execute } from "../../src/engine/executor.js";
import { artifactDescriptor, instructionDescriptor } from "../../src/registry/kinds/index.js";

function fakeClientContext() {
  return {
    identifier: "fake-client",
    adapters: { input: "fake-input", output: "fake-output" },
    references: { "tokens.json": "{}" },
    profile: null,
    skillParameters: { componentOutputDir: "out" },
  };
}

function deps() {
  return {
    loadClientConfig: () => fakeClientContext(),
    activate: (a) => ({ skill: a.skillName, client: "fake-client", project: a.project, entry: {} }),
    getInputAdapter: () => ({ read: () => ({ payload: "ds" }) }),
    readInput: () => ({ kind: "design-system", tokens: {} }),
    resolveRefs: (r) => r,
    getOutputAdapter: () => ({ makeResult: () => ({}), render: () => ({}) }),
    buildResult: () => ({ result: {}, artifact: {} }),
    preToolUseHook: { check: () => ({ decision: "allow" }) },
    emitTelemetry: () => {},
  };
}

const registry = { skills: { "fake-skill": { requiredTools: ["Write"] } } };

test("CC-10: compose returning null throws a clear error before build/gate", async () => {
  await assert.rejects(
    () =>
      execute({
        descriptor: artifactDescriptor,
        request: {},
        skillName: "fake-skill",
        client: "fake-client",
        compose: () => null,
        deps: deps(),
        loadArgs: {},
        registry,
      }),
    /compose\(\) returned null for skill "fake-skill" — a skill must return a non-null string or object/,
  );
});

test("CC-10: compose returning undefined throws the same clear error", async () => {
  await assert.rejects(
    () =>
      execute({
        descriptor: instructionDescriptor,
        request: {},
        skillName: "fake-skill",
        client: "fake-client",
        compose: () => undefined,
        deps: deps(),
        loadArgs: {},
        registry,
      }),
    /compose\(\) returned undefined for skill "fake-skill" — a skill must return a non-null string or object/,
  );
});

test("CC-10: the null-check fires BEFORE the kind's validateOutput (no opaque TypeError)", async () => {
  // A descriptor whose validateOutput would throw on null (dereferences a field). The engine's own
  // null-check must intercept first, so the error is the clear CC-10 message, not "Cannot read
  // properties of null".
  const throwsOnNull = Object.freeze({
    ...instructionDescriptor,
    compose: { inputSource: "references", validateOutput: (o) => (o.instructions ? [] : ["bad"]) },
  });
  await assert.rejects(
    () =>
      execute({
        descriptor: throwsOnNull,
        request: {},
        skillName: "fake-skill",
        client: "fake-client",
        compose: () => null,
        deps: deps(),
        loadArgs: {},
        registry,
      }),
    /compose\(\) returned null/,
  );
});
