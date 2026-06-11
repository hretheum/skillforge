// Tests for the PreToolUse enforcement hook (T-MVP-05).
//
// The hook is the per-call seam BEFORE the side effect (docs/13 §enforcement seam). It hosts
// the resolver (tool scope) AND secret-scan (credential-shaped input), deny-first. These
// tests cover the DONE criteria: an out-of-scope tool call is DENIED at the seam; a
// credential-shaped write is BLOCKED. Plus deny-first edge cases and the Claude-flavour shape.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createPreToolUseHook,
  preToolUseHook,
  HOOK_DECISION,
  PROFILES,
} from '../../src/governance/index.js';

// A call that the resolver WOULD allow: declared tool + an org allow rule, convenience profile.
const allowedCall = (over = {}) => ({
  profile: PROFILES.CONVENIENCE,
  layers: { org: [{ pattern: 'Write', decision: 'allow' }] },
  requiredTools: ['Write'],
  tool: 'Write',
  ...over,
});

// =====================================================================================
// DONE criterion 1 — an out-of-scope tool call is DENIED at the seam
// =====================================================================================

test('out-of-scope tool call -> DENY at the seam (resolver all-defer -> deny)', () => {
  const r = preToolUseHook.check({
    profile: PROFILES.CONVENIENCE,
    layers: {},
    requiredTools: [],
    tool: 'Bash',
    toolInput: { command: 'ls' },
  });
  assert.equal(r.decision, HOOK_DECISION.DENY);
  assert.match(r.reason, /out of scope/);
});

test('a permitted tool with clean input -> ALLOW', () => {
  const r = preToolUseHook.check(allowedCall({ toolInput: { path: 'a.txt', text: 'hello world' } }));
  assert.equal(r.decision, HOOK_DECISION.ALLOW);
});

test('a resolver ASK is surfaced as ask (not silently allowed/denied)', () => {
  const r = preToolUseHook.check(
    allowedCall({ layers: { org: [{ pattern: 'Write', decision: 'ask' }] }, toolInput: { text: 'ok' } }),
  );
  assert.equal(r.decision, HOOK_DECISION.ASK);
});

// =====================================================================================
// DONE criterion 2 — a credential-shaped write is BLOCKED
// =====================================================================================

test('credential-shaped string in tool input -> DENY (before the side effect)', () => {
  const r = preToolUseHook.check(
    allowedCall({ toolInput: { path: '.env', text: 'AWS_KEY=AKIAIOSFODNN7EXAMPLE' } }),
  );
  assert.equal(r.decision, HOOK_DECISION.DENY);
  assert.match(r.reason, /credential-shaped/);
  assert.ok(r.secretFindings.length >= 1);
});

test('secret-scan deny wins even when the resolver would ALLOW (deny-first)', () => {
  // resolver would allow (declared Write + org allow), but the input carries a token -> deny.
  const r = preToolUseHook.check(
    allowedCall({ toolInput: { body: 'ghp_' + 'a'.repeat(36) } }),
  );
  assert.equal(r.decision, HOOK_DECISION.DENY);
  assert.match(r.reason, /credential-shaped/);
});

test('the blocked finding is redacted in the reason (no full secret echoed)', () => {
  const secret = 'sk-' + 'Z'.repeat(24);
  const r = preToolUseHook.check(allowedCall({ toolInput: { text: secret } }));
  assert.equal(r.decision, HOOK_DECISION.DENY);
  assert.equal(r.reason.includes(secret), false);
});

// =====================================================================================
// Layer-0 floor flows through the seam
// =====================================================================================

test('a server-side tool under COMPLIANCE is denied at the seam (Layer-0 floor)', () => {
  const r = preToolUseHook.check({
    profile: PROFILES.COMPLIANCE,
    layers: { org: [{ pattern: '*', decision: 'allow' }] },
    requiredTools: ['WebFetch'],
    tool: 'WebFetch',
    toolInput: { url: 'https://example.com' },
  });
  assert.equal(r.decision, HOOK_DECISION.DENY);
});

// =====================================================================================
// Deny-first edge cases (fail-closed)
// =====================================================================================

test('a THROWING resolver -> DENY (fail-closed), never allow', () => {
  const hook = createPreToolUseHook({
    resolver: { resolve() { throw new Error('resolver defect'); } },
  });
  const r = hook.check(allowedCall({ toolInput: { text: 'clean' } }));
  assert.equal(r.decision, HOOK_DECISION.DENY);
  assert.match(r.reason, /fail-closed/);
});

test('a THROWING scanner -> DENY (fail-closed): scan failure treated as a hit', () => {
  const hook = createPreToolUseHook({
    scan() { throw new Error('scanner defect'); },
  });
  const r = hook.check(allowedCall({ toolInput: { text: 'anything' } }));
  assert.equal(r.decision, HOOK_DECISION.DENY);
});

test('no toolInput -> scan is skipped, decision comes from the resolver', () => {
  const r = preToolUseHook.check(allowedCall({ toolInput: undefined }));
  assert.equal(r.decision, HOOK_DECISION.ALLOW);
});

// =====================================================================================
// Claude-flavour projection (vendor-neutral core + native shape)
// =====================================================================================

test('result carries the Claude-Code PreToolUse projection mirroring the decision', () => {
  const allow = preToolUseHook.check(allowedCall({ toolInput: { text: 'ok' } }));
  assert.equal(allow.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(allow.hookSpecificOutput.permissionDecision, allow.decision);
  assert.equal(allow.hookSpecificOutput.permissionDecisionReason, allow.reason);

  const deny = preToolUseHook.check({ profile: null, layers: {}, requiredTools: [], tool: 'Nope' });
  assert.equal(deny.hookSpecificOutput.permissionDecision, HOOK_DECISION.DENY);
});
