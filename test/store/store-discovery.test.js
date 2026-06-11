// Tests for store discovery + name resolution.
//
// discoverSkills is the parametrized core (takes a storeDir), so it is exercised directly against
// a tmpdir fixture — never the real ~/.skillforge/skills. resolveByName binds the real STORE_PATH
// and so is tested for its name-safety contract (traversal/unsafe names → null), which holds
// independently of store contents. Stack: node:test + node:assert, zero runtime deps.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { discoverSkills } from '../../src/store/discovery.js';
import { resolveByName } from '../../src/store/index.js';

function makeStore(t, skills = []) {
  const dir = mkdtempSync(join(tmpdir(), 'sf-store-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const name of skills) {
    const skillDir = join(dir, name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), `# ${name}\n`);
  }
  return dir;
}

test('discoverSkills finds directories that hold a SKILL.md', (t) => {
  const dir = makeStore(t, ['alpha', 'beta']);
  const found = discoverSkills(dir).map((s) => s.name);
  assert.deepEqual(found, ['alpha', 'beta']);
});

test('discoverSkills returns a path ending in SKILL.md', (t) => {
  const dir = makeStore(t, ['alpha']);
  const [skill] = discoverSkills(dir);
  assert.ok(skill.path.endsWith(join('alpha', 'SKILL.md')));
});

test('discoverSkills ignores directories without SKILL.md', (t) => {
  const dir = makeStore(t, ['alpha']);
  mkdirSync(join(dir, 'not-a-skill'), { recursive: true });
  const found = discoverSkills(dir).map((s) => s.name);
  assert.deepEqual(found, ['alpha']);
});

test('discoverSkills returns [] for a missing store directory', (t) => {
  const dir = makeStore(t, []);
  assert.deepEqual(discoverSkills(join(dir, 'does-not-exist')), []);
});

test('resolveByName rejects path traversal (../escape) → null', () => {
  assert.equal(resolveByName('../escape'), null);
});

test('resolveByName rejects names with separators → null', () => {
  assert.equal(resolveByName('a/b'), null);
  assert.equal(resolveByName('a\\b'), null);
  assert.equal(resolveByName('..'), null);
  assert.equal(resolveByName(''), null);
});

test('resolveByName returns null for a non-installed skill', () => {
  assert.equal(resolveByName('nonexistent-skill-xyz-kan110'), null);
});
