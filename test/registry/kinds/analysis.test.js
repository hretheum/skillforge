// Tests for the `analysis` skill kind descriptor: a read-only, references-family kind
// that composes a schema'd report object.
//
// Sources: concept + first principles, zero third-party skills-factory files (clean-room).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analysisDescriptor } from '../../../src/registry/kinds/index.js';
import { validateKindContract } from '../../../src/registry/typing.js';
import { defaultSkillKinds } from '../../../src/registry/skill-kinds.js';
import { defaultAdapterKinds } from '../../../src/registry/adapter-kinds.js';

const kinds = defaultAdapterKinds();

test('analysis is seeded in the default skill-kinds catalog', () => {
  const catalog = defaultSkillKinds();
  assert.equal(catalog.has('analysis'), true);
  assert.equal(catalog.get('analysis'), analysisDescriptor);
});

test('descriptor shape matches the spec', () => {
  assert.equal(analysisDescriptor.kind, 'analysis');
  assert.equal(analysisDescriptor.governance, 'none');
  assert.equal(analysisDescriptor.compose.inputSource, 'references');
  assert.deepEqual([...analysisDescriptor.stages].sort(), [
    'activate', 'compose', 'emit', 'load', 'resolveRefs', 'telemetry',
  ]);
  assert.deepEqual(analysisDescriptor.sideEffects(), []);
});

test('validateKindContract passes for a valid analysis entry (no adapters)', () => {
  const entry = { requiredAdapters: { input: [], output: [] }, sourceKind: null, resultKind: null };
  assert.deepEqual(validateKindContract({ entry, descriptor: analysisDescriptor, kinds }), []);
});

test('validateKindContract rejects an analysis entry that declares adapters', () => {
  const entry = { requiredAdapters: { input: ['dtcg-tokens'], output: [] } };
  const violations = validateKindContract({ entry, descriptor: analysisDescriptor, kinds });
  assert.ok(violations.some((v) => /input adapters/.test(v)));
});

test('validateOutput accepts a well-formed {report} object', () => {
  assert.deepEqual(analysisDescriptor.compose.validateOutput({ report: { findings: [] } }), []);
  assert.deepEqual(analysisDescriptor.compose.validateOutput({ report: 'summary text' }), []);
});

test('validateOutput rejects a compose that does not return an object with a report field', () => {
  const bad = ['analysis compose must return an object with a report field'];
  assert.deepEqual(analysisDescriptor.compose.validateOutput(null), bad);
  assert.deepEqual(analysisDescriptor.compose.validateOutput({}), bad);
  assert.deepEqual(analysisDescriptor.compose.validateOutput({ report: '' }), bad);
  assert.deepEqual(analysisDescriptor.compose.validateOutput({ report: null }), bad);
});

test('envelope projects report/activation from the composed result', () => {
  const out = analysisDescriptor.envelope({
    composed: { report: { score: 42 } },
    activation: { skill: 's' },
  });
  assert.deepEqual(out, { report: { score: 42 }, activation: { skill: 's' } });
});
