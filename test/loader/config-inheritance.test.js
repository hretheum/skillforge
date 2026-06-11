// Tests for CC-34: parent+child config inheritance.
//
// A child config may declare `"parent": "<id>"` to inherit a parent client's config, fold via
// `mergeParentChild` after raw parse, then validate the MERGED object through the rest of the
// loader chain. Covers the merge semantics, the ARCH-06 tenancy relaxation (a parent-inherited
// local reference resolves within the parent's subtree), and the error guards (self-reference,
// missing parent, no chaining). Stack: node:test + node:assert, zero runtime deps.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadClientConfig, mergeParentChild, LoaderError, GATES } from '../../src/loader/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(here, 'fixtures');

// --- unit: mergeParentChild (pure data transform, no I/O) -------------------------------

const parentRaw = () => ({
  identity: { identifier: 'parent-base', displayName: 'Parent Base Corp' },
  adapters: { input: 'flat-tokens', output: 'react' },
  profile: 'compliance',
  mcpPolicy: { defaultPosture: 'deny', allowedServers: [] },
  modelDefaults: { default: 'claude-sonnet-4-6', thinkingTokensCap: 10000 },
  orgBaseline: [{ pattern: 'Read', decision: 'allow' }],
  skills: ['parent-skill-a', 'parent-skill-b'],
  skillParameters: { componentOutputDir: 'src/components', theme: 'parent-default' },
  references: { tokenHub: './resources/tokens.json' },
  secretRefs: ['group/shared/source-token'],
});

test('merge: child with no overrides inherits all parent fields', () => {
  const child = { identity: { identifier: 'child', displayName: 'Child' }, parent: 'parent-base' };
  const m = mergeParentChild(parentRaw(), child, { parentDirAbs: '/abs/parent-base' });
  assert.deepEqual(m.adapters, { input: 'flat-tokens', output: 'react' });
  assert.equal(m.profile, 'compliance');
  assert.deepEqual(m.mcpPolicy, { defaultPosture: 'deny', allowedServers: [] });
  assert.deepEqual(m.modelDefaults, { default: 'claude-sonnet-4-6', thinkingTokensCap: 10000 });
  assert.deepEqual(m.orgBaseline, [{ pattern: 'Read', decision: 'allow' }]);
  assert.deepEqual(m.skills, ['parent-skill-a', 'parent-skill-b']);
  // identity is always the child's
  assert.deepEqual(m.identity, { identifier: 'child', displayName: 'Child' });
  // `parent` is dropped
  assert.equal('parent' in m, false);
});

test('merge: child overrides adapters → child adapters used', () => {
  const child = {
    identity: { identifier: 'child', displayName: 'Child' },
    parent: 'parent-base',
    adapters: { input: 'dtcg-tokens', output: 'react' },
  };
  const m = mergeParentChild(parentRaw(), child, { parentDirAbs: '/abs/parent-base' });
  assert.deepEqual(m.adapters, { input: 'dtcg-tokens', output: 'react' });
});

test('merge: child overrides skills → child whole array used', () => {
  const child = {
    identity: { identifier: 'child', displayName: 'Child' },
    parent: 'parent-base',
    skills: ['child-only-skill'],
  };
  const m = mergeParentChild(parentRaw(), child, { parentDirAbs: '/abs/parent-base' });
  assert.deepEqual(m.skills, ['child-only-skill']);
});

test('merge: skillParameters merge — parent keys default, child key wins on conflict', () => {
  const child = {
    identity: { identifier: 'child', displayName: 'Child' },
    parent: 'parent-base',
    skillParameters: { theme: 'child-override', childOnly: 'yes' },
  };
  const m = mergeParentChild(parentRaw(), child, { parentDirAbs: '/abs/parent-base' });
  assert.deepEqual(m.skillParameters, {
    componentOutputDir: 'src/components', // parent default kept
    theme: 'child-override', // child wins on conflict
    childOnly: 'yes', // child-only key added
  });
});

test('merge: secretRefs union, de-duplicated', () => {
  const child = {
    identity: { identifier: 'child', displayName: 'Child' },
    parent: 'parent-base',
    secretRefs: ['group/shared/source-token', 'brand/child/extra-token'],
  };
  const m = mergeParentChild(parentRaw(), child, { parentDirAbs: '/abs/parent-base' });
  assert.deepEqual(m.secretRefs, ['group/shared/source-token', 'brand/child/extra-token']);
});

test('merge: parent local references rewritten to absolute paths; child refs merged per key', () => {
  const child = {
    identity: { identifier: 'child', displayName: 'Child' },
    parent: 'parent-base',
    references: { childRules: './resources/child-rules.json' },
  };
  const m = mergeParentChild(parentRaw(), child, { parentDirAbs: '/abs/parent-base' });
  assert.equal(m.references.tokenHub, '/abs/parent-base/resources/tokens.json');
  assert.equal(m.references.childRules, './resources/child-rules.json');
});

test('merge: parent non-local (scheme) reference passes through unchanged', () => {
  const p = parentRaw();
  p.references = { designSource: 'figma://ABC123' };
  const child = { identity: { identifier: 'child', displayName: 'Child' }, parent: 'parent-base' };
  const m = mergeParentChild(p, child, { parentDirAbs: '/abs/parent-base' });
  assert.equal(m.references.designSource, 'figma://ABC123');
});

test('merge: child reference for a key overrides the parent reference for that key', () => {
  const child = {
    identity: { identifier: 'child', displayName: 'Child' },
    parent: 'parent-base',
    references: { tokenHub: './resources/own-tokens.json' },
  };
  const m = mergeParentChild(parentRaw(), child, { parentDirAbs: '/abs/parent-base' });
  assert.equal(m.references.tokenHub, './resources/own-tokens.json');
});

// --- integration: loadClientConfig with committed fixtures ------------------------------

test('loadClientConfig: child-inherits loads cleanly and reflects merge', () => {
  const ctx = loadClientConfig({ clientsDir: fixturesDir, client: 'child-inherits' });
  assert.equal(ctx.identifier, 'child-inherits');
  assert.equal(ctx.displayName, 'Child Inherits Brand');
  // adapters: child override
  assert.deepEqual(ctx.adapters, { input: 'dtcg-tokens', output: 'react' });
  // skills: child override (whole array)
  assert.deepEqual(ctx.skills, ['child-create-component']);
  // profile/mcpPolicy/modelDefaults/orgBaseline: inherited from parent
  assert.equal(ctx.profile, 'compliance');
  assert.deepEqual(ctx.mcpPolicy, { defaultPosture: 'deny', allowedServers: [] });
  assert.deepEqual(ctx.orgBaseline, [
    { pattern: 'Read', decision: 'allow' },
    { pattern: 'Write', decision: 'allow' },
  ]);
  // modelDefaults rides through on raw (loader does not surface it as a named field)
  assert.deepEqual(ctx.raw.modelDefaults, { default: 'claude-sonnet-4-6', thinkingTokensCap: 10000 });
  // skillParameters key-level merge: parent default kept, child key wins
  assert.deepEqual(ctx.skillParameters, {
    componentOutputDir: 'src/components',
    theme: 'child-override',
  });
  // secretRefs union
  assert.deepEqual(ctx.secretRefs, ['group/shared/source-token', 'brand/child/extra-token']);
  // `parent` never leaks into the merged raw
  assert.equal('parent' in ctx.raw, false);
});

test('loadClientConfig: ARCH-06 — parent-inherited local reference resolves within parent subtree', () => {
  // child-references declares no references of its own; it inherits the parent's local refs,
  // which resolve into the PARENT's subtree. The tenancy check must ADMIT them.
  const ctx = loadClientConfig({ clientsDir: fixturesDir, client: 'child-references' });
  assert.equal(ctx.references.tokenHub.local, true);
  assert.ok(ctx.references.tokenHub.resolvedPath.includes(join('parent-base', 'resources', 'tokens.json')));
  assert.equal(ctx.references.legalText.local, true);
  assert.ok(ctx.references.legalText.resolvedPath.includes(join('parent-base', 'resources', 'legal.json')));
});

test('loadClientConfig: child + own local reference both resolve (child within own subtree)', () => {
  const ctx = loadClientConfig({ clientsDir: fixturesDir, client: 'child-inherits' });
  // inherited parent ref (absolute, parent subtree)
  assert.ok(ctx.references.tokenHub.resolvedPath.includes(join('parent-base', 'resources', 'tokens.json')));
  // child's own ref (resolves within the child subtree)
  assert.ok(ctx.references.childRules.resolvedPath.includes(join('child-inherits', 'resources', 'child-rules.json')));
});

// --- ARCH-06: a parent reference escaping BOTH subtrees is still refused -----------------

test('loadClientConfig: parent-inherited reference escaping both subtrees → LoaderError REFERENCES', (t) => {
  // Build a temp clients_dir where the parent points at an absolute path OUTSIDE both subtrees.
  const dir = mkdtempSync(join(tmpdir(), 'sf-cc34-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const outsideDir = mkdtempSync(join(tmpdir(), 'sf-cc34-outside-'));
  t.after(() => rmSync(outsideDir, { recursive: true, force: true }));
  const outsideFile = join(outsideDir, 'leak.json');
  writeFileSync(outsideFile, '{}');

  mkdirSync(join(dir, 'p'), { recursive: true });
  writeFileSync(
    join(dir, 'p', 'config.json'),
    JSON.stringify({
      identity: { identifier: 'p', displayName: 'P' },
      adapters: { input: 'flat-tokens', output: 'react' },
      references: { leak: outsideFile }, // absolute path outside p's subtree
    }),
  );
  mkdirSync(join(dir, 'c'), { recursive: true });
  writeFileSync(
    join(dir, 'c', 'config.json'),
    JSON.stringify({ identity: { identifier: 'c', displayName: 'C' }, parent: 'p' }),
  );

  assert.throws(
    () => loadClientConfig({ clientsDir: dir, client: 'c' }),
    (e) => e instanceof LoaderError && e.gate === GATES.REFERENCES && /escapes/.test(e.message),
  );
});

// --- error guards -----------------------------------------------------------------------

test('loadClientConfig: parent references self → LoaderError CONFIG', () => {
  assert.throws(
    () => loadClientConfig({ clientsDir: fixturesDir, client: 'self-parent' }),
    (e) => e instanceof LoaderError && e.gate === GATES.CONFIG && /itself/.test(e.message),
  );
});

test('loadClientConfig: parent not found → LoaderError CONFIG', () => {
  assert.throws(
    () => loadClientConfig({ clientsDir: fixturesDir, client: 'missing-parent' }),
    (e) => e instanceof LoaderError && e.gate === GATES.CONFIG && /not a client/.test(e.message),
  );
});

test('loadClientConfig: parent value with path traversal out of clients_dir → LoaderError CONFIG (SEC-1)', (t) => {
  // `parent` must be a client identifier, not a path. A traversal ("../evil") would read a
  // config from OUTSIDE the tenancy root — the loader must refuse before any file read.
  const dir = mkdtempSync(join(tmpdir(), 'sf-cc34-sec1-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const outsideClients = mkdtempSync(join(tmpdir(), 'sf-cc34-sec1-out-'));
  t.after(() => rmSync(outsideClients, { recursive: true, force: true }));
  mkdirSync(join(outsideClients, 'evil'), { recursive: true });
  writeFileSync(
    join(outsideClients, 'evil', 'config.json'),
    JSON.stringify({
      identity: { identifier: 'evil', displayName: 'Evil' },
      adapters: { input: 'flat-tokens', output: 'react' },
    }),
  );
  mkdirSync(join(dir, 'c'), { recursive: true });
  writeFileSync(
    join(dir, 'c', 'config.json'),
    JSON.stringify({ identity: { identifier: 'c', displayName: 'C' }, parent: join('..', 'evil') }),
  );

  assert.throws(
    () => loadClientConfig({ clientsDir: dir, client: 'c' }),
    (e) => e instanceof LoaderError && e.gate === GATES.CONFIG && /escapes clients_dir/.test(e.message),
  );
});

test('loadClientConfig: parent has its own parent → LoaderError CONFIG (no chaining)', () => {
  assert.throws(
    () => loadClientConfig({ clientsDir: fixturesDir, client: 'child-chained' }),
    (e) => e instanceof LoaderError && e.gate === GATES.CONFIG && /one level deep|no chaining/.test(e.message),
  );
});
