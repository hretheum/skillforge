// Tests for the `transformation` skill kind descriptor: a multi-write, adapter-family
// kind that composes a non-empty PLAN array and fans it out through the gated apply path.
//
// Sources: concept + first principles, zero third-party skills-factory files (clean-room).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transformationDescriptor } from '../../../src/registry/kinds/index.js';
import { validateKindContract } from '../../../src/registry/typing.js';
import { defaultSkillKinds } from '../../../src/registry/skill-kinds.js';
import { defaultAdapterKinds } from '../../../src/registry/adapter-kinds.js';

const kinds = defaultAdapterKinds();

test('transformation is seeded in the default skill-kinds catalog', () => {
  const catalog = defaultSkillKinds();
  assert.equal(catalog.has('transformation'), true);
  assert.equal(catalog.get('transformation'), transformationDescriptor);
});

test('descriptor shape matches the spec (adapter family, write governance, gated stages)', () => {
  assert.equal(transformationDescriptor.kind, 'transformation');
  assert.equal(transformationDescriptor.governance, 'write');
  assert.equal(transformationDescriptor.compose.inputSource, 'adapter');
  assert.deepEqual([...transformationDescriptor.stages].sort(), [
    'activate', 'build', 'compose', 'emit', 'gate', 'load', 'read', 'telemetry',
  ]);
});

test('validateKindContract passes for a well-typed adapter entry', () => {
  const entry = {
    requiredAdapters: { input: ['dtcg-tokens'], output: ['react'] },
    sourceKind: 'design-system',
    resultKind: 'frontend-component',
  };
  assert.deepEqual(validateKindContract({ entry, descriptor: transformationDescriptor, kinds }), []);
});

test('validateKindContract rejects a mistyped adapter pairing', () => {
  const entry = {
    requiredAdapters: { input: ['dtcg-tokens'], output: ['react'] },
    sourceKind: 'design-system',
    resultKind: 'no-such-kind',
  };
  const violations = validateKindContract({ entry, descriptor: transformationDescriptor, kinds });
  assert.ok(violations.length > 0);
});

test('validateOutput accepts a non-empty plan array', () => {
  assert.deepEqual(
    transformationDescriptor.compose.validateOutput({ plan: [{ tool: 'Write' }] }),
    [],
  );
});

test('validateOutput rejects a missing or empty plan', () => {
  const bad = ['transformation compose must return {plan:[...]} with a non-empty plan array'];
  assert.deepEqual(transformationDescriptor.compose.validateOutput(null), bad);
  assert.deepEqual(transformationDescriptor.compose.validateOutput({}), bad);
  assert.deepEqual(transformationDescriptor.compose.validateOutput({ plan: [] }), bad);
  assert.deepEqual(transformationDescriptor.compose.validateOutput({ plan: 'nope' }), bad);
});

test('sideEffects fans out the composed plan array verbatim', () => {
  const plan = [
    { tool: 'Write', toolInput: { file_path: 'a.txt', content: 'a' } },
    { tool: 'Write', toolInput: { file_path: 'b.txt', content: 'b' } },
  ];
  assert.deepEqual(transformationDescriptor.sideEffects({ composed: { plan } }), plan);
});

test('envelope projects plan/activation from the composed result', () => {
  const out = transformationDescriptor.envelope({
    composed: { plan: [{ tool: 'Write' }] },
    activation: { skill: 's' },
  });
  assert.deepEqual(out, { plan: [{ tool: 'Write' }], activation: { skill: 's' } });
});
