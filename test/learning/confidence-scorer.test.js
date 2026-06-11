// Clean-room: concept + first principles, zero third-party skills-factory files.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CONFIDENCE_THRESHOLD,
  scorePattern,
  filterConfident,
} from "../../src/learning/confidence-scorer.js";

test("CONFIDENCE_THRESHOLD is 3", () => {
  assert.equal(CONFIDENCE_THRESHOLD, 3);
});

test("scorePattern below threshold → not confident", () => {
  const r = scorePattern({ patternKey: "s:Read", frequency: 2 });
  assert.equal(r.score, 2);
  assert.equal(r.confident, false);
  assert.match(r.reason, /not yet confident/);
});

test("scorePattern at threshold → confident", () => {
  const r = scorePattern({ patternKey: "s:Read", frequency: 3 });
  assert.equal(r.score, 3);
  assert.equal(r.confident, true);
  assert.match(r.reason, /instinct candidate/);
});

test("scorePattern above threshold → confident", () => {
  const r = scorePattern({ patternKey: "s:Read", frequency: 7 });
  assert.equal(r.confident, true);
});

test("scorePattern tolerates missing/invalid frequency → score 0, not confident", () => {
  assert.equal(scorePattern({}).confident, false);
  assert.equal(scorePattern({ frequency: "nope" }).score, 0);
  assert.equal(scorePattern(null).score, 0);
});

test("filterConfident keeps only confident patterns", () => {
  const patterns = [
    { patternKey: "s:Read", frequency: 3 },
    { patternKey: "s:Write", frequency: 1 },
    { patternKey: "s:Bash", frequency: 5 },
  ];
  const kept = filterConfident(patterns);
  assert.equal(kept.length, 2);
  assert.deepEqual(kept.map((p) => p.patternKey).sort(), ["s:Bash", "s:Read"]);
});

test("filterConfident returns [] for non-array", () => {
  assert.deepEqual(filterConfident(null), []);
});
