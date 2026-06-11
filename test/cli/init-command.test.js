// Tests for the `init` subcommand core — initCommand.
//
// Every test passes an explicit configPath (or CLAUDE_DESKTOP_CONFIG_PATH) inside a tmpdir, so no
// test ever reads or writes the real claude_desktop_config.json. Fresh install, idempotency,
// preservation of pre-existing servers, invalid-JSON handling, and the --skills passthrough are
// covered hermetically. Stack: node:test + node:assert, zero runtime deps.

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

import { initCommand } from '../../src/cli/init-command.js';

function tmp(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('fresh install writes the skillforge MCP entry', async (t) => {
  const configPath = join(tmp(t, 'sf-init-'), 'claude_desktop_config.json');

  const result = await initCommand({ configPath });

  assert.equal(result.configPath, configPath);
  assert.equal(result.wasUpdated, true);

  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const entry = config.mcpServers.skillforge;
  assert.equal(entry.command, 'node');
  assert.equal(entry.args.at(-1), 'mcp');
  assert.ok(entry.args[0].endsWith('bin/skillforge.js'));
});

test('is idempotent — a second run reports no update', async (t) => {
  const configPath = join(tmp(t, 'sf-init-'), 'claude_desktop_config.json');

  const first = await initCommand({ configPath });
  const second = await initCommand({ configPath });

  assert.equal(first.wasUpdated, true);
  assert.equal(second.wasUpdated, false);
});

test('preserves other MCP servers already in the config', async (t) => {
  const dir = tmp(t, 'sf-init-');
  const configPath = join(dir, 'claude_desktop_config.json');
  writeFileSync(
    configPath,
    JSON.stringify({ mcpServers: { other: { command: 'foo' } } }, null, 2),
  );

  await initCommand({ configPath });

  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.deepEqual(config.mcpServers.other, { command: 'foo' });
  assert.equal(config.mcpServers.skillforge.command, 'node');
});

test('throws a clear error when the existing config is not valid JSON', async (t) => {
  const dir = tmp(t, 'sf-init-');
  const configPath = join(dir, 'claude_desktop_config.json');
  writeFileSync(configPath, '{ not valid json');

  await assert.rejects(
    () => initCommand({ configPath }),
    /not valid JSON/,
  );
});

test('--skills passthrough installs the bundle into the store', async (t) => {
  const configPath = join(tmp(t, 'sf-init-'), 'claude_desktop_config.json');
  const storeDir = tmp(t, 'sf-store-');

  const bundle = tmp(t, 'sf-bundle-');
  const skillDir = join(bundle, 'skills', 'demo');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), '# demo\nbody\n');

  await initCommand({ configPath, skillsSource: bundle, storeDir });

  assert.ok(existsSync(join(storeDir, 'demo', 'SKILL.md')));
});
