// Tests for the PostToolUse audit trail — tamper-evidence + scope (T-HARD-05, GOV-06).
//
// Sources: concept + first principles, zero files from any third-party skills-factory codebase
// (clean-room). Covers docs/13 §"Audit-trail integrity and scope (GOV-06)":
//   - entry shape + secret-free fail-closed (records names + decision, never values);
//   - append-only integrity (no edit/delete/reorder path; frozen entries; copy on read);
//   - tamper-evidence (hash chain + seq) — an edited / deleted / reordered entry is DETECTED;
//   - scope (every entry carries (client, project); filterable; no co-mingling);
//   - the honest boundary recorded as behavior (allow|ask|deny only; defer is never recordable).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AuditTrail,
  makeAuditEntry,
  AUDIT_EVENT,
  GENESIS_PREV,
  DECISION,
  hasSecret,
} from "../../src/governance/index.js";

const BASE = { tool: "mcp__tracker__create", decision: DECISION.ALLOW, skill: "create-component", at: "2026-06-06T00:00:00.000Z" };

// Build a long, mixed-case, high-entropy token-shaped string AT RUNTIME (never a source literal),
// so this file plants NO credential-shaped value in the tracked tree (the secret-scan gate stays
// green on it) while still exercising a REAL refusal. Same clean-room pattern as
// test/core-telemetry.test.js §makeFlaggableTokenShapedValue. The shape — length, three character
// classes, high entropy — is what the secret-scan heuristic keys on; the bytes are deterministic.
function makeFlaggableTokenShapedValue() {
  const lowers = "abcdefghijklmnopqrstuvwxyz";
  const uppers = lowers.toUpperCase();
  const digits = "0123456789";
  let out = "";
  for (let i = 0; i < 14; i++) {
    out += lowers[(i * 7 + 3) % 26];
    out += uppers[(i * 5 + 1) % 26];
    out += digits[(i * 3) % 10];
  }
  return out; // 42 chars, all three classes, high entropy → token-shaped, NOT a real secret
}

// =====================================================================================
// Entry shape + validation + secret-free (fail-closed)
// =====================================================================================

test("makeAuditEntry builds a secret-free fact carrying name + decision + scope", () => {
  const e = makeAuditEntry({ ...BASE, client: "example-studio", project: "site" });
  assert.equal(e.event, AUDIT_EVENT);
  assert.equal(e.hookEventName, "PostToolUse");
  assert.equal(e.tool, "mcp__tracker__create");
  assert.equal(e.decision, DECISION.ALLOW);
  assert.equal(e.skill, "create-component");
  assert.equal(e.client, "example-studio");
  assert.equal(e.project, "site");
  assert.equal(e.at, BASE.at);
});

test("makeAuditEntry rejects defer and any non-terminal decision (defer is internal-only)", () => {
  assert.throws(() => makeAuditEntry({ ...BASE, decision: DECISION.DEFER }), /allow\|ask\|deny/);
  assert.throws(() => makeAuditEntry({ ...BASE, decision: "maybe" }), /allow\|ask\|deny/);
});

test("makeAuditEntry rejects missing tool / skill", () => {
  assert.throws(() => makeAuditEntry({ ...BASE, tool: "" }), /tool/);
  assert.throws(() => makeAuditEntry({ ...BASE, skill: undefined }), /skill/);
});

test("makeAuditEntry is fail-closed on a credential-shaped value (secret-free trail)", () => {
  // A token sneaked into a scope handle must be refused — the trail records names, never secrets.
  // The value is SYNTHESIZED at runtime (no literal in source) so the secret-scan gate stays green
  // on this file; we first assert it is genuinely flaggable so the refusal test is not a tautology.
  const secretish = makeFlaggableTokenShapedValue();
  assert.ok(hasSecret(secretish), "guard: the synthesized value must be one secret-scan actually flags");
  assert.throws(
    () => makeAuditEntry({ ...BASE, client: secretish }),
    /credential-shaped/,
  );
});

test("makeAuditEntry defaults `at` to an ISO timestamp when omitted", () => {
  const { at, ...noAt } = BASE;
  const e = makeAuditEntry(noAt);
  assert.match(e.at, /^\d{4}-\d{2}-\d{2}T/);
});

// =====================================================================================
// record() — append-only + chain assembly
// =====================================================================================

test("record() appends frozen, sequenced, chain-linked entries", () => {
  const t = new AuditTrail();
  assert.equal(t.length, 0);
  assert.equal(t.headHash, GENESIS_PREV);

  const a = t.record({ ...BASE, client: "c1", project: "p1" });
  const b = t.record({ ...BASE, decision: DECISION.DENY, client: "c1", project: "p1" });

  assert.equal(t.length, 2);
  assert.equal(a.seq, 0);
  assert.equal(b.seq, 1);
  assert.equal(a.prevHash, GENESIS_PREV, "first entry links genesis");
  assert.equal(b.prevHash, a.hash, "each entry links its predecessor");
  assert.equal(t.headHash, b.hash);
  assert.ok(Object.isFrozen(a) && Object.isFrozen(b), "recorded entries are frozen (no in-place edit)");
});

test("APPEND-ONLY: there is no edit/delete API and entries() returns a non-mutating copy", () => {
  const t = new AuditTrail();
  t.record({ ...BASE });
  t.record({ ...BASE, decision: DECISION.ASK });

  // The only mutator is record(): no delete/edit/reorder methods exist on the surface.
  assert.equal(typeof t.delete, "undefined");
  assert.equal(typeof t.edit, "undefined");
  assert.equal(typeof t.splice, "undefined");

  // entries() is a copy — splicing it does not shrink the trail.
  const snapshot = t.entries();
  snapshot.splice(0, snapshot.length);
  assert.equal(t.length, 2, "mutating the returned array must not touch the trail");

  // and the entries themselves are frozen — a write is silently ignored / throws in strict mode.
  const [first] = t.entries();
  assert.throws(() => { "use strict"; first.decision = DECISION.DENY; }, TypeError);
});

test("record() accepts a pre-built fact and re-validates it (secret-scanned exactly once on the wire)", () => {
  const t = new AuditTrail();
  const fact = makeAuditEntry({ ...BASE });
  const e = t.record(fact);
  assert.equal(e.decision, DECISION.ALLOW);
  assert.equal(e.seq, 0);
});

// =====================================================================================
// verify() — tamper-evidence
// =====================================================================================

test("verify() reports an intact trail as ok", () => {
  const t = new AuditTrail();
  for (const d of [DECISION.ALLOW, DECISION.DENY, DECISION.ASK]) t.record({ ...BASE, decision: d });
  const v = t.verify();
  assert.deepEqual(v, { ok: true, brokenAt: null, reason: null });
});

test("verify() (via verifyEntries) DETECTS an in-place edit of a recorded entry", () => {
  const t = new AuditTrail();
  t.record({ ...BASE, decision: DECISION.ALLOW });
  t.record({ ...BASE, decision: DECISION.DENY });
  // Reconstruct a tampered external list: flip entry 0's decision but keep its stored hash.
  const entries = t.entries().map((e) => ({ ...e }));
  entries[0].decision = DECISION.DENY; // an attacker rewrites "deny" to look like it was "allow"-shaped
  const v = AuditTrail.verifyEntries(entries);
  assert.equal(v.ok, false);
  assert.equal(v.brokenAt, 0);
  assert.match(v.reason, /tampered entry 0/);
});

test("verify() DETECTS a deleted middle entry (suppressed record) via seq gap / broken link", () => {
  const t = new AuditTrail();
  t.record({ ...BASE, decision: DECISION.ALLOW }); // seq 0
  t.record({ ...BASE, decision: DECISION.DENY }); // seq 1  <-- to be dropped
  t.record({ ...BASE, decision: DECISION.ASK }); // seq 2
  const entries = t.entries();
  const tampered = [entries[0], entries[2]]; // drop the middle one; seqs are now 0 then 2
  const v = AuditTrail.verifyEntries(tampered);
  assert.equal(v.ok, false);
  assert.equal(v.brokenAt, 1, "the second surviving entry exposes the gap");
  assert.match(v.reason, /seq gap|broken link/);
});

test("verify() DETECTS a reordered pair (the chain link no longer matches)", () => {
  const t = new AuditTrail();
  t.record({ ...BASE, decision: DECISION.ALLOW });
  t.record({ ...BASE, decision: DECISION.DENY });
  const [a, b] = t.entries();
  const v = AuditTrail.verifyEntries([b, a]); // swapped
  assert.equal(v.ok, false);
  assert.equal(v.brokenAt, 0, "the now-first entry has the wrong seq / genesis link");
});

test("verifyEntries() rejects a non-array and a non-object entry", () => {
  assert.equal(AuditTrail.verifyEntries("nope").ok, false);
  assert.equal(AuditTrail.verifyEntries([null]).ok, false);
});

// =====================================================================================
// Scope — carried per entry, filterable, no co-mingling
// =====================================================================================

test("entries(filter) scopes by (client, project) without co-mingling", () => {
  const t = new AuditTrail();
  t.record({ ...BASE, client: "acme", project: "checkout" });
  t.record({ ...BASE, client: "acme", project: "billing" });
  t.record({ ...BASE, client: "example-studio", project: "site" });

  assert.equal(t.entries({ client: "acme" }).length, 2);
  assert.equal(t.entries({ client: "acme", project: "checkout" }).length, 1);
  assert.equal(t.entries({ client: "example-studio" }).length, 1);
  // an omitted axis is unconstrained; an explicit null matches a null
  t.record({ ...BASE, client: "acme", project: null });
  assert.equal(t.entries({ client: "acme", project: null }).length, 1);
  assert.equal(t.entries({ client: "acme" }).length, 3, "omitting project does not constrain it");
});

// =====================================================================================
// Sink — best-effort durable export (never breaks the in-process trail)
// =====================================================================================

test("the injected sink receives each recorded entry", () => {
  const seen = [];
  const t = new AuditTrail({ sink: (e) => seen.push(e) });
  t.record({ ...BASE });
  t.record({ ...BASE, decision: DECISION.DENY });
  assert.equal(seen.length, 2);
  assert.equal(seen[1].decision, DECISION.DENY);
});

test("a THROWING sink does not break recording or the chain (best-effort export)", () => {
  const t = new AuditTrail({ sink: () => { throw new Error("collector down"); } });
  assert.doesNotThrow(() => {
    t.record({ ...BASE });
    t.record({ ...BASE, decision: DECISION.ASK });
  });
  assert.equal(t.length, 2);
  assert.equal(t.verify().ok, true, "the in-memory chain stays verifiable despite the sink outage");
});
