// Tests for the store provenance manifest.
//
// The manifest functions are parametrized on storeDir, so they run against a tmpdir fixture and
// never touch the real ~/.skillforge/skills. Covers: missing manifest → empty shape, write→read
// round-trip, and upsert (re-writing the same name overwrites, no duplicate). Stack: node:test +
// node:assert, zero runtime deps.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readManifest, writeManifestEntry, MANIFEST_FILE } from '../../src/store/manifest.js';

function makeStoreDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'sf-manifest-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('MANIFEST_FILE is .manifest.json', () => {
  assert.equal(MANIFEST_FILE, '.manifest.json');
});

test('readManifest returns { skills: {} } when manifest missing', (t) => {
  const dir = makeStoreDir(t);
  assert.deepEqual(readManifest(dir), { skills: {} });
});

test('writeManifestEntry + readManifest round-trip', (t) => {
  const dir = makeStoreDir(t);
  const entry = { source: 'github:acme/skill', version: '1.2.3', installedAt: '2026-06-10T00:00:00Z' };
  writeManifestEntry(dir, 'alpha', entry);
  const manifest = readManifest(dir);
  assert.deepEqual(manifest.skills.alpha, entry);
});

test('writeManifestEntry twice (same name) upserts, no duplicate', (t) => {
  const dir = makeStoreDir(t);
  writeManifestEntry(dir, 'alpha', { source: 'a', version: '1.0.0' });
  writeManifestEntry(dir, 'alpha', { source: 'b', version: '2.0.0' });
  const manifest = readManifest(dir);
  assert.equal(Object.keys(manifest.skills).length, 1);
  assert.equal(manifest.skills.alpha.source, 'b');
  assert.equal(manifest.skills.alpha.version, '2.0.0');
});

test('writeManifestEntry preserves other entries on upsert', (t) => {
  const dir = makeStoreDir(t);
  writeManifestEntry(dir, 'alpha', { source: 'a' });
  writeManifestEntry(dir, 'beta', { source: 'b' });
  writeManifestEntry(dir, 'alpha', { source: 'a2' });
  const manifest = readManifest(dir);
  assert.deepEqual(Object.keys(manifest.skills).sort(), ['alpha', 'beta']);
  assert.equal(manifest.skills.beta.source, 'b');
});

test('readManifest tolerates a malformed manifest file', (t) => {
  const dir = makeStoreDir(t);
  writeFileSync(join(dir, MANIFEST_FILE), 'not json{');
  assert.deepEqual(readManifest(dir), { skills: {} });
});
