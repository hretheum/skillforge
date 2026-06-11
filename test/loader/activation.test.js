// Tests for the full activation predicate (T-MVP-11).
//
// Sources: concept + first principles, zero third-party skills-factory files (clean-room).
// docs/06 §Activation: six-conjunct AND; a skill failing ANY single conjunct must NOT
// activate; deny-first, first-failing-gate named.

import { test } from "node:test";
import assert from "node:assert/strict";
import { activate, canActivate, ACTIVATION_GATES } from "../../src/loader/activation.js";
import { isLoaderError } from "../../src/loader/errors.js";
import { defaultAdapterKinds } from "../../src/registry/index.js";

// A registry with a correctly-wired create-component entry (mirrors the real one).
function registry(overrides = {}) {
  return {
    schemaVersion: "1",
    skills: {
      "create-component": {
        version: "0.1.0",
        enabled: true,
        skillKind: "artifact",
        requiredTools: ["Read", "Edit", "Write"],
        sourceKind: "design-system",
        resultKind: "frontend-component",
        requiredAdapters: { input: ["dtcg-tokens"], output: ["react"] },
        scope: { clients: ["*"], projects: ["*"] },
        ...overrides,
      },
    },
  };
}

// A client context as loadClientConfig would return it.
function ctx(overrides = {}) {
  return {
    identifier: "example-studio",
    profile: "compliance",
    skills: ["create-component"],
    ...overrides,
  };
}

const base = () => ({
  skillName: "create-component",
  clientContext: ctx(),
  registry: registry(),
  project: null,
  kinds: defaultAdapterKinds(),
});

// --- all six conjuncts hold ------------------------------------------------

test("activates when every conjunct holds", () => {
  const rec = activate(base());
  assert.equal(rec.skill, "create-component");
  assert.equal(rec.client, "example-studio");
  assert.equal(canActivate(base()), true);
});

// --- conjunct 2: client-has-skill ------------------------------------------

test("does NOT activate when the client has not adopted the skill", () => {
  const args = { ...base(), clientContext: ctx({ skills: [] }) };
  assert.throws(() => activate(args), (e) => isLoaderError(e) && e.gate === ACTIVATION_GATES.CLIENT_HAS_SKILL);
  assert.equal(canActivate(args), false);
});

test("does NOT activate when skills lists a DIFFERENT skill", () => {
  const args = { ...base(), clientContext: ctx({ skills: ["something-else"] }) };
  assert.throws(() => activate(args), (e) => e.gate === ACTIVATION_GATES.CLIENT_HAS_SKILL);
});

// --- conjunct 3: registry-enabled ------------------------------------------

test("does NOT activate when the registry entry is disabled", () => {
  const args = { ...base(), registry: registry({ enabled: false }) };
  assert.throws(() => activate(args), (e) => e.gate === ACTIVATION_GATES.REGISTRY_ENABLED && /disabled/.test(e.message));
});

test("does NOT activate when there is no registry entry", () => {
  const args = { ...base(), registry: { schemaVersion: "1", skills: {} } };
  assert.throws(() => activate(args), (e) => e.gate === ACTIVATION_GATES.REGISTRY_ENABLED && /no registry entry/.test(e.message));
});

// --- conjunct 4: adapters-valid (kind contract) ----------------------------

test("does NOT activate on a result-kind type mismatch", () => {
  const args = { ...base(), registry: registry({ resultKind: "openapi-spec" }) }; // react accepts only frontend-component
  assert.throws(() => activate(args), (e) => e.gate === ACTIVATION_GATES.TYPING && /kind contract/.test(e.message));
});

test("does NOT activate on a source-kind type mismatch", () => {
  const args = { ...base(), registry: registry({ sourceKind: "jira-project" }) };
  assert.throws(() => activate(args), (e) => e.gate === ACTIVATION_GATES.TYPING);
});

test("does NOT activate when the entry declares no skillKind", () => {
  const args = { ...base(), registry: registry({ skillKind: undefined }) };
  assert.throws(
    () => activate(args),
    (e) => e.gate === ACTIVATION_GATES.TYPING && /declares no skillKind/.test(e.message),
  );
});

test("does NOT activate when the entry declares an unknown skillKind", () => {
  const args = { ...base(), registry: registry({ skillKind: "bogus-kind" }) };
  assert.throws(
    () => activate(args),
    (e) => e.gate === ACTIVATION_GATES.TYPING && /unknown skillKind "bogus-kind"/.test(e.message),
  );
});

// --- conjunct 5: scope-permits ---------------------------------------------

test("does NOT activate when the client is out of scope", () => {
  const args = { ...base(), registry: registry({ scope: { clients: ["acme"], projects: ["*"] } }) };
  assert.throws(() => activate(args), (e) => e.gate === ACTIVATION_GATES.SCOPE && /scope\.clients/.test(e.field));
});

test("does NOT activate when the project is out of scope", () => {
  const args = {
    ...base(),
    project: "billing",
    registry: registry({ scope: { clients: ["*"], projects: ["checkout"] } }),
  };
  assert.throws(() => activate(args), (e) => e.gate === ACTIVATION_GATES.SCOPE && /scope\.projects/.test(e.field));
});

test("activates when a narrowed scope admits the (client, project)", () => {
  const args = {
    ...base(),
    clientContext: ctx({ identifier: "acme" }),
    project: "checkout",
    registry: registry({ scope: { clients: ["acme"], projects: ["checkout"] } }),
  };
  // adopt under the acme identity
  args.clientContext.skills = ["create-component"];
  assert.equal(canActivate(args), true);
});

// --- conjunct 6: profile-permits -------------------------------------------

test("does NOT activate when the profile-evaluator denies a required feature", () => {
  const denyEvaluator = { evaluate: (_p, f) => ({ decision: "deny", reason: `${f} forbidden` }) };
  const args = { ...base(), profileEvaluator: denyEvaluator, requiredFeatures: ["files-api"] };
  assert.throws(() => activate(args), (e) => e.gate === ACTIVATION_GATES.PROFILE && /files-api/.test(e.message));
});

test("fails closed when the profile-evaluator throws", () => {
  const throwing = { evaluate: () => { throw new Error("evaluator boom"); } };
  const args = { ...base(), profileEvaluator: throwing, requiredFeatures: ["files-api"] };
  assert.throws(() => activate(args), (e) => e.gate === ACTIVATION_GATES.PROFILE && /fail-closed/.test(e.message));
});

test("fails closed on a malformed verdict", () => {
  const malformed = { evaluate: () => ({ notADecision: true }) };
  const args = { ...base(), profileEvaluator: malformed, requiredFeatures: ["files-api"] };
  assert.throws(() => activate(args), (e) => e.gate === ACTIVATION_GATES.PROFILE && /malformed/.test(e.message));
});

test("activates when the profile-evaluator allows the required features", () => {
  const allowEvaluator = { evaluate: () => ({ decision: "allow" }) };
  const args = { ...base(), profileEvaluator: allowEvaluator, requiredFeatures: ["client-side-skill"] };
  assert.equal(canActivate(args), true);
});

test("no required features → profile conjunct is vacuously satisfied", () => {
  assert.equal(canActivate({ ...base(), requiredFeatures: [] }), true);
});

// --- evaluation order: first-failing gate is named -------------------------

test("when multiple conjuncts fail, the EARLIEST in chain order is reported", () => {
  // client-has-skill (2) fails AND registry disabled (3) fails — expect gate 2 first.
  const args = {
    ...base(),
    clientContext: ctx({ skills: [] }),
    registry: registry({ enabled: false }),
  };
  assert.throws(() => activate(args), (e) => e.gate === ACTIVATION_GATES.CLIENT_HAS_SKILL);
});

// --- recognition (conjunct 1) is the caller's input ------------------------

test("a missing skillName is rejected (recognition is the caller's job)", () => {
  assert.throws(() => activate({ ...base(), skillName: "" }), (e) => isLoaderError(e));
});
