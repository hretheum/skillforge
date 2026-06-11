// Tests for the `skills config` core — readConfig / writeConfig.
//
// Both functions take a configDir override, so every test runs against a tmpdir fixture and NEVER
// touches the real ~/.skillforge/config.json. Safe defaults, write/read round-trips, value parsing,
// unknown-key rejection, and key preservation are covered hermetically. node:test + node:assert.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readConfig, writeConfig } from '../../src/cli/config-command.js';

function tmp(t) {
  const dir = mkdtempSync(join(tmpdir(), 'sf-config-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('readConfig returns safe default when file is missing', (t) => {
  const configDir = tmp(t);
  assert.deepEqual(readConfig({ configDir }), { autoUpdate: false });
});

test('writeConfig writes the file and returns the parsed value', (t) => {
  const configDir = tmp(t);
  const result = writeConfig('auto-update', 'true', { configDir });
  assert.equal(result.key, 'auto-update');
  assert.equal(result.value, true);
  assert.equal(result.configPath, join(configDir, 'config.json'));
  assert.equal(typeof result.value, 'boolean');

  const written = JSON.parse(readFileSync(result.configPath, 'utf8'));
  assert.equal(written.autoUpdate, true);
});

test('readConfig reflects a prior writeConfig true', (t) => {
  const configDir = tmp(t);
  writeConfig('auto-update', 'true', { configDir });
  assert.deepEqual(readConfig({ configDir }), { autoUpdate: true });
});

test('writeConfig false stores a boolean false', (t) => {
  const configDir = tmp(t);
  const result = writeConfig('auto-update', 'false', { configDir });
  assert.equal(result.value, false);
  assert.equal(typeof result.value, 'boolean');
  assert.deepEqual(readConfig({ configDir }), { autoUpdate: false });
});

test('writeConfig throws on an unknown key', (t) => {
  const configDir = tmp(t);
  assert.throws(() => writeConfig('nope', 'true', { configDir }), /unknown config key/);
});

test('writeConfig preserves other keys already in the file', (t) => {
  const configDir = tmp(t);
  const configPath = join(configDir, 'config.json');
  writeFileSync(configPath, JSON.stringify({ someOther: 'keep', autoUpdate: false }) + '\n');

  writeConfig('auto-update', 'true', { configDir });

  const written = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.equal(written.someOther, 'keep');
  assert.equal(written.autoUpdate, true);
});

test('readConfig treats a non-boolean autoUpdate as false', (t) => {
  const configDir = tmp(t);
  writeFileSync(join(configDir, 'config.json'), JSON.stringify({ autoUpdate: 'true' }) + '\n');
  assert.deepEqual(readConfig({ configDir }), { autoUpdate: false });
});
