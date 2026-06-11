// Tests for the startup update checker.
//
// checkForUpdates is parametrized on storeDir, cacheDir, and an injectable npm runner, so every
// test runs against a tmpdir fixture with a stubbed execNpm — no real npm call, no network, no
// touching the real ~/.skillforge/skills. Covers: empty/local-path manifests, the one-hour cache
// (hit and miss), silent failure, and the version-comparison branches. node:test + node:assert.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkForUpdates } from '../../src/mcp/update-checker.js';

const MANIFEST_FILE = '.manifest.json';
const CACHE_FILE = '.update-check-cache.json';

function makeDir(t, prefix = 'sf-update-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeManifest(dir, skills) {
  writeFileSync(join(dir, MANIFEST_FILE), JSON.stringify({ skills }, null, 2) + '\n', 'utf8');
}

function writeCache(dir, timestamp, results) {
  writeFileSync(join(dir, CACHE_FILE), JSON.stringify({ timestamp, results }, null, 2) + '\n', 'utf8');
}

test('empty manifest returns []', async (t) => {
  const dir = makeDir(t);
  const result = await checkForUpdates({
    storeDir: dir,
    execNpm: () => assert.fail('execNpm must not be called for an empty manifest'),
  });
  assert.deepEqual(result, []);
});

test('local-path source is skipped (returns [])', async (t) => {
  const dir = makeDir(t);
  writeManifest(dir, {
    'my-skill': { source: '/Users/me/dev/my-skill', version: '1.0.0', installedAt: '2026-01-01' },
    'rel-skill': { source: './local/thing', version: '1.0.0', installedAt: '2026-01-01' },
  });
  const result = await checkForUpdates({
    storeDir: dir,
    execNpm: () => assert.fail('execNpm must not be called for local-path sources'),
  });
  assert.deepEqual(result, []);
});

test('cache hit within 1h returns cached result without calling execNpm', async (t) => {
  const dir = makeDir(t);
  writeManifest(dir, {
    'my-skill': { source: 'my-pkg', version: '1.0.0', installedAt: '2026-01-01' },
  });
  const cached = [{ source: 'my-pkg', installed: '1.0.0', latest: '1.0.0', updateAvailable: false }];
  writeCache(dir, Date.now() - 60_000, cached);

  const result = await checkForUpdates({
    storeDir: dir,
    execNpm: () => {
      throw new Error('execNpm must not be called on a fresh cache hit');
    },
  });
  assert.deepEqual(result, cached);
});

test('cache miss (expired) calls execNpm, returns result, writes cache', async (t) => {
  const dir = makeDir(t);
  writeManifest(dir, {
    'my-skill': { source: 'my-pkg', version: '1.0.0', installedAt: '2026-01-01' },
  });
  // stale cache: older than the 1h TTL
  writeCache(dir, Date.now() - 7_200_000, [
    { source: 'my-pkg', installed: '1.0.0', latest: '1.0.0', updateAvailable: false },
  ]);

  const calls = [];
  const result = await checkForUpdates({
    storeDir: dir,
    execNpm: (source) => {
      calls.push(source);
      return '2.0.0\n';
    },
  });

  assert.deepEqual(calls, ['my-pkg']);
  assert.deepEqual(result, [
    { source: 'my-pkg', installed: '1.0.0', latest: '2.0.0', updateAvailable: true },
  ]);

  const written = JSON.parse(readFileSync(join(dir, CACHE_FILE), 'utf8'));
  assert.deepEqual(written.results, result);
  assert.equal(typeof written.timestamp, 'number');
});

test('execNpm throwing (network error) returns [] silently', async (t) => {
  const dir = makeDir(t);
  writeManifest(dir, {
    'my-skill': { source: 'my-pkg', version: '1.0.0', installedAt: '2026-01-01' },
  });
  const result = await checkForUpdates({
    storeDir: dir,
    execNpm: () => {
      throw new Error('getaddrinfo ENOTFOUND registry.npmjs.org');
    },
  });
  assert.deepEqual(result, []);
});

test('updateAvailable is true when latest > installed, false when equal', async (t) => {
  const dir = makeDir(t);
  writeManifest(dir, {
    'a-skill': { source: 'pkg-a', version: '1.2.0', installedAt: '2026-01-01' },
    'b-skill': { source: 'pkg-b', version: '3.4.5', installedAt: '2026-01-01' },
  });
  const latest = { 'pkg-a': '1.10.0', 'pkg-b': '3.4.5' };
  const result = await checkForUpdates({
    storeDir: dir,
    execNpm: (source) => latest[source],
  });
  const bySource = Object.fromEntries(result.map((r) => [r.source, r]));
  // 1.10.0 > 1.2.0 numerically (would be false under string comparison)
  assert.equal(bySource['pkg-a'].updateAvailable, true);
  assert.equal(bySource['pkg-b'].updateAvailable, false);
});

test('separate cacheDir is honoured for read and write', async (t) => {
  const storeDir = makeDir(t, 'sf-store-');
  const cacheDir = makeDir(t, 'sf-cache-');
  writeManifest(storeDir, {
    'my-skill': { source: 'my-pkg', version: '1.0.0', installedAt: '2026-01-01' },
  });
  await checkForUpdates({
    storeDir,
    cacheDir,
    execNpm: () => '1.0.0',
  });
  assert.ok(existsSync(join(cacheDir, CACHE_FILE)), 'cache written to cacheDir');
  assert.ok(!existsSync(join(storeDir, CACHE_FILE)), 'cache not written to storeDir');
});
