// Tests for the `sync` skill kind descriptor: a bidirectional, multi-write, adapter-family
// kind that composes a non-empty INTENTS array (writes for BOTH sides) and fans it out through the
// gated apply path, with every gated intent recorded on the audit trail.
//
// Sources: concept + first principles, zero third-party skills-factory files (clean-room).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { syncDescriptor } from '../../../src/registry/kinds/index.js';
import { validateKindContract } from '../../../src/registry/typing.js';
import { defaultSkillKinds } from '../../../src/registry/skill-kinds.js';
import { defaultAdapterKinds } from '../../../src/registry/adapter-kinds.js';
import { checkGovernanceSideEffects } from '../../../tools/registry-lint.js';
import { AuditTrail } from '../../../src/governance/index.js';
import { execute } from '../../../src/engine/executor.js';

const kinds = defaultAdapterKinds();

test('sync is seeded in the default skill-kinds catalog', () => {
  const catalog = defaultSkillKinds();
  assert.equal(catalog.has('sync'), true);
  assert.equal(catalog.get('sync'), syncDescriptor);
});

test('descriptor shape matches the spec (adapter family, bidirectional governance, gated stages)', () => {
  assert.equal(syncDescriptor.kind, 'sync');
  assert.equal(syncDescriptor.governance, 'bidirectional');
  assert.equal(syncDescriptor.compose.inputSource, 'adapter');
  assert.deepEqual([...syncDescriptor.stages].sort(), [
    'activate', 'build', 'compose', 'emit', 'gate', 'load', 'read', 'telemetry',
  ]);
  assert.ok(Object.isFrozen(syncDescriptor));
});

test('validateOutput accepts a non-empty intents array', () => {
  assert.deepEqual(syncDescriptor.compose.validateOutput({ intents: [{ tool: 'Write' }] }), []);
});

test('validateOutput rejects a missing or empty intents array', () => {
  const bad = ['sync compose must return intents[] for both sides'];
  assert.deepEqual(syncDescriptor.compose.validateOutput(null), bad);
  assert.deepEqual(syncDescriptor.compose.validateOutput({}), bad);
  assert.deepEqual(syncDescriptor.compose.validateOutput({ intents: [] }), bad);
  assert.deepEqual(syncDescriptor.compose.validateOutput({ intents: 'nope' }), bad);
});

test('sideEffects returns the composed intents (both sides) verbatim', () => {
  const intents = [
    { tool: 'Write', toolInput: { file_path: 'left.json', content: 'a' } },
    { tool: 'Write', toolInput: { file_path: 'right.json', content: 'b' } },
  ];
  assert.deepEqual(syncDescriptor.sideEffects({ composed: { intents } }), intents);
});

test('envelope projects intents/activation from the composed result', () => {
  const out = syncDescriptor.envelope({
    composed: { intents: [{ tool: 'Write' }] },
    activation: { skill: 's' },
  });
  assert.deepEqual(out, { intents: [{ tool: 'Write' }], activation: { skill: 's' } });
});

test('validateKindContract passes for a well-typed adapter entry', () => {
  const entry = {
    requiredAdapters: { input: ['flat-tokens'], output: ['react'] },
    sourceKind: 'design-system',
    resultKind: 'frontend-component',
  };
  assert.deepEqual(validateKindContract({ entry, descriptor: syncDescriptor, kinds }), []);
});

test('governance="bidirectional" passes LINT-GOVERNANCE-SIDEEFFECTS', () => {
  const violations = checkGovernanceSideEffects(defaultSkillKinds());
  assert.deepEqual(violations, []);
});

// --- executor integration: both-side intents gated + audited, deny aborts -------------------------

function syncExecuteDeps({ allow = true, auditTrail } = {}) {
  return {
    loadClientConfig: () => ({
      adapters: { input: 'flat-tokens', output: 'react' },
      references: {},
      profile: null,
    }),
    activate: () => ({ skill: 'sync-example' }),
    getInputAdapter: () => ({}),
    readInput: () => ({ envelope: { kind: 'design-system' }, payload: {} }),
    getOutputAdapter: () => ({}),
    buildResult: () => ({ result: {}, artifact: {} }),
    preToolUseHook: {
      check: ({ tool }) =>
        allow
          ? { decision: 'allow', reason: null }
          : { decision: 'deny', reason: `${tool} blocked` },
    },
    auditTrail,
  };
}

const composeBothSides = () => ({
  intents: [
    { tool: 'Write', toolInput: { file_path: 'left.json', content: 'L' } },
    { tool: 'Write', toolInput: { file_path: 'right.json', content: 'R' } },
  ],
});

test('executor fans both sides through the gate and records one audit entry per intent', async () => {
  const auditTrail = new AuditTrail();
  const out = await execute({
    descriptor: syncDescriptor,
    request: {},
    skillName: 'sync-example',
    client: 'acme',
    project: null,
    compose: composeBothSides,
    deps: syncExecuteDeps({ allow: true, auditTrail }),
    registry: { skills: { 'sync-example': { requiredTools: ['Write'] } } },
  });
  assert.equal(out.intents.length, 2);
  // one audit entry per side, scoped to the client, all allowed, trail intact
  assert.equal(auditTrail.length, 2);
  const entries = auditTrail.entries({ client: 'acme' });
  assert.equal(entries.length, 2);
  assert.ok(entries.every((e) => e.tool === 'Write' && e.decision === 'allow' && e.skill === 'sync-example'));
  assert.equal(auditTrail.verify().ok, true);
});

test('a deny on either side aborts the sync (deny-first)', async () => {
  const auditTrail = new AuditTrail();
  await assert.rejects(
    () =>
      execute({
        descriptor: syncDescriptor,
        request: {},
        skillName: 'sync-example',
        client: 'acme',
        compose: composeBothSides,
        deps: syncExecuteDeps({ allow: false, auditTrail }),
        registry: { skills: { 'sync-example': { requiredTools: ['Write'] } } },
      }),
    /was denied at the PreToolUse gate/,
  );
  // the denied intent is still recorded (audit captures the deny verdict before the abort)
  assert.equal(auditTrail.length, 1);
  assert.equal(auditTrail.entries()[0].decision, 'deny');
});

// --- the executor stays generic: NO sync/bidirectional string branching ---------------------------

test('executor.js has no sync- or bidirectional-specific branching', () => {
  const src = readFileSync(fileURLToPath(new URL('../../../src/engine/executor.js', import.meta.url)), 'utf8');
  assert.equal(/["']sync["']/.test(src), false, 'executor must not name the "sync" kind');
  assert.equal(/["']bidirectional["']/.test(src), false, 'executor must not branch on "bidirectional"');
});
