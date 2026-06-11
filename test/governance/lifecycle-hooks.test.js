// Tests for the lifecycle-hooks seam.
//
// Lifecycle hooks fire around the SESSION (docs/13 §enforcement seam): worktree create, session
// start/end, skill activate. Under the compliance profile, the managed-runtime conveniences
// (onWorktreeCreate, onSessionStart) are GATED — logged but not allowed to proceed. Other
// profiles log without gating. Gating reads the same profile contract as the loader/resolver.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createLifecycleHooks,
  lifecycleHooks,
  LIFECYCLE_EVENT,
  PROFILES,
} from '../../src/governance/index.js';

// =====================================================================================
// compliance profile gates worktree/session events
// =====================================================================================

test('compliance profile GATES onWorktreeCreate', () => {
  const r = lifecycleHooks.fire(LIFECYCLE_EVENT.WORKTREE_CREATE, {
    profile: PROFILES.COMPLIANCE,
    clientId: 'acme',
  });
  assert.equal(r.gated, true);
  assert.equal(r.logged, true);
  assert.match(r.reason, /compliance/);
});

test('compliance profile GATES onSessionStart', () => {
  const r = lifecycleHooks.fire(LIFECYCLE_EVENT.SESSION_START, {
    profile: PROFILES.COMPLIANCE,
  });
  assert.equal(r.gated, true);
  assert.equal(r.logged, true);
});

// non-gating-eligible events are logged even under compliance.
test('compliance profile does NOT gate onSessionEnd / onSkillActivate (not managed-state events)', () => {
  for (const ev of [LIFECYCLE_EVENT.SESSION_END, LIFECYCLE_EVENT.SKILL_ACTIVATE]) {
    const r = lifecycleHooks.fire(ev, { profile: PROFILES.COMPLIANCE, skillName: 's' });
    assert.equal(r.gated, false, `${ev} should not gate`);
    assert.equal(r.logged, true);
  }
});

// =====================================================================================
// non-compliance profile logs only
// =====================================================================================

test('convenience profile LOGS worktree/session events without gating', () => {
  for (const ev of [LIFECYCLE_EVENT.WORKTREE_CREATE, LIFECYCLE_EVENT.SESSION_START]) {
    const r = lifecycleHooks.fire(ev, { profile: PROFILES.CONVENIENCE });
    assert.equal(r.gated, false, `${ev} should not gate under convenience`);
    assert.equal(r.logged, true);
  }
});

// =====================================================================================
// deny-first edges
// =====================================================================================

test('unknown profile -> gated (fail-closed) for a managed-state event', () => {
  const r = lifecycleHooks.fire(LIFECYCLE_EVENT.WORKTREE_CREATE, { profile: 'mystery' });
  assert.equal(r.gated, true);
  assert.equal(r.logged, true);
});

test('null profile -> gated for a managed-state event', () => {
  const r = lifecycleHooks.fire(LIFECYCLE_EVENT.SESSION_START, {});
  assert.equal(r.gated, true);
});

test('unknown lifecycle event -> gated (fail-closed) but logged', () => {
  const r = lifecycleHooks.fire('onSomethingElse', { profile: PROFILES.CONVENIENCE });
  assert.equal(r.gated, true);
  assert.equal(r.logged, true);
  assert.match(r.reason, /unknown lifecycle event/);
});

test('a throwing evaluator collapses to gated (deny-first)', () => {
  const hooks = createLifecycleHooks({
    evaluator: {
      evaluate() {
        throw new Error('boom');
      },
    },
  });
  const r = hooks.fire(LIFECYCLE_EVENT.WORKTREE_CREATE, { profile: PROFILES.CONVENIENCE });
  assert.equal(r.gated, true);
  assert.equal(r.logged, true);
});
