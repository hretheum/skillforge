// Sources: concept + first principles, zero files from any third-party skills-factory codebase (clean-room).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateKindContract } from '../../src/registry/typing.js';
import { artifactDescriptor, instructionDescriptor } from '../../src/registry/kinds/index.js';
import { defaultAdapterKinds } from '../../src/registry/adapter-kinds.js';

const kinds = defaultAdapterKinds();

// A minimal instruction-shaped entry (references inputSource, no adapters)
const instructionEntry = {
  skillName: 'test-instruction',
  requiredAdapters: { input: [], output: [] },
  sourceKind: null,
  resultKind: null,
};

test('references branch: valid instruction entry returns no violations', () => {
  const violations = validateKindContract({ entry: instructionEntry, descriptor: instructionDescriptor, kinds });
  assert.deepStrictEqual(violations, []);
});

test('references branch: input adapter declared → violation', () => {
  const entry = { ...instructionEntry, requiredAdapters: { input: ['dtcg-tokens'], output: [] } };
  const violations = validateKindContract({ entry, descriptor: instructionDescriptor, kinds });
  assert.ok(violations.length > 0);
  assert.ok(violations[0].includes('input adapters'));
});

test('references branch: output adapter declared → violation', () => {
  const entry = { ...instructionEntry, requiredAdapters: { input: [], output: ['react'] } };
  const violations = validateKindContract({ entry, descriptor: instructionDescriptor, kinds });
  assert.ok(violations.length > 0);
});

// A minimal artifact-shaped entry (adapter inputSource, well-typed wiring)
const artifactEntry = {
  skillName: 'test-artifact',
  requiredAdapters: { input: ['dtcg-tokens'], output: ['react'] },
  sourceKind: 'design-system',
  resultKind: 'frontend-component',
};

test('adapter branch: well-typed artifact entry returns no violations', () => {
  const violations = validateKindContract({ entry: artifactEntry, descriptor: artifactDescriptor, kinds });
  assert.deepStrictEqual(violations, []);
});

test('adapter branch: mistyped result-kind → violation', () => {
  const entry = { ...artifactEntry, resultKind: 'no-such-kind' };
  const violations = validateKindContract({ entry, descriptor: artifactDescriptor, kinds });
  assert.ok(violations.length > 0);
});

test('unknown inputSource → violation', () => {
  const bogus = { compose: { inputSource: 'telepathy' } };
  const violations = validateKindContract({ entry: instructionEntry, descriptor: bogus, kinds });
  assert.deepStrictEqual(violations, ['unknown inputSource "telepathy"']);
});
