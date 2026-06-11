// Sources: concept + first principles, zero files from any third-party skills-factory codebase (clean-room).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSkillKinds, defaultSkillKinds } from '../../src/registry/skill-kinds.js';
import { artifactDescriptor } from '../../src/registry/kinds/artifact.js';
import { instructionDescriptor } from '../../src/registry/kinds/instruction.js';

test('defaultSkillKinds has artifact and instruction', () => {
  const kinds = defaultSkillKinds();
  assert.ok(kinds.has('artifact'));
  assert.ok(kinds.has('instruction'));
});

test('get returns frozen descriptor', () => {
  const kinds = defaultSkillKinds();
  assert.strictEqual(kinds.get('artifact'), artifactDescriptor);
  assert.ok(Object.isFrozen(kinds.get('artifact')));
  assert.strictEqual(kinds.get('instruction'), instructionDescriptor);
  assert.ok(Object.isFrozen(kinds.get('instruction')));
});

test('get throws with known-kinds list on missing kind', () => {
  const kinds = defaultSkillKinds();
  assert.throws(() => kinds.get('nope'), /unknown skillKind "nope" \(known:/);
});

test('kinds() returns list', () => {
  const kinds = defaultSkillKinds();
  assert.ok(kinds.kinds().includes('artifact'));
  assert.ok(kinds.kinds().includes('instruction'));
});

test('both descriptors have required shape', () => {
  for (const desc of [artifactDescriptor, instructionDescriptor]) {
    assert.ok(typeof desc.kind === 'string');
    assert.ok(desc.compose && typeof desc.compose.inputSource === 'string');
    assert.ok(typeof desc.compose.validateOutput === 'function');
    assert.ok(desc.stages instanceof Set);
    assert.ok(typeof desc.governance === 'string');
    assert.ok(typeof desc.sideEffects === 'function');
    assert.ok(typeof desc.envelope === 'function');
  }
});
