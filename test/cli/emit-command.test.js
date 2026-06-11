import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { emitCommand } from '../../src/cli/emit-command.js';

const SKILL = fileURLToPath(new URL('../fixtures/sample-skill.md', import.meta.url));
const REGISTRY = fileURLToPath(new URL('../fixtures/sample-registry.json', import.meta.url));
const BIN = fileURLToPath(new URL('../../bin/skillforge.js', import.meta.url));

function freshOut() {
  return mkdtempSync(join(tmpdir(), 'sfg-emit-'));
}

test('emit open-core produces an output file, byte-identical to the source', async () => {
  const out = freshOut();
  try {
    const res = await emitCommand({ skill: SKILL, profile: 'open-core', out });
    assert.equal(res.ok, true);
    assert.equal(res.profile, 'open-core');
    const emitted = join(out, 'sample-skill.md');
    assert.ok(res.outputFiles.includes(emitted));
    assert.equal(readFileSync(emitted, 'utf8'), readFileSync(SKILL, 'utf8'));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('emit defaults to open-core when no profile is given', async () => {
  const out = freshOut();
  try {
    const res = await emitCommand({ skill: SKILL, out });
    assert.equal(res.profile, 'open-core');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('emit claude with --registry produces claude-flavoured output + companions', async () => {
  const out = freshOut();
  try {
    const res = await emitCommand({ skill: SKILL, profile: 'claude', registry: REGISTRY, out });
    assert.equal(res.profile, 'claude');
    const emitted = join(out, 'sample-skill.md');
    const text = readFileSync(emitted, 'utf8');
    assert.match(text, /skillforge:claude-flavour/);
    // a companion slash-command file is written under the out dir
    assert.ok(existsSync(join(out, 'commands', 'sample-skill.md')));
    assert.ok(res.outputFiles.length > 1);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('bin: emit claude auto-discovers skillforge.registry.json in the cwd (no --registry flag)', () => {
  const work = mkdtempSync(join(tmpdir(), 'sfg-cwd-'));
  try {
    const skillMd = [
      '---',
      'name: sample-skill',
      'description: A minimal sample skill used as an emit fixture. It does nothing real.',
      '---',
      '',
      '# Sample Skill',
      '',
      'Auto-discovery fixture body.',
      '',
    ].join('\n');
    writeFileSync(join(work, 'sample-skill.md'), skillMd);

    const registry = {
      schemaVersion: '1',
      skills: {
        'sample-skill': {
          version: '0.1.0',
          enabled: true,
          owner: 'platform',
          skillKind: 'instruction',
          requiredTools: ['Read', 'Write'],
          scope: { clients: ['*'], projects: ['*'] },
          model: 'inherit',
          effort: 'high',
        },
      },
    };
    writeFileSync(join(work, 'skillforge.registry.json'), JSON.stringify(registry, null, 2));

    const out = join(work, 'out');
    const r = spawnSync(
      process.execPath,
      [BIN, 'emit', '--skill', 'sample-skill.md', '--profile', 'claude', '--out', out],
      { cwd: work, encoding: 'utf8' },
    );
    assert.equal(r.status, 0, r.stderr);
    const emitted = join(out, 'sample-skill.md');
    assert.ok(existsSync(emitted));
    assert.match(readFileSync(emitted, 'utf8'), /skillforge:claude-flavour/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('emit codex with --registry produces codex-flavoured output', async () => {
  const out = freshOut();
  try {
    const res = await emitCommand({ skill: SKILL, profile: 'codex', registry: REGISTRY, out });
    assert.equal(res.profile, 'codex');
    const text = readFileSync(join(out, 'sample-skill.md'), 'utf8');
    assert.match(text, /skillforge:codex-flavour/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('unknown profile rejects with a message listing known profiles', async () => {
  const out = freshOut();
  try {
    await assert.rejects(
      () => emitCommand({ skill: SKILL, profile: 'nope', out }),
      /unknown profile "nope".*open-core/s,
    );
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('missing --skill rejects with a clear message', async () => {
  await assert.rejects(() => emitCommand({ profile: 'open-core' }), /requires --skill/);
});

test('nonexistent --skill path rejects', async () => {
  await assert.rejects(
    () => emitCommand({ skill: '/no/such/skill.md', profile: 'open-core' }),
    /does not exist/,
  );
});

test('claude profile without a discoverable registry rejects', async () => {
  const out = freshOut();
  try {
    await assert.rejects(
      () => emitCommand({ skill: SKILL, profile: 'claude', registry: '/no/such/registry.json', out }),
      /requires a registry/,
    );
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('out dir is created if it does not exist', async () => {
  const base = freshOut();
  try {
    const nested = join(base, 'deep', 'nested', 'out');
    assert.equal(existsSync(nested), false);
    await emitCommand({ skill: SKILL, profile: 'open-core', out: nested });
    assert.ok(existsSync(join(nested, 'sample-skill.md')));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('bin: emit --skill --profile open-core writes a file and prints it', () => {
  const out = freshOut();
  try {
    const r = spawnSync(
      process.execPath,
      [BIN, 'emit', '--skill', SKILL, '--profile', 'open-core', '--out', out],
      { encoding: 'utf8' },
    );
    assert.equal(r.status, 0);
    assert.match(r.stdout, /sample-skill\.md/);
    assert.ok(existsSync(join(out, 'sample-skill.md')));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('bin: emit without --skill exits nonzero with a clear error', () => {
  const r = spawnSync(process.execPath, [BIN, 'emit'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /requires --skill/);
});

test('bin: emit --help still works', () => {
  const r = spawnSync(process.execPath, [BIN, 'emit', '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /--skill/);
});

const SKILL_BODY = [
  '---',
  'name: my-skill',
  'description: name-resolution fixture. It does nothing real.',
  '---',
  '',
  '# My Skill',
  '',
  'Body.',
  '',
].join('\n');

test('emit by name resolves from .claude/skills/', async () => {
  const work = mkdtempSync(join(tmpdir(), 'sfg-kan109-local-'));
  const prevCwd = process.cwd();
  try {
    const skillDir = join(work, '.claude', 'skills', 'my-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), SKILL_BODY);
    const out = join(work, 'out');
    process.chdir(work);
    const res = await emitCommand({ skill: 'my-skill', out });
    assert.equal(res.ok, true);
    assert.equal(res.skillName, 'my-skill');
    assert.ok(existsSync(join(out, 'my-skill.md')));
  } finally {
    process.chdir(prevCwd);
    rmSync(work, { recursive: true, force: true });
  }
});

test('emit by name resolves from global store', () => {
  // Drive the real ~/.skillforge resolution by pointing HOME at a temp store, in a subprocess so
  // the store module recomputes STORE_PATH from the overridden home.
  const home = mkdtempSync(join(tmpdir(), 'sfg-kan109-home-'));
  try {
    const skillDir = join(home, '.skillforge', 'skills', 'my-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), SKILL_BODY);
    const out = join(home, 'out');
    const r = spawnSync(
      process.execPath,
      [BIN, 'emit', '--skill', 'my-skill', '--profile', 'open-core', '--out', out],
      { cwd: home, encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } },
    );
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(join(out, 'my-skill.md')));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('emit by name fails with known-names list when not found', async () => {
  const work = mkdtempSync(join(tmpdir(), 'sfg-kan109-miss-'));
  const prevCwd = process.cwd();
  try {
    const skillDir = join(work, '.claude', 'skills', 'present-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), SKILL_BODY);
    process.chdir(work);
    await assert.rejects(
      () => emitCommand({ skill: 'absent-skill' }),
      /not found.*Known skills.*present-skill/s,
    );
  } finally {
    process.chdir(prevCwd);
    rmSync(work, { recursive: true, force: true });
  }
});

test('emit open-core: canonical skills/NAME/SKILL.md layout derives name from parent dir', async () => {
  const base = mkdtempSync(join(tmpdir(), 'sfg-kan106-'));
  try {
    const skillDir = join(base, 'my-skill');
    const { mkdirSync: mkdir } = await import('node:fs');
    mkdir(skillDir, { recursive: true });
    const skillMd = [
      '---',
      'name: my-skill',
      'description: canonical layout test.',
      '---',
      '',
      '# My Skill',
      '',
      'Body.',
    ].join('\n');
    writeFileSync(join(skillDir, 'SKILL.md'), skillMd);
    const out = join(base, 'out');
    const res = await emitCommand({ skill: join(skillDir, 'SKILL.md'), profile: 'open-core', out });
    assert.equal(res.ok, true);
    assert.equal(res.skillName, 'my-skill', 'name must come from parent directory, not basename "SKILL"');
    assert.ok(existsSync(join(out, 'my-skill.md')), 'output file must be named my-skill.md');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
