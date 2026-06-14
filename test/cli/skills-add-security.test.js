// Security regression tests for skillsAddCommand.
//
// Covers the two vulnerabilities identified in the 2026-06-13 security review:
//   HIGH:   npm install without --ignore-scripts enables lifecycle-script RCE
//   MEDIUM: a local bundle containing a symlink SKILL.md leaks arbitrary files
//           via skillforge_get_skill / GetPromptRequest after install
//
// Both tests are hermetic (no network, no real store). Stack: node:test + node:assert.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { skillsAddCommand } from '../../src/cli/skills-command.js';

function tmp(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// ─── HIGH: npm install must pass --ignore-scripts ───────────────────────────
//
// installNpmPackage is not exported, so we guard this with a source-code
// regression check. We assert the flag appears as a QUOTED argv element
// directly after 'install' — not a bare substring, which a leftover comment
// mentioning --ignore-scripts would satisfy even after the flag is removed
// from the actual execFileSync call. The gate fails the moment the flag
// leaves the npm install argv.
test('installNpmPackage passes --ignore-scripts to npm (no lifecycle RCE)', () => {
  const src = readFileSync(
    fileURLToPath(new URL('../../src/cli/skills-command.js', import.meta.url)),
    'utf8',
  );
  assert.match(
    src,
    /'install',\s*'--ignore-scripts'/,
    "skills-command.js must pass '--ignore-scripts' as a quoted npm install argv element to prevent lifecycle-script RCE",
  );
});

// ─── MEDIUM: symlink SKILL.md in a local bundle must be rejected ─────────────
//
// Attack path:
//   Attacker provides a local bundle where skills/evil/SKILL.md is a symlink
//   to an arbitrary file on the host (e.g. ~/.ssh/id_rsa, /etc/passwd).
//   After install, skillforge_get_skill('evil') follows the symlink and returns
//   the sensitive file contents to the MCP client (the model).
//
// Expected: skillsAddCommand throws before copying anything into the store.

test('rejects a local bundle whose SKILL.md is a symlink (prevents arbitrary file read)', async (t) => {
  const storeDir = tmp(t, 'sf-store-sec-');
  const bundle = tmp(t, 'sf-bundle-sec-');

  // Build the malicious bundle: skills/evil/SKILL.md → ../../../secret.txt
  const secretFile = join(bundle, 'secret.txt');
  writeFileSync(secretFile, 'super-secret-content\n');

  const skillDir = join(bundle, 'skills', 'evil');
  mkdirSync(skillDir, { recursive: true });

  // Symlink SKILL.md → secret.txt (simulates ~/.ssh/id_rsa, /etc/passwd, etc.)
  symlinkSync(secretFile, join(skillDir, 'SKILL.md'));

  await assert.rejects(
    () => skillsAddCommand(bundle, { storeDir }),
    /symlink/,
    'skillsAddCommand must throw with a "symlink" message when a bundle contains a symlink SKILL.md',
  );
});

test('still installs a clean bundle after rejecting a symlink bundle (no poisoned state)', async (t) => {
  const storeDir = tmp(t, 'sf-store-sec2-');
  const malicious = tmp(t, 'sf-mal-');
  const clean = tmp(t, 'sf-clean-');

  // Malicious bundle
  const secretFile = join(malicious, 'secret.txt');
  writeFileSync(secretFile, 'do-not-read\n');
  const evilDir = join(malicious, 'skills', 'evil');
  mkdirSync(evilDir, { recursive: true });
  symlinkSync(secretFile, join(evilDir, 'SKILL.md'));

  // Clean bundle
  const goodDir = join(clean, 'skills', 'good');
  mkdirSync(goodDir, { recursive: true });
  writeFileSync(join(goodDir, 'SKILL.md'), '# good\nbody\n');

  // Malicious install must throw
  await assert.rejects(() => skillsAddCommand(malicious, { storeDir }), /symlink/);

  // Clean install must succeed and leave 'good' in the store
  const result = await skillsAddCommand(clean, { storeDir });
  assert.deepEqual(result.installed, ['good']);
  assert.deepEqual(result.skipped, []);
});
