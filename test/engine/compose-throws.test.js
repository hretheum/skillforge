// CC-13 — a compose that THROWS (synchronously or via a rejected Promise) must propagate as a
// fail-loud error. The executor calls `await compose(...)`, so both a synchronous throw and an async
// rejection surface the same way; runSkill (run.js) catches them, emits a FAIL skill_result, and
// re-throws. This test asserts the executor itself does not swallow the throw — no try/catch around
// compose is needed because the existing structure already propagates it.
//
// Sources: concept + first principles, zero third-party skills-factory files (clean-room).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execute } from "../../src/engine/executor.js";
import { runSkill } from "../../src/engine/run.js";
import { instructionDescriptor } from "../../src/registry/kinds/index.js";

const CLIENTS_DIR = fileURLToPath(new URL("../../clients", import.meta.url));
const REGISTRY = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../skillforge.registry.json", import.meta.url)), "utf8"),
);

function fakeClientContext() {
  return {
    identifier: "fake-client",
    adapters: { input: "fake-input", output: "fake-output" },
    references: { "tokens.json": "{}" },
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

test("CC-13: a synchronous throw in compose propagates out of execute() (not swallowed)", async () => {
  await assert.rejects(
    () =>
      execute({
        descriptor: instructionDescriptor,
        request: {},
        skillName: "fake-skill",
        client: "fake-client",
        compose: () => {
          throw new Error("unexpected token shape");
        },
        deps: deps(),
        loadArgs: {},
        registry,
      }),
    /unexpected token shape/,
  );
});

test("CC-13: an async rejection in compose propagates the same way (await compose)", async () => {
  await assert.rejects(
    () =>
      execute({
        descriptor: instructionDescriptor,
        request: {},
        skillName: "fake-skill",
        client: "fake-client",
        compose: async () => {
          throw new Error("async normaliser failed");
        },
        deps: deps(),
        loadArgs: {},
        registry,
      }),
    /async normaliser failed/,
  );
});

test("CC-13: runSkill emits a FAIL skill_result then re-throws when compose throws", async () => {
  const events = [];
  await assert.rejects(
    () =>
      runSkill({
        clientsDir: CLIENTS_DIR,
        client: "verdex",
        skillName: "verdex-analytics",
        registry: REGISTRY,
        // Inject a compose that throws, bypassing the real recipe, so we exercise the catch path.
        // The real verdex client loads + activates first; the throw happens at the compose stage.
        resolveCompose: () => () => {
          throw new Error("boom in compose");
        },
        skillResultSink: (e) => events.push(e),
      }),
    /boom in compose/,
  );
  assert.equal(events.length, 1, "exactly one skill_result emitted");
  assert.equal(events[0].outcome, "FAIL", "the emitted skill_result marks the run as failed (OBS-04)");
  assert.equal(events[0].skill, "verdex-analytics", "the FAIL event is attributed to the skill");
});
