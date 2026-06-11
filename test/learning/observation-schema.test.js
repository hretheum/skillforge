// Clean-room: concept + first principles, zero third-party skills-factory files.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  OBSERVATION_EVENT,
  OBSERVATION_SCHEMA,
  extractObservations,
} from "../../src/learning/observation-schema.js";

function entry({ skill, tool, decision, at }) {
  return { skill, tool, decision, at, client: null, project: null };
}

test("extractObservations projects allowed tool uses onto the learner stream", () => {
  const entries = [
    entry({ skill: "brand-discovery", tool: "Read", decision: "allow", at: "2026-06-10T10:00:00Z" }),
    entry({ skill: "brand-discovery", tool: "Write", decision: "allow", at: "2026-06-10T10:01:00Z" }),
  ];
  const obs = extractObservations(entries);
  assert.equal(obs.length, 2);
  assert.equal(obs[0].event, OBSERVATION_EVENT.TOOL_USE);
  assert.equal(obs[0].skillName, "brand-discovery");
  assert.equal(obs[0].toolName, "Read");
  assert.equal(obs[0].decision, "allow");
  assert.equal(obs[0].timestamp, "2026-06-10T10:00:00Z");
});

test("extractObservations returns [] for empty / non-array input", () => {
  assert.deepEqual(extractObservations([]), []);
  assert.deepEqual(extractObservations(null), []);
  assert.deepEqual(extractObservations(undefined), []);
  assert.deepEqual(extractObservations("nope"), []);
});

test("extractObservations filters governance decisions (ask/deny) — learns only from what worked", () => {
  const entries = [
    entry({ skill: "s", tool: "Bash", decision: "deny", at: "t1" }),
    entry({ skill: "s", tool: "Bash", decision: "ask", at: "t2" }),
    entry({ skill: "s", tool: "Bash", decision: "allow", at: "t3" }),
  ];
  const obs = extractObservations(entries);
  assert.equal(obs.length, 1);
  assert.equal(obs[0].decision, "allow");
});

test("extractObservations drops entries lacking a usable skill or tool name", () => {
  const entries = [
    entry({ skill: "", tool: "Read", decision: "allow", at: "t1" }),
    entry({ skill: "s", tool: "", decision: "allow", at: "t2" }),
    { decision: "allow", at: "t3" },
  ];
  assert.deepEqual(extractObservations(entries), []);
});

test("OBSERVATION_EVENT and OBSERVATION_SCHEMA are frozen descriptors", () => {
  assert.ok(Object.isFrozen(OBSERVATION_EVENT));
  assert.ok(Object.isFrozen(OBSERVATION_SCHEMA));
  assert.equal(OBSERVATION_EVENT.TOOL_USE, "tool_use");
});
