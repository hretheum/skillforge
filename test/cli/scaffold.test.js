import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../../bin/skillforge.js', import.meta.url));

function run(args) {
  return spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });
}

test('--help exits 0 and lists the emit subcommand', () => {
  const r = run(['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /emit/);
});

test('no args prints top-level usage and exits 0', () => {
  const r = run([]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /emit/);
});

test('--version exits 0 and prints a semver', () => {
  const r = run(['--version']);
  assert.equal(r.status, 0);
  assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+/);
});

test('emit --help exits 0 and shows emit usage', () => {
  const r = run(['emit', '--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /emit/);
});

test('unknown command exits nonzero with an unknown command message', () => {
  const r = run(['unknowncmd']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /unknown command/);
});

test('emit without --skill exits nonzero with a clear error', () => {
  const r = run(['emit']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /requires --skill/);
});
