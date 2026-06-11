// Tests for skill↔adapter result-kind typing (T-MVP-10).
//
// Sources: concept + first principles, zero third-party skills-factory files (clean-room).
// Covers docs/04 §"Skill↔adapter typing": emitted result-kind ∈ output adapter's accepted
// kinds; consumed source-kind ∈ input adapter's produced kinds; mistyped pairing fails.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createAdapterKinds,
  defaultAdapterKinds,
  checkSkillAdapterTyping,
  typingFactsFromEntry,
  assertSkillAdapterTyping,
} from "../../src/registry/index.js";

// A catalog mirroring the MVP adapters plus a multi-kind adapter for breadth.
function kindsFixture() {
  return createAdapterKinds({
    input: { "dtcg-tokens": ["design-system"], "jira": ["jira-project"] },
    output: { "react": ["frontend-component"], "openapi": ["openapi-spec", "tickets"] },
  });
}

// --- the default catalog derives from the adapters' own constants -----------

test("defaultAdapterKinds reflects the MVP adapters' declared kinds", () => {
  const k = defaultAdapterKinds();
  assert.deepEqual(k.produces("dtcg-tokens"), ["design-system"]);
  assert.deepEqual(k.accepts("react"), ["frontend-component"]);
  assert.equal(k.has("input", "dtcg-tokens"), true);
  assert.equal(k.has("output", "react"), true);
  assert.equal(k.has("output", "no-such"), false);
});

// --- the happy pairing -----------------------------------------------------

test("the create-component wiring type-checks", () => {
  const v = checkSkillAdapterTyping({
    skillName: "create-component",
    sourceKind: "design-system",
    resultKind: "frontend-component",
    inputAdapters: ["dtcg-tokens"],
    outputAdapters: ["react"],
    kinds: kindsFixture(),
  });
  assert.deepEqual(v, []);
});

test("a multi-kind output adapter accepting the result-kind type-checks", () => {
  const v = checkSkillAdapterTyping({
    skillName: "make-tickets",
    resultKind: "tickets",
    outputAdapters: ["openapi"], // openapi accepts [openapi-spec, tickets]
    kinds: kindsFixture(),
  });
  assert.deepEqual(v, []);
});

// --- the mistyped pairings (the core failure modes) ------------------------

test("result-kind not accepted by the output adapter fails", () => {
  const v = checkSkillAdapterTyping({
    skillName: "create-component",
    resultKind: "openapi-spec", // react accepts only frontend-component
    outputAdapters: ["react"],
    kinds: kindsFixture(),
  });
  assert.equal(v.length, 1);
  assert.match(v[0], /result-kind "openapi-spec" is not accepted by output adapter "react"/);
});

test("source-kind not produced by the input adapter fails", () => {
  const v = checkSkillAdapterTyping({
    skillName: "create-component",
    sourceKind: "jira-project", // dtcg-tokens produces only design-system
    inputAdapters: ["dtcg-tokens"],
    kinds: kindsFixture(),
  });
  assert.equal(v.length, 1);
  assert.match(v[0], /source-kind "jira-project" is not produced by input adapter "dtcg-tokens"/);
});

test("a skill emitting a result-kind but wired to no output adapter fails", () => {
  const v = checkSkillAdapterTyping({
    skillName: "orphan",
    resultKind: "frontend-component",
    outputAdapters: [],
    kinds: kindsFixture(),
  });
  assert.ok(v.some((e) => /wired to no output adapter/.test(e)));
});

test("an output adapter with no declared kinds is reported, not silently passed", () => {
  const v = checkSkillAdapterTyping({
    skillName: "create-component",
    resultKind: "frontend-component",
    outputAdapters: ["ghost"], // not in the catalog
    kinds: kindsFixture(),
  });
  assert.ok(v.some((e) => /output adapter "ghost" declares no kinds/.test(e)));
});

// --- a skill that declares no kind for an edge it does not use is fine ------

test("absent source/result kinds are not flagged", () => {
  const v = checkSkillAdapterTyping({
    skillName: "no-input-skill",
    resultKind: "frontend-component",
    outputAdapters: ["react"],
    // no sourceKind, no inputAdapters — a skill with no input edge
    kinds: kindsFixture(),
  });
  assert.deepEqual(v, []);
});

// --- typingFactsFromEntry reads the registry entry shape -------------------

test("typingFactsFromEntry extracts kinds + wired adapters from an entry", () => {
  const facts = typingFactsFromEntry({
    sourceKind: "design-system",
    resultKind: "frontend-component",
    requiredAdapters: { input: ["dtcg-tokens"], output: ["react"] },
  });
  assert.deepEqual(facts, {
    sourceKind: "design-system",
    resultKind: "frontend-component",
    inputAdapters: ["dtcg-tokens"],
    outputAdapters: ["react"],
  });
});

test("typingFactsFromEntry tolerates a missing requiredAdapters / kinds", () => {
  const facts = typingFactsFromEntry({});
  assert.deepEqual(facts, {
    sourceKind: null,
    resultKind: null,
    inputAdapters: [],
    outputAdapters: [],
  });
});

// --- assertSkillAdapterTyping throws on a mismatch -------------------------

test("assertSkillAdapterTyping passes a valid entry", () => {
  assert.doesNotThrow(() =>
    assertSkillAdapterTyping({
      skillName: "create-component",
      entry: {
        sourceKind: "design-system",
        resultKind: "frontend-component",
        requiredAdapters: { input: ["dtcg-tokens"], output: ["react"] },
      },
      kinds: kindsFixture(),
    }),
  );
});

test("assertSkillAdapterTyping throws (start-up failure) on a mistyped entry", () => {
  assert.throws(
    () =>
      assertSkillAdapterTyping({
        skillName: "create-component",
        entry: {
          resultKind: "openapi-spec",
          requiredAdapters: { input: [], output: ["react"] },
        },
        kinds: kindsFixture(),
      }),
    (err) => {
      assert.match(err.message, /skill↔adapter typing failed for "create-component"/);
      assert.ok(Array.isArray(err.violations) && err.violations.length >= 1);
      return true;
    },
  );
});

// --- the real registry entry type-checks against the real catalog ----------

test("the checked-in create-component entry type-checks against defaultAdapterKinds", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const registryPath = fileURLToPath(new URL("../../skillforge.registry.json", import.meta.url));
  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  assert.doesNotThrow(() =>
    assertSkillAdapterTyping({
      skillName: "create-component",
      entry: registry.skills["create-component"],
      kinds: defaultAdapterKinds(),
    }),
  );
});
