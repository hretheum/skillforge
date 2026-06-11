// Tests for hardened-tier ↔ base-layer agreement (T-HARD-06, closes GOV-04).
//
// Sources: concept + first principles, zero files from any third-party skills-factory codebase
// (clean-room). Covers docs/13 §"The two seams must agree (GOV-04)":
//   the managed-settings projection must be DENY-EQUIVALENT-OR-STRICTER than the resolver, never
//   looser. The two forbidden drifts are managed-allow over a resolver-deny, and managed-allow
//   over a resolver-ask. A managed deny is always safe; an unmentioned tool is no drift.
//
// Proven against (a) crafted contexts and (b) the REAL Claude-flavour emit of the shipped
// create-component skill — so the check binds the actual projection, not only synthetic input.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  checkHardenedAgreement,
  checkEmittedHardenedAgreement,
  verifySourceHash,
  checkAgreementMarker,
  DECISION,
} from "../../src/governance/index.js";
import { contentHash } from "../../src/core/content-hash.js";
import { emit, EMIT_PROFILES } from "../../src/emit/index.js";

const managed = (allow = [], ask = [], deny = []) => ({ permissions: { allow, ask, deny } });

// =====================================================================================
// Crafted contexts — the invariant's four corners
// =====================================================================================

test("PASS: managed allow == resolver allow (the layers grant the projected tools)", () => {
  const v = checkHardenedAgreement({
    managedSettings: managed(["Skill(s)", "mcp__tracker__*", "Read"]),
    requiredTools: ["mcp__tracker__*", "Read"],
    layers: {
      org: [
        { pattern: "mcp__tracker__*", decision: DECISION.ALLOW },
        { pattern: "Read", decision: DECISION.ALLOW },
      ],
    },
  });
  assert.deepEqual(v, []);
});

test("DRIFT: managed allow over a resolver DENY (no layer grants the projected tool) is flagged", () => {
  // The default emit projects allow:[...requiredTools] with NO affirmative org/client/project
  // grant — so the resolver DENIES (silence). The managed allow is looser → the GOV-04 drift.
  const v = checkHardenedAgreement({
    managedSettings: managed(["Skill(s)", "Read"]),
    requiredTools: ["Read"],
    layers: {}, // nothing grants Read → resolver denies
  });
  assert.equal(v.length, 1);
  assert.match(v[0], /drift on tool "Read".*managed=allow is LOOSER than resolver=deny/);
});

test("DRIFT: managed ALLOW where the resolver only ASKS is flagged (allow is looser than ask)", () => {
  const v = checkHardenedAgreement({
    managedSettings: managed(["Skill(s)", "Read"]),
    requiredTools: ["Read"],
    layers: { org: [{ pattern: "Read", decision: DECISION.ASK }] },
  });
  assert.equal(v.length, 1);
  assert.match(v[0], /managed=allow is LOOSER than resolver=ask/);
});

test("PASS: a managed DENY is always safe (stricter-or-equal) even when the resolver allows", () => {
  const v = checkHardenedAgreement({
    managedSettings: managed(["Skill(s)"], [], ["mcp__tracker__delete"]),
    requiredTools: ["*"],
    layers: { org: [{ pattern: "*", decision: DECISION.ALLOW }] },
  });
  assert.deepEqual(v, []);
});

test("PASS: a managed ASK over a resolver ALLOW is stricter, not looser → no drift", () => {
  const v = checkHardenedAgreement({
    managedSettings: managed(["Skill(s)"], ["Read"], []),
    requiredTools: ["Read"],
    layers: { org: [{ pattern: "Read", decision: DECISION.ALLOW }] },
  });
  assert.deepEqual(v, []);
});

test("no drift for a tool the managed settings do not mention (governed by the resolver alone)", () => {
  // managed mentions only Read; the resolver may deny SomethingElse — but managed says nothing
  // about it, so there is no managed rule that could be looser. No violation.
  const v = checkHardenedAgreement({
    managedSettings: managed(["Skill(s)", "Read"]),
    requiredTools: ["Read"],
    layers: { org: [{ pattern: "Read", decision: DECISION.ALLOW }] },
  });
  assert.deepEqual(v, []);
});

test("a same-layer specific resolver DENY under a broad managed allow is caught at the exact tool", () => {
  // managed allows the whole mcp__fs__* family; the resolver allows the family but DENIES one
  // member (mcp__fs__delete). The broad managed allow is looser for that member → flagged.
  const v = checkHardenedAgreement({
    managedSettings: managed(["Skill(s)", "mcp__fs__*"]),
    requiredTools: ["mcp__fs__*"],
    layers: {
      org: [
        { pattern: "mcp__fs__*", decision: DECISION.ALLOW },
        { pattern: "mcp__fs__delete", decision: DECISION.DENY },
      ],
    },
  });
  assert.ok(v.some((m) => /mcp__fs__delete.*LOOSER than resolver=deny/.test(m)), v.join("\n"));
});

test("Layer 0 floor: under COMPLIANCE a managed allow of a server-side tool is flagged (resolver denies)", () => {
  const v = checkHardenedAgreement({
    profile: "compliance",
    managedSettings: managed(["Skill(s)", "WebFetch"]),
    requiredTools: ["WebFetch"],
    layers: { org: [{ pattern: "WebFetch", decision: DECISION.ALLOW }] },
  });
  assert.ok(v.some((m) => /WebFetch.*LOOSER than resolver=deny/.test(m)), v.join("\n"));
});

test("Skill(...) entries are skill-firing rules, not tools — they are not treated as tool drift", () => {
  // managed allow carries ONLY Skill(s); there are no tool patterns, so no tool can be looser.
  const v = checkHardenedAgreement({ managedSettings: managed(["Skill(s)"]), requiredTools: [], layers: {} });
  assert.deepEqual(v, []);
});

test("malformed managed settings (no permissions) are reported", () => {
  assert.deepEqual(checkHardenedAgreement({ managedSettings: {} }), [
    "managed settings missing a `permissions` object",
  ]);
});

// =====================================================================================
// Against the REAL Claude-flavour emit of the shipped skill
// =====================================================================================

const SKILL_TEXT = readFileSync(
  fileURLToPath(new URL("../../skills/create-component/SKILL.md", import.meta.url)),
  "utf8",
);
const REGISTRY = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../skillforge.registry.json", import.meta.url)), "utf8"),
);
const ENTRY = REGISTRY.skills["create-component"];

test("the REAL emit AGREES with the resolver when the org layer grants the skill's requiredTools", () => {
  // Build the governance context the deployment WOULD run: an org baseline that allows exactly
  // the tools the registry declares (the affirmative grant the resolver requires). The managed
  // projection (allow:[...requiredTools]) then equals the resolver's allow → no drift.
  const result = emit({ skillText: SKILL_TEXT, profile: EMIT_PROFILES.CLAUDE, registryEntry: ENTRY });
  const orgGrant = (ENTRY.requiredTools ?? []).map((p) => ({ pattern: p, decision: DECISION.ALLOW }));
  const v = checkEmittedHardenedAgreement({
    emitResult: result,
    name: "create-component",
    requiredTools: ENTRY.requiredTools,
    layers: { org: orgGrant },
  });
  assert.deepEqual(v, [], v.join("\n"));
});

test("the REAL emit DRIFTS from the resolver when NO layer grants the projected tools (GOV-04 made visible)", () => {
  // Same projection, but the governance context grants nothing: the resolver denies every
  // declared tool (silence = deny), so the managed allow is looser. This is the exact GOV-04
  // hazard the check exists to surface — a managed allow that no resolver rule backs.
  const result = emit({ skillText: SKILL_TEXT, profile: EMIT_PROFILES.CLAUDE, registryEntry: ENTRY });
  const v = checkEmittedHardenedAgreement({
    emitResult: result,
    name: "create-component",
    requiredTools: ENTRY.requiredTools,
    layers: {}, // no grant
  });
  assert.ok(v.length > 0, "expected the unbacked managed allow to be flagged as looser than the resolver deny");
  assert.ok(v.every((m) => /LOOSER than resolver=deny/.test(m)), v.join("\n"));
});

test("checkEmittedHardenedAgreement reports a missing managed companion (flavour not applied)", () => {
  const openCore = emit({ skillText: SKILL_TEXT, profile: EMIT_PROFILES.OPEN_CORE });
  const v = checkEmittedHardenedAgreement({ emitResult: openCore, name: "create-component", layers: {} });
  assert.equal(v.length, 1);
  assert.match(v[0], /no managed\/create-component\.settings\.json/);
});

// =====================================================================================
//: agreement marker (AC1) + source content-hash integrity (AC2+AC3)
// =====================================================================================

test("checkAgreementMarker: ok for an adapter that declares hardenedAgreement:true", () => {
  assert.deepEqual(checkAgreementMarker({ hardenedAgreement: true }), { ok: true });
});

test("checkAgreementMarker: blocks null / missing / false (fail-closed)", () => {
  assert.deepEqual(checkAgreementMarker(null), { ok: false, reason: "missing-agreement-marker" });
  assert.deepEqual(checkAgreementMarker(undefined), { ok: false, reason: "missing-agreement-marker" });
  assert.deepEqual(checkAgreementMarker({}), { ok: false, reason: "missing-agreement-marker" });
  assert.deepEqual(checkAgreementMarker({ hardenedAgreement: false }), {
    ok: false,
    reason: "missing-agreement-marker",
  });
});

test("verifySourceHash: ok when the computed hash matches the declared hash", () => {
  const source = "manifest: hardened skill\nversion: 1\n";
  const expected = contentHash(source);
  assert.deepEqual(verifySourceHash(source, expected), {
    ok: true,
    reason: "hash-match",
    hash: expected,
  });
});

test("verifySourceHash: hash-mismatch when the declared hash is wrong (carries both hashes)", () => {
  const source = "manifest: hardened skill\nversion: 1\n";
  const wrong = contentHash("a different source");
  const v = verifySourceHash(source, wrong);
  assert.equal(v.ok, false);
  assert.equal(v.reason, "hash-mismatch");
  assert.equal(v.expected, wrong);
  assert.equal(v.computed, contentHash(source));
});

test("verifySourceHash: invalid-source for null / non-string source (fail-closed)", () => {
  assert.deepEqual(verifySourceHash(null, contentHash("x")), { ok: false, reason: "invalid-source" });
  assert.deepEqual(verifySourceHash(42, contentHash("x")), { ok: false, reason: "invalid-source" });
});

test("verifySourceHash: invalid-expected-hash for null / non-string expected hash (fail-closed)", () => {
  assert.deepEqual(verifySourceHash("some source", null), { ok: false, reason: "invalid-expected-hash" });
  assert.deepEqual(verifySourceHash("some source", 123), { ok: false, reason: "invalid-expected-hash" });
});
