// Tests for registry-lint's adapter-contract version-pin check (T-P4-02).
//
// Sources: concept + first principles, zero third-party skills-factory files (clean-room).
// Covers docs/12 §registry-lint + docs/04 §registry (API-06): a skill's requiredAdapters ref
// may PIN the adapter-contract version; registry-lint checks the catalog satisfies the pin and
// is backward-compatible with the bare-name (no-pin) shape.

import { test } from "node:test";
import assert from "node:assert/strict";
import { lintRegistry } from "../tools/registry-lint.js";
import { defaultAdapterRegistry } from "../src/loader/adapter-registry.js";

const ALLOWLIST = { allowed: ["Read", "Edit", "Write"] };
const PROOF = ["react", "web-components"];
const allGoldensExist = () => true;

// A registry whose create-component pins its adapter versions via the `{ name, version }` shape.
function pinnedRegistry(inputRef, outputRef) {
  return {
    schemaVersion: "1",
    skills: {
      "create-component": {
        version: "0.1.0",
        enabled: true,
        owner: "platform",
        skillKind: "artifact",
        compose: "create-component/compose.js#composeComponent",
        requiredTools: ["Read", "Edit", "Write"],
        sourceKind: "design-system",
        resultKind: "frontend-component",
        requiredAdapters: { input: [inputRef], output: [outputRef] },
        requiredSecrets: [],
        scope: { clients: ["*"], projects: ["*"] },
        model: "inherit",
        effort: "medium",
      },
    },
  };
}

function lint(registry) {
  return lintRegistry({
    registry,
    allowlist: ALLOWLIST,
    adapterRegistry: defaultAdapterRegistry(), // dtcg-tokens@1.0.0, react@1.0.0
    skillDirs: ["create-component"],
    proofAdapters: PROOF,
    goldenExists: allGoldensExist,
  });
}

// --- backward-compatible: a bare-name ref (no pin) lints clean --------------

test("a bare-name requiredAdapters ref (no version pin) lints clean", () => {
  assert.deepEqual(lint(pinnedRegistry("dtcg-tokens", "react")), []);
});

// --- a compatible pin lints clean ------------------------------------------

test("a compatible adapter-contract pin lints clean", () => {
  const reg = pinnedRegistry(
    { name: "dtcg-tokens", version: "1.0.0" },
    { name: "react", version: "1.0.0" },
  );
  assert.deepEqual(lint(reg), []);
});

// --- an incompatible pin FAILS ---------------------------------------------

test("a pin the catalog cannot satisfy (MAJOR mismatch) FAILS the lint", () => {
  const reg = pinnedRegistry("dtcg-tokens", { name: "react", version: "2.0.0" });
  const errs = lint(reg);
  assert.ok(
    errs.some((e) => /output adapter "react" version 1\.0\.0 does not satisfy the config's pin "2\.0\.0"/.test(e)),
    errs.join("\n"),
  );
});

test("a pin for a newer minor than the catalog ships FAILS the lint", () => {
  const reg = pinnedRegistry({ name: "dtcg-tokens", version: "1.5.0" }, "react");
  const errs = lint(reg);
  assert.ok(
    errs.some((e) => /input adapter "dtcg-tokens" version 1\.0\.0 does not satisfy the config's pin "1\.5\.0"/.test(e)),
    errs.join("\n"),
  );
});

// --- a pinned-but-UNKNOWN adapter still reports "unknown" -------------------

test("a pinned ref to an unknown adapter reports unknown (existence before version)", () => {
  const reg = pinnedRegistry({ name: "no-such-reader", version: "1.0.0" }, "react");
  const errs = lint(reg);
  assert.ok(errs.some((e) => /unknown input adapter "no-such-reader"/.test(e)), errs.join("\n"));
});

// --- the kind-typing check still works on a pinned (object) ref -------------

test("kind-typing still applies to a pinned ref (name reduced first)", () => {
  // dtcg-tokens produces design-system; pin the skill to a source-kind it cannot read.
  const reg = pinnedRegistry({ name: "dtcg-tokens", version: "1.0.0" }, "react");
  reg.skills["create-component"].sourceKind = "jira-project";
  const errs = lint(reg);
  assert.ok(
    errs.some((e) => /source-kind "jira-project" is not produced by input adapter "dtcg-tokens"/.test(e)),
    errs.join("\n"),
  );
});
