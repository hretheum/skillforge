// Clean-room: concept + first principles, zero third-party skills-factory files.
import { test } from "node:test";
import assert from "node:assert/strict";

import { createObserver, minePatterns } from "../../src/learning/observer.js";

function entry(skill, tool, at) {
  return { skill, tool, decision: "allow", at, client: null, project: null };
}

test("observe + flush: accumulates observations then drains and resets", () => {
  const obs = createObserver();
  obs.observe(entry("s", "Read", "t1"));
  obs.observe(entry("s", "Write", "t2"));
  assert.equal(obs.observations().length, 2);

  const drained = obs.flush();
  assert.equal(drained.length, 2);
  assert.equal(obs.observations().length, 0, "buffer is reset after flush");
});

test("observe ignores governance decisions (only allowed tool uses buffer)", () => {
  const obs = createObserver();
  obs.observe({ skill: "s", tool: "Bash", decision: "deny", at: "t1" });
  assert.equal(obs.observations().length, 0);
});

test("observations() returns a snapshot copy, not the live buffer", () => {
  const obs = createObserver();
  obs.observe(entry("s", "Read", "t1"));
  const snap = obs.observations();
  snap.push("tamper");
  assert.equal(obs.observations().length, 1, "mutating the snapshot does not alter the buffer");
});

test("minePatterns groups by (skill, tool) and counts frequency", () => {
  const observations = [
    { event: "tool_use", skillName: "s", toolName: "Read", decision: "allow", timestamp: "t1" },
    { event: "tool_use", skillName: "s", toolName: "Read", decision: "allow", timestamp: "t2" },
    { event: "tool_use", skillName: "s", toolName: "Write", decision: "allow", timestamp: "t3" },
  ];
  const patterns = minePatterns(observations);
  assert.equal(patterns.length, 2);

  const read = patterns.find((p) => p.patternKey === "s:Read");
  assert.equal(read.frequency, 2);
  assert.equal(read.evidence.length, 2);
  assert.equal(read.skillName, "s");

  const write = patterns.find((p) => p.patternKey === "s:Write");
  assert.equal(write.frequency, 1);
});

test("minePatterns returns [] for non-array / skips malformed observations", () => {
  assert.deepEqual(minePatterns(null), []);
  assert.deepEqual(minePatterns([{ skillName: "", toolName: "Read" }, null]), []);
});
