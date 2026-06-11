// Tests for the data-driven compose-registry (Phase D /): a skill's registry entry resolves
// to its compose step via the entry's `compose` ref.
//
// Sources: concept + first principles, zero third-party skills-factory files (clean-room).

import { test } from "node:test";
import assert from "node:assert/strict";
import { get, resolveComposeRef } from "../../src/skills/compose-registry.js";
import registry from "../../skillforge.registry.json" with { type: "json" };

const SKILL_ENTRIES = Object.entries(registry.skills);

test("every registered skill resolves to a callable compose step", () => {
  for (const [name, entry] of SKILL_ENTRIES) {
    assert.equal(typeof get(name, entry), "function", `${name} must resolve to a function`);
  }
});

test("get() throws for an unknown / unresolvable skill (fail loud, never a silent recipe)", () => {
  assert.throws(
    () => get("no-such-skill", { compose: "no-such-skill/compose.js#nope" }),
    /no compose step registered for skill "no-such-skill"/,
  );
  assert.throws(() => get("no-ref", {}), /no compose step registered for skill "no-ref"/);
});

test("resolveComposeRef resolves each registry ref to a function", () => {
  for (const [name, entry] of SKILL_ENTRIES) {
    assert.equal(typeof resolveComposeRef(entry.compose), "function", `${name} ref must resolve`);
  }
});

test("resolveComposeRef returns null for an unknown / malformed ref", () => {
  assert.equal(resolveComposeRef("create-component/compose.js#noSuchExport"), null);
  assert.equal(resolveComposeRef("nonsense"), null);
  assert.equal(resolveComposeRef(undefined), null);
  assert.equal(resolveComposeRef(42), null);
});
