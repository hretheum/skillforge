// Tests for the `skills` subcommand core — skillsAddCommand / skillsListCommand.
//
// Both functions take a storeDir override, so every test runs against a tmpdir fixture and NEVER
// touches the real ~/.skillforge/skills. Local-bundle install, idempotency, listing, and bad-source
// handling are covered hermetically (no network). The npm-source path requires the network and is
// left as a documented TODO. Stack: node:test + node:assert, zero runtime deps.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { skillsAddCommand, skillsListCommand, BUNDLE_ALIASES } from '../../src/cli/skills-command.js';

function tmp(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Build a local bundle dir holding skills/<name>/SKILL.md for each entry. `skills` maps name -> the
// optional version embedded as the `# skillforge-version:` marker (omit for the default "local").
function makeBundle(dir, skills) {
  for (const [name, version] of Object.entries(skills)) {
    const skillDir = join(dir, 'skills', name);
    mkdirSync(skillDir, { recursive: true });
    const marker = version ? `# skillforge-version: ${version}\n` : '';
    writeFileSync(join(skillDir, 'SKILL.md'), `${marker}# ${name}\nbody\n`);
  }
  return dir;
}

test('installs every skill from a local bundle into the store', async (t) => {
  const bundle = makeBundle(tmp(t, 'sf-bundle-'), { foo: null, bar: null });
  const storeDir = tmp(t, 'sf-store-');

  const result = await skillsAddCommand(bundle, { storeDir });

  assert.deepEqual(result.installed, ['bar', 'foo']);
  assert.deepEqual(result.skipped, []);
  assert.ok(existsSync(join(storeDir, 'foo', 'SKILL.md')));
  assert.ok(existsSync(join(storeDir, 'bar', 'SKILL.md')));

  const manifest = JSON.parse(readFileSync(join(storeDir, '.manifest.json'), 'utf8'));
  assert.equal(manifest.skills.foo.source, bundle);
  assert.equal(manifest.skills.foo.version, 'local');
  assert.ok(manifest.skills.foo.installedAt);
});

test('reads the skillforge-version marker as the recorded version', async (t) => {
  const bundle = makeBundle(tmp(t, 'sf-bundle-'), { foo: '2.0.1' });
  const storeDir = tmp(t, 'sf-store-');

  await skillsAddCommand(bundle, { storeDir });

  const manifest = JSON.parse(readFileSync(join(storeDir, '.manifest.json'), 'utf8'));
  assert.equal(manifest.skills.foo.version, '2.0.1');
});

test('is idempotent — re-installing the same bundle skips, no overwrite', async (t) => {
  const bundle = makeBundle(tmp(t, 'sf-bundle-'), { foo: null, bar: null });
  const storeDir = tmp(t, 'sf-store-');

  await skillsAddCommand(bundle, { storeDir });
  // Mutate an installed file to prove the second run does not overwrite it.
  const sentinel = join(storeDir, 'foo', 'SKILL.md');
  writeFileSync(sentinel, 'DO NOT TOUCH\n');

  const second = await skillsAddCommand(bundle, { storeDir });

  assert.deepEqual(second.installed, []);
  assert.deepEqual(second.skipped, ['bar', 'foo']);
  assert.equal(readFileSync(sentinel, 'utf8'), 'DO NOT TOUCH\n');
});

test('a changed version overwrites the installed skill', async (t) => {
  const storeDir = tmp(t, 'sf-store-');
  const v1 = makeBundle(tmp(t, 'sf-bundle-'), { foo: '1.0.0' });
  await skillsAddCommand(v1, { storeDir });

  const v2 = makeBundle(tmp(t, 'sf-bundle-'), { foo: '2.0.0' });
  const result = await skillsAddCommand(v2, { storeDir });

  assert.deepEqual(result.installed, ['foo']);
  assert.deepEqual(result.skipped, []);
  const manifest = JSON.parse(readFileSync(join(storeDir, '.manifest.json'), 'utf8'));
  assert.equal(manifest.skills.foo.version, '2.0.0');
});

test('skillsListCommand returns entries matching installed skills', async (t) => {
  const bundle = makeBundle(tmp(t, 'sf-bundle-'), { foo: '1.2.3', bar: null });
  const storeDir = tmp(t, 'sf-store-');
  await skillsAddCommand(bundle, { storeDir });

  const listed = skillsListCommand({ storeDir });

  assert.deepEqual(listed.map((s) => s.name), ['bar', 'foo']);
  const foo = listed.find((s) => s.name === 'foo');
  assert.equal(foo.source, bundle);
  assert.equal(foo.version, '1.2.3');
  assert.ok(foo.installedAt);
});

test('skillsListCommand on an empty/missing store is an empty list', (t) => {
  const storeDir = join(tmp(t, 'sf-store-'), 'does-not-exist');
  assert.deepEqual(skillsListCommand({ storeDir }), []);
});

test('a local source that is not a directory throws', async (t) => {
  const storeDir = tmp(t, 'sf-store-');
  await assert.rejects(
    () => skillsAddCommand('/no/such/bundle/here', { storeDir }),
    /not a directory/,
  );
});

test('a local bundle with no skills/ directory throws', async (t) => {
  const empty = tmp(t, 'sf-bundle-'); // no skills/ subdir
  const storeDir = tmp(t, 'sf-store-');
  await assert.rejects(() => skillsAddCommand(empty, { storeDir }), /no skills found/);
});

test('an empty/whitespace source throws', async (t) => {
  const storeDir = tmp(t, 'sf-store-');
  await assert.rejects(() => skillsAddCommand('   ', { storeDir }), /requires a <source>/);
});

test('the "ecc" alias resolves to the scoped bundle package', () => {
  // The alias table must map "ecc" → the published package name. Checked against the exported
  // constant so the test stays hermetic (no network, no npm install).
  assert.equal(BUNDLE_ALIASES.ecc, '@skillforge-core/ecc-bundle');
});

test('a local source records its own path as provenance (never aliased)', async (t) => {
  const bundle = makeBundle(tmp(t, 'sf-bundle-'), { foo: null });
  const storeDir = tmp(t, 'sf-store-');
  await skillsAddCommand(bundle, { storeDir });
  const listed = skillsListCommand({ storeDir });
  assert.equal(listed[0].source, bundle);
});

// TODO: exercise the npm-package source path. It calls `npm install` and so requires the
// network (or a local registry / packed tarball fixture); skipped here to keep the suite hermetic.
test('npm source path', { skip: 'requires network / npm registry — covered manually' }, () => {});
