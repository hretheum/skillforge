// Tests for the skillforge_skills_update MCP tool.
//
// handleSkillsUpdate is exercised directly (not through the stdio transport) with a storeDir
// override, so every case runs against a tmpdir fixture and never touches ~/.skillforge/skills.
// Hermetic: only local bundle sources are used (no npm, no network). Stack: node:test + assert.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TOOLS, handleSkillsUpdate } from '../../src/mcp/server.js';
import { skillsAddCommand } from '../../src/cli/skills-command.js';
import { writeManifestEntry } from '../../src/store/manifest.js';

function tmp(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Build a local bundle dir holding skills/<name>/SKILL.md, each carrying a version marker.
function makeBundle(dir, skills) {
  for (const [name, version] of Object.entries(skills)) {
    const skillDir = join(dir, 'skills', name);
    mkdirSync(skillDir, { recursive: true });
    const marker = version ? `# skillforge-version: ${version}\n` : '';
    writeFileSync(join(skillDir, 'SKILL.md'), `${marker}# ${name}\nbody\n`);
  }
  return dir;
}

function payload(result) {
  assert.notEqual(result.isError, true);
  return JSON.parse(result.content[0].text);
}

test('skillforge_skills_update is registered in TOOLS', () => {
  const tool = TOOLS.find((t) => t.name === 'skillforge_skills_update');
  assert.ok(tool, 'tool present in TOOLS');
  assert.equal(typeof tool.description, 'string');
  assert.equal(tool.inputSchema.type, 'object');
});

test('an empty store reports alreadyLatest with no bundles', async (t) => {
  const storeDir = tmp(t, 'sf-store-');
  const result = await handleSkillsUpdate({ storeDir });
  const data = payload(result);
  assert.equal(data.alreadyLatest, true);
  assert.equal(data.message, 'no bundles installed');
});

test('re-installing the same version reports it as alreadyLatest', async (t) => {
  const bundle = makeBundle(tmp(t, 'sf-bundle-'), { foo: '1.0.0' });
  const storeDir = tmp(t, 'sf-store-');
  await skillsAddCommand(bundle, { storeDir });

  const data = payload(await handleSkillsUpdate({ storeDir }));
  assert.deepEqual(data.updated, []);
  assert.deepEqual(data.alreadyLatest, ['foo']);
  assert.deepEqual(data.errors, {});
});

test('a newer bundle version at the source is reported as updated', async (t) => {
  const storeDir = tmp(t, 'sf-store-');
  const bundleDir = tmp(t, 'sf-bundle-');

  makeBundle(bundleDir, { foo: '1.0.0' });
  await skillsAddCommand(bundleDir, { storeDir });

  // The source path is stable; bump the version it serves, then update pulls it.
  makeBundle(bundleDir, { foo: '2.0.0' });
  const data = payload(await handleSkillsUpdate({ storeDir }));

  assert.deepEqual(data.updated, ['foo']);
  assert.deepEqual(data.alreadyLatest, []);
  assert.deepEqual(data.errors, {});
});

test('an error from one source is recorded; other sources still process', async (t) => {
  const storeDir = tmp(t, 'sf-store-');
  const good = makeBundle(tmp(t, 'sf-bundle-'), { foo: '2.0.0' });

  // Seed two manifest entries: one good source, one pointing at a non-directory (will throw).
  const bad = join(tmp(t, 'sf-bundle-'), 'missing');
  writeManifestEntry(storeDir, 'foo', { source: good, version: '1.0.0', installedAt: 'x' });
  writeManifestEntry(storeDir, 'bar', { source: bad, version: '1.0.0', installedAt: 'x' });

  const data = payload(await handleSkillsUpdate({ storeDir }));

  assert.deepEqual(data.updated, ['foo']);
  assert.ok(bad in data.errors);
  assert.match(data.errors[bad], /not a directory/);
});
