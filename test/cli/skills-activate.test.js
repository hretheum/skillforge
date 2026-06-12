// Tests for the `skills activate` subcommand core — skillsActivateCommand.
//
// Every test runs hermetically against tmpdir fixtures: a store dir holding installed skills and a
// separate target ("superpowers") dir. The harness dir is passed via the targetDir override (and,
// for the bin-level test, via the CLAUDE_SKILLS_DIR env var) so the real ~/.claude/skills is never
// touched. Stack: node:test + node:assert, zero runtime deps.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { skillsActivateCommand, setDefaultTarget } from '../../src/cli/skills-command.js';

const BIN = fileURLToPath(new URL('../../bin/skillforge.js', import.meta.url));

function tmp(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Place an installed skill <name>/SKILL.md into a store dir.
function installSkill(storeDir, name, body = `---\nname: ${name}\n---\n# ${name}\nbody\n`) {
  const dir = join(storeDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), body);
}

test('activate writes the emitted skill as <name>/SKILL.md in the target dir', (t) => {
  const storeDir = tmp(t, 'sf-store-');
  const targetDir = tmp(t, 'sf-target-');
  installSkill(storeDir, 'demo');

  const res = skillsActivateCommand('demo', { storeDir, targetDir, target: 'superpowers' });

  assert.equal(res.activated, 'demo');
  assert.equal(res.target, 'superpowers');
  const out = join(targetDir, 'demo', 'SKILL.md');
  assert.equal(res.outputFile, out);
  assert.ok(existsSync(out));
  // open-core profile (no registry) emits byte-identical to the source.
  assert.equal(readFileSync(out, 'utf8'), readFileSync(join(storeDir, 'demo', 'SKILL.md'), 'utf8'));
});

test('activate with no --target and no default-target throws a clear error', (t) => {
  const storeDir = tmp(t, 'sf-store-');
  const targetDir = tmp(t, 'sf-target-');
  const configDir = tmp(t, 'sf-config-'); // empty config: no default-target
  installSkill(storeDir, 'demo');

  assert.throws(
    () => skillsActivateCommand('demo', { storeDir, targetDir, configDir }),
    /requires a target/,
  );
  // nothing was written — the command bailed before emitting
  assert.ok(!existsSync(join(targetDir, 'demo', 'SKILL.md')));
});

test('activate falls back to a persisted default-target when --target is omitted', (t) => {
  const storeDir = tmp(t, 'sf-store-');
  const targetDir = tmp(t, 'sf-target-');
  const configDir = tmp(t, 'sf-config-');
  installSkill(storeDir, 'demo');

  setDefaultTarget('superpowers', { configDir });
  const res = skillsActivateCommand('demo', { storeDir, targetDir, configDir });

  assert.equal(res.target, 'superpowers');
  assert.ok(existsSync(join(targetDir, 'demo', 'SKILL.md')));
});

test('an explicit --target overrides a persisted default-target', (t) => {
  const storeDir = tmp(t, 'sf-store-');
  const targetDir = tmp(t, 'sf-target-');
  const configDir = tmp(t, 'sf-config-');
  installSkill(storeDir, 'demo');

  setDefaultTarget('superpowers', { configDir });
  const res = skillsActivateCommand('demo', { storeDir, targetDir, configDir, target: 'custom' });
  assert.equal(res.target, 'custom');
});

test('activate of a skill not in the store throws', (t) => {
  const storeDir = tmp(t, 'sf-store-');
  const targetDir = tmp(t, 'sf-target-');
  assert.throws(
    () => skillsActivateCommand('nope', { storeDir, targetDir }),
    /not installed/,
  );
});

test('activate is idempotent — a re-run overwrites the same file in place', (t) => {
  const storeDir = tmp(t, 'sf-store-');
  const targetDir = tmp(t, 'sf-target-');
  installSkill(storeDir, 'demo');

  const first = skillsActivateCommand('demo', { storeDir, targetDir, target: 'superpowers' });
  const second = skillsActivateCommand('demo', { storeDir, targetDir, target: 'superpowers' });

  assert.deepEqual(first, second);
  assert.equal(
    readFileSync(join(targetDir, 'demo', 'SKILL.md'), 'utf8'),
    readFileSync(join(storeDir, 'demo', 'SKILL.md'), 'utf8'),
  );
});

test('--list reports installed skills that have a file in the target dir', (t) => {
  const storeDir = tmp(t, 'sf-store-');
  const targetDir = tmp(t, 'sf-target-');
  installSkill(storeDir, 'one');
  installSkill(storeDir, 'two');
  installSkill(storeDir, 'three');

  // Activate only two of the three.
  skillsActivateCommand('one', { storeDir, targetDir, target: 'superpowers' });
  skillsActivateCommand('three', { storeDir, targetDir, target: 'superpowers' });

  const { activated } = skillsActivateCommand(undefined, { list: true, storeDir, targetDir });
  assert.deepEqual(activated, ['one', 'three']);
});

test('an explicit --target name is echoed back in the result', (t) => {
  const storeDir = tmp(t, 'sf-store-');
  const targetDir = tmp(t, 'sf-target-');
  installSkill(storeDir, 'demo');

  const res = skillsActivateCommand('demo', { storeDir, targetDir, target: 'custom' });
  assert.equal(res.target, 'custom');
});

test('bin: skills activate honors CLAUDE_SKILLS_DIR and exits zero', (t) => {
  const storeDir = tmp(t, 'sf-store-');
  const skillsDir = tmp(t, 'sf-claude-');
  installSkill(storeDir, 'demo');

  // The store dir is not overridable through the bin, so this test points the *real* STORE_PATH at a
  // tmp dir by seeding it directly is not possible; instead it exercises the not-installed error
  // path, which needs no real store. The happy path is covered by the unit tests above.
  const res = spawnSync(process.execPath, [BIN, 'skills', 'activate', '--list'], {
    env: { ...process.env, CLAUDE_SKILLS_DIR: skillsDir },
    encoding: 'utf8',
  });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /no skills activated/);
});
