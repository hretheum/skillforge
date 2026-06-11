// Tests for the requiredTools gate semantics — docs/13-tool-governance.md
// §"GOV-04 — Affirmative allow required".
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room). See docs/13-tool-governance.md.
//
// The gap these tests pin: requiredTools is a CLAMP that narrows toward deny — it never GRANTS
// permission. A declared tool with NO affirmative org/client/project allow still resolves to
// DENY (all upper layers defer -> silence is denial). An allow at an upper layer is required;
// and that allow cannot rescue a tool the skill did not declare (the clamp wins).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createPreToolUseHook, HOOK_DECISION, PROFILES } from '../../src/governance/index.js';

const ORG_ALLOW = [{ pattern: 'Write', decision: 'allow' }];

// convenience profile so Layer 0 never pre-filters — these tests isolate the Layer-4 clamp.
const call = (over = {}) => ({
  profile: PROFILES.CONVENIENCE,
  layers: {},
  requiredTools: [],
  tool: 'Write',
  toolInput: { path: 'a.txt', text: 'hello' },
  ...over,
});

test('tool IN requiredTools but NO org allow -> DENY (clamp never grants)', () => {
  const hook = createPreToolUseHook();
  const r = hook.check(call({ requiredTools: ['Write'], layers: {} }));
  assert.equal(r.decision, HOOK_DECISION.DENY);
  assert.match(r.reason, /out of scope/);
});

test('tool IN requiredTools WITH org allow -> ALLOW (affirmative allow grants)', () => {
  const hook = createPreToolUseHook();
  const r = hook.check(call({ requiredTools: ['Write'], layers: { org: ORG_ALLOW } }));
  assert.equal(r.decision, HOOK_DECISION.ALLOW);
});

test('tool NOT in requiredTools WITH org allow -> DENY (clamp wins over allow)', () => {
  const hook = createPreToolUseHook();
  const r = hook.check(call({ requiredTools: ['Read'], layers: { org: ORG_ALLOW } }));
  assert.equal(r.decision, HOOK_DECISION.DENY);
  assert.match(r.reason, /out of scope/);
});

// The org-baseline rules a deployment carries are EXACTLY this org layer. A tool the org
// baseline allows AND the skill requires is permitted — the affirmative allow comes from the
// org layer, the clamp (requiredTools) does not block it.
test('tool in orgBaseline allow AND in requiredTools -> ALLOW (org baseline grants)', () => {
  const hook = createPreToolUseHook();
  const orgBaseline = [{ pattern: 'Write', decision: 'allow' }];
  const r = hook.check(call({ requiredTools: ['Write'], layers: { org: orgBaseline } }));
  assert.equal(r.decision, HOOK_DECISION.ALLOW);
});

// A tool OUTSIDE the org baseline (no allow rule matches it) stays DENY even when the skill
// declares it: silence is denial, the org floor never granted it.
test('undeclared-by-org tool stays DENY (orgBaseline does not cover it)', () => {
  const hook = createPreToolUseHook();
  const orgBaseline = [{ pattern: 'Read', decision: 'allow' }]; // allows Read, not Write
  const r = hook.check(call({ requiredTools: ['Write'], layers: { org: orgBaseline } }));
  assert.equal(r.decision, HOOK_DECISION.DENY);
  assert.match(r.reason, /out of scope/);
});
