// The loader package surfaces the skill↔adapter typing check (T-MVP-10).
//
// Sources: concept + first principles, zero third-party skills-factory files (clean-room).
// T-MVP-10's DONE criterion: a mistyped pairing fails at START-UP, caught by the loader +
// registry-lint. This pins the loader-surface half: the typing assertion is reachable from
// the loader's public surface and throws on a mismatch (the full activation predicate that
// folds it into loadClientConfig is T-MVP-11).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertSkillAdapterTyping,
  defaultAdapterKinds,
} from "../../src/loader/index.js";

test("loader surface exposes a typing check that passes valid wiring", () => {
  assert.doesNotThrow(() =>
    assertSkillAdapterTyping({
      skillName: "create-component",
      entry: {
        sourceKind: "design-system",
        resultKind: "frontend-component",
        requiredAdapters: { input: ["dtcg-tokens"], output: ["react"] },
      },
      kinds: defaultAdapterKinds(),
    }),
  );
});

test("loader surface typing check throws at start-up on a mistyped pairing", () => {
  assert.throws(
    () =>
      assertSkillAdapterTyping({
        skillName: "create-component",
        entry: {
          // emits a result-kind the wired output adapter (react) does not accept
          resultKind: "openapi-spec",
          requiredAdapters: { input: ["dtcg-tokens"], output: ["react"] },
        },
        kinds: defaultAdapterKinds(),
      }),
    /typing failed/,
  );
});
