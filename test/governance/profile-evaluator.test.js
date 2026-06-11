// Tests for the profile-evaluator (T-MVP-03).
//
// The evaluator is the single, data-driven `(profile, feature) -> verdict` over the docs/14
// feature×profile contract table, sibling of the policy resolver, deny-first. These tests
// cover: the DONE criterion (a feature×profile illegal combo is rejected BY THE EVALUATOR),
// the full table (forbidden under compliance / allowed under convenience), and the deny-first
// posture the team-lead directed (unknown profile/feature, malformed input, throwing
// evaluator -> deny / fail-closed, never fail-open).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluate,
  profileEvaluator,
  isAllowed,
  isVerdict,
  PROFILES,
  DECISIONS,
  _table,
} from '../../src/governance/index.js';

// =====================================================================================
// DONE criterion — illegal feature×profile combo rejected BY THE EVALUATOR
// =====================================================================================

test('Files API under the compliance profile is DENIED by the evaluator', () => {
  const v = evaluate(PROFILES.COMPLIANCE, 'files-api');
  assert.equal(v.decision, DECISIONS.DENY);
  assert.match(v.reason, /forbidden under the compliance profile/);
  assert.match(v.reason, /EU\/ZDR boundary/);
});

test('Files API under the convenience profile is ALLOWED', () => {
  const v = evaluate(PROFILES.CONVENIENCE, 'files-api');
  assert.equal(v.decision, DECISIONS.ALLOW);
});

// =====================================================================================
// The full contract table (docs/14)
// =====================================================================================

test('every compliance-forbidden feature is denied under compliance, allowed under convenience', () => {
  for (const feature of _table.complianceForbidden()) {
    assert.equal(
      evaluate(PROFILES.COMPLIANCE, feature).decision,
      DECISIONS.DENY,
      `${feature} should be DENIED under compliance`,
    );
    assert.equal(
      evaluate(PROFILES.CONVENIENCE, feature).decision,
      DECISIONS.ALLOW,
      `${feature} should be ALLOWED under convenience`,
    );
  }
});

test('always-available features are allowed under BOTH profiles', () => {
  for (const feature of ['messages-api', 'prompt-caching', 'client-side-tools', 'client-side-skills']) {
    assert.equal(evaluate(PROFILES.COMPLIANCE, feature).decision, DECISIONS.ALLOW, feature);
    assert.equal(evaluate(PROFILES.CONVENIENCE, feature).decision, DECISIONS.ALLOW, feature);
  }
});

test('server-side tool classes (code-exec, web-search, web-fetch) are denied under compliance', () => {
  for (const tool of ['code-execution', 'web-search', 'web-fetch', 'server-side-tools']) {
    assert.equal(evaluate(PROFILES.COMPLIANCE, tool).decision, DECISIONS.DENY, tool);
  }
});

// =====================================================================================
// Deny-first posture (team-lead directive) — fail CLOSED, never fail open
// =====================================================================================

test('an UNKNOWN profile is denied (fail-closed) under any feature', () => {
  const v = evaluate('enterprise-mystery', 'messages-api');
  assert.equal(v.decision, DECISIONS.DENY);
  assert.match(v.reason, /unknown deployment profile/);
});

test('an UNKNOWN feature is denied under BOTH profiles (not in the contract table)', () => {
  assert.equal(evaluate(PROFILES.COMPLIANCE, 'quantum-teleport').decision, DECISIONS.DENY);
  assert.equal(evaluate(PROFILES.CONVENIENCE, 'quantum-teleport').decision, DECISIONS.DENY);
});

test('malformed input (non-string / empty) is denied, never throws', () => {
  for (const [p, f] of [
    [undefined, 'files-api'],
    [null, 'files-api'],
    ['', 'files-api'],
    [PROFILES.COMPLIANCE, undefined],
    [PROFILES.COMPLIANCE, ''],
    [42, 7],
    [{}, []],
  ]) {
    const v = evaluate(p, f);
    assert.equal(v.decision, DECISIONS.DENY, `(${String(p)}, ${String(f)}) should deny`);
  }
});

test('the evaluate function never throws, even on garbage', () => {
  assert.doesNotThrow(() => evaluate(Symbol('x'), Symbol('y')));
});

// =====================================================================================
// Verdict shape ownership + isAllowed wrapper (deny-first consumption)
// =====================================================================================

test('every verdict is well-formed (isVerdict true) and carries a reason', () => {
  for (const [p, f] of [
    [PROFILES.COMPLIANCE, 'files-api'],
    [PROFILES.CONVENIENCE, 'files-api'],
    ['bad', 'bad'],
  ]) {
    const v = evaluate(p, f);
    assert.ok(isVerdict(v), 'verdict shape');
    assert.equal(typeof v.reason, 'string');
    assert.ok(v.reason.length > 0);
  }
});

test('isVerdict rejects malformed verdicts', () => {
  assert.equal(isVerdict(null), false);
  assert.equal(isVerdict({}), false);
  assert.equal(isVerdict({ decision: 'maybe' }), false);
  assert.equal(isVerdict('allow'), false);
  assert.equal(isVerdict({ decision: 'allow' }), true);
});

test('isAllowed: a well-formed allow -> true', () => {
  assert.equal(isAllowed(profileEvaluator, PROFILES.CONVENIENCE, 'files-api'), true);
});

test('isAllowed: a deny -> false', () => {
  assert.equal(isAllowed(profileEvaluator, PROFILES.COMPLIANCE, 'files-api'), false);
});

test('isAllowed: a THROWING evaluator collapses to false (deny, not crash-through-as-allow)', () => {
  const thrower = {
    evaluate() {
      throw new Error('evaluator defect');
    },
  };
  assert.equal(isAllowed(thrower, PROFILES.CONVENIENCE, 'files-api'), false);
});

test('isAllowed: a MALFORMED verdict collapses to false (fail-closed)', () => {
  const garbage = { evaluate: () => ({ verdict: 'sure' }) }; // no `decision` field
  assert.equal(isAllowed(garbage, PROFILES.CONVENIENCE, 'files-api'), false);
});

// =====================================================================================
// Immutability of the contract table
// =====================================================================================

test('verdicts are frozen (cannot be mutated by a consumer)', () => {
  const v = evaluate(PROFILES.COMPLIANCE, 'files-api');
  assert.throws(() => {
    'use strict';
    v.decision = 'allow';
  });
});
