// Tests for LINT-GOVERNANCE-SIDEEFFECTS: the descriptor-level invariant tying a kind's
// governance class to its declared side effects. Write/bidirectional kinds must be able to emit
// intents (the gate needs something to govern); 'none' kinds must emit none (a read-only kind can
// never fabricate a tool call). Checked behaviorally — by CALLING sideEffects with mock parts.
//
// Sources: concept + first principles, zero third-party skills-factory files (clean-room).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSkillKinds, createSkillKinds } from '../../src/registry/skill-kinds.js';
import { checkGovernanceSideEffects } from '../../tools/registry-lint.js';

const MOCK_PARTS = { composed: { plan: [{ x: 1 }], intents: [{ x: 1 }] }, clientContext: {}, artifact: {} };

const WRITE_KINDS = ['artifact', 'transformation'];
const NONE_KINDS = ['instruction', 'validation', 'analysis'];

test('write-class descriptors emit a non-empty intent list on mock parts', () => {
  const catalog = defaultSkillKinds();
  for (const kind of WRITE_KINDS) {
    const intents = catalog.get(kind).sideEffects(MOCK_PARTS);
    assert.ok(Array.isArray(intents) && intents.length > 0, `${kind} should emit intents`);
  }
});

test('none-class descriptors emit [] on mock parts', () => {
  const catalog = defaultSkillKinds();
  for (const kind of NONE_KINDS) {
    assert.deepEqual(catalog.get(kind).sideEffects(MOCK_PARTS), [], `${kind} should emit no intents`);
  }
});

test('the default skill-kinds catalog is governance↔sideEffects consistent', () => {
  assert.deepEqual(checkGovernanceSideEffects(defaultSkillKinds()), []);
});

test('lint rejects a write-class descriptor whose sideEffects is () => []', () => {
  const bad = Object.freeze({ kind: 'broken-write', governance: 'write', sideEffects: () => [] });
  const violations = checkGovernanceSideEffects(createSkillKinds({ 'broken-write': bad }));
  assert.equal(violations.length, 1);
  assert.match(violations[0], /governance "write" requires sideEffects that can emit/);
});

test('lint rejects a bidirectional descriptor whose sideEffects is () => []', () => {
  const bad = Object.freeze({ kind: 'broken-bidi', governance: 'bidirectional', sideEffects: () => [] });
  const violations = checkGovernanceSideEffects(createSkillKinds({ 'broken-bidi': bad }));
  assert.equal(violations.length, 1);
  assert.match(violations[0], /governance "bidirectional" requires sideEffects that can emit/);
});

test('lint rejects a none-class descriptor with non-empty sideEffects', () => {
  const bad = Object.freeze({ kind: 'broken-none', governance: 'none', sideEffects: () => [{ tool: 'Write' }] });
  const violations = checkGovernanceSideEffects(createSkillKinds({ 'broken-none': bad }));
  assert.equal(violations.length, 1);
  assert.match(violations[0], /governance "none" requires sideEffects to be \(\) => \[\]/);
});

test('lint rejects a descriptor whose sideEffects is not a function', () => {
  const bad = Object.freeze({ kind: 'broken-shape', governance: 'write', sideEffects: [] });
  const violations = checkGovernanceSideEffects(createSkillKinds({ 'broken-shape': bad }));
  assert.equal(violations.length, 1);
  assert.match(violations[0], /sideEffects must be a function/);
});
