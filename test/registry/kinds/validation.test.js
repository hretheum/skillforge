// Tests for the `validation` skill kind descriptor: a read-only, references-family kind
// that composes a typed PASS/FAIL verdict.
//
// Sources: concept + first principles, zero third-party skills-factory files (clean-room).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validationDescriptor } from '../../../src/registry/kinds/index.js';
import { validateKindContract } from '../../../src/registry/typing.js';
import { defaultSkillKinds } from '../../../src/registry/skill-kinds.js';
import { defaultAdapterKinds } from '../../../src/registry/adapter-kinds.js';

const kinds = defaultAdapterKinds();

test('validation is seeded in the default skill-kinds catalog', () => {
  const catalog = defaultSkillKinds();
  assert.equal(catalog.has('validation'), true);
  assert.equal(catalog.get('validation'), validationDescriptor);
});

test('descriptor shape matches the spec', () => {
  assert.equal(validationDescriptor.kind, 'validation');
  assert.equal(validationDescriptor.governance, 'none');
  assert.equal(validationDescriptor.compose.inputSource, 'references');
  assert.deepEqual([...validationDescriptor.stages].sort(), [
    'activate', 'compose', 'emit', 'load', 'resolveRefs', 'telemetry',
  ]);
  assert.deepEqual(validationDescriptor.sideEffects(), []);
});

test('validateKindContract passes for a valid validation entry (no adapters)', () => {
  const entry = { requiredAdapters: { input: [], output: [] }, sourceKind: null, resultKind: null };
  assert.deepEqual(validateKindContract({ entry, descriptor: validationDescriptor, kinds }), []);
});

test('validateKindContract rejects a validation entry that declares adapters', () => {
  const entry = { requiredAdapters: { input: ['dtcg-tokens'], output: [] } };
  const violations = validateKindContract({ entry, descriptor: validationDescriptor, kinds });
  assert.ok(violations.some((v) => /input adapters/.test(v)));
});

test('validateOutput accepts a well-formed {pass, violations} verdict', () => {
  assert.deepEqual(validationDescriptor.compose.validateOutput({ pass: true, violations: [] }), []);
  assert.deepEqual(
    validationDescriptor.compose.validateOutput({ pass: false, violations: ['x'] }),
    [],
  );
});

test('validateOutput rejects a compose that does not return {pass, violations}', () => {
  const bad = ['validation compose must return {pass:boolean, violations:string[]}'];
  assert.deepEqual(validationDescriptor.compose.validateOutput(null), bad);
  assert.deepEqual(validationDescriptor.compose.validateOutput({ pass: 'yes', violations: [] }), bad);
  assert.deepEqual(validationDescriptor.compose.validateOutput({ pass: true }), bad);
  assert.deepEqual(validationDescriptor.compose.validateOutput({ pass: true, violations: 'nope' }), bad);
});

test('envelope projects pass/violations/activation from the composed verdict', () => {
  const out = validationDescriptor.envelope({
    composed: { pass: false, violations: ['a', 'b'] },
    activation: { skill: 's' },
  });
  assert.deepEqual(out, { pass: false, violations: ['a', 'b'], activation: { skill: 's' } });
});
