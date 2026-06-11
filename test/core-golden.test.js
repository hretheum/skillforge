// Determinism precondition: a checked-in golden fixture must round-trip and
// re-serialize byte-for-byte. The determinism gate (a separate CI gate)
// byte-diffs the same golden across runs; this test pins it inside the unit
// suite so a non-canonical change to the serializer fails immediately.
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { deserialize, serialize } from "../src/core/index.js";

const goldenPath = fileURLToPath(new URL("./fixtures/golden-description.json", import.meta.url));

test("the golden description re-serializes byte-for-byte (determinism precondition)", () => {
  const golden = readFileSync(goldenPath, "utf8");
  const value = deserialize(golden);
  assert.equal(serialize(value), golden,
    "golden fixture drifted — the canonical serialization changed (a MAJOR contract change)");
});

test("the golden file carries no trailing whitespace / newline churn", () => {
  const golden = readFileSync(goldenPath, "utf8");
  assert.equal(golden, golden.trim(), "golden fixture has incidental surrounding whitespace");
});
