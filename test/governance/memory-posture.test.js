// Tests for the memory-posture module: the cross-session memory-scope posture check
// (untrusted-content workflows MUST declare narrow memory) and the checkpoint rotation helper.
//
// Sources: concept + first principles, zero files from any third-party skills-factory codebase
// (clean-room). The posture asserts memory scope AGAINST AN ADAPTER DECLARATION, deny-first: a
// trusted workflow with the persistent default is fine; an untrusted-content workflow that declares
// anything other than narrow — or declares no scope at all (absent inherits persistent) — is a
// violation; a null/non-object adapter is UNPROVEN (fail-closed).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  assertMemoryPosture,
  rotateCheckpoint,
  MEMORY_SCOPE,
  MEMORY_POSTURE,
} from '../../src/governance/index.js';
import { assertPosture } from '../../src/governance/memory-posture.js';

test('MEMORY_POSTURE asserts narrow scope for untrusted content', () => {
  assert.equal(MEMORY_POSTURE.untrustedContentScope, MEMORY_SCOPE.NARROW);
});

test('assertPosture alias === assertMemoryPosture', () => {
  assert.equal(assertPosture, assertMemoryPosture);
});

test('null/non-object adapter → unproven (fail-closed)', () => {
  for (const bad of [null, undefined, 42, 'x', true]) {
    const r = assertMemoryPosture(bad);
    assert.equal(r.ok, false);
    assert.equal(r.findings.length, 1);
    assert.equal(r.findings[0].type, 'unproven');
    assert.match(r.findings[0].detail, /non-null object/);
  }
});

test('unknown memory scope → violation', () => {
  const r = assertMemoryPosture({ memoryScope: 'memory-forever' });
  assert.equal(r.ok, false);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].type, 'violation');
  assert.match(r.findings[0].detail, /unknown memory scope/);
});

test('untrusted content + non-narrow scope → violation', () => {
  const r = assertMemoryPosture({
    processesUntrustedContent: true,
    memoryScope: MEMORY_SCOPE.PERSISTENT,
  });
  assert.equal(r.ok, false);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].type, 'violation');
  assert.match(r.findings[0].detail, /must declare narrow/);
});

test('untrusted content + session scope → violation (session is not narrow)', () => {
  const r = assertMemoryPosture({
    processesUntrustedContent: true,
    memoryScope: MEMORY_SCOPE.SESSION,
  });
  assert.equal(r.ok, false);
  assert.equal(r.findings[0].type, 'violation');
  assert.match(r.findings[0].detail, /must declare narrow/);
});

test('untrusted content + absent scope → violation (absent inherits persistent)', () => {
  const r = assertMemoryPosture({ processesUntrustedContent: true });
  assert.equal(r.ok, false);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].type, 'violation');
  assert.match(r.findings[0].detail, /inherits persistent/);
});

test('untrusted content + narrow scope → ok', () => {
  const r = assertMemoryPosture({
    processesUntrustedContent: true,
    memoryScope: MEMORY_SCOPE.NARROW,
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.findings, []);
});

test('trusted workflow + persistent scope → ok', () => {
  const r = assertMemoryPosture({
    processesUntrustedContent: false,
    memoryScope: MEMORY_SCOPE.PERSISTENT,
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.findings, []);
});

test('empty adapter → ok (trusted default)', () => {
  const r = assertMemoryPosture({});
  assert.equal(r.ok, true);
  assert.deepEqual(r.findings, []);
});

test('result is frozen', () => {
  const r = assertMemoryPosture({});
  assert.ok(Object.isFrozen(r));
  assert.ok(Object.isFrozen(r.findings));
});

// --- rotateCheckpoint ----------------------------------------------------------------------

/** A recording in-memory fs/promises stand-in: writeFile captures the last write. */
function fakeFs(initial = {}) {
  const files = new Map(Object.entries(initial));
  return {
    writes: [],
    async writeFile(path, data, enc) {
      this.writes.push({ path, data, enc });
      files.set(path, data);
    },
    async readFile(path, enc) {
      void enc;
      if (!files.has(path)) {
        const err = new Error(`ENOENT: no such file '${path}'`);
        err.code = 'ENOENT';
        throw err;
      }
      return files.get(path);
    },
    _files: files,
  };
}

test('rotateCheckpoint writes the null-sentinel JSON with a deterministic timestamp', async () => {
  const fs = fakeFs();
  const now = () => '2026-06-10T00:00:00.000Z';
  const out = await rotateCheckpoint('/tmp/brand-state.json', { fs, now });

  assert.deepEqual(out, { rotated: true, path: '/tmp/brand-state.json' });
  assert.equal(fs.writes.length, 1);
  assert.equal(fs.writes[0].path, '/tmp/brand-state.json');

  const written = JSON.parse(fs.writes[0].data);
  assert.equal(written.session, null);
  assert.equal(written.lastRotated, '2026-06-10T00:00:00.000Z');
});

test('rotateCheckpoint creates the file when missing (not an error)', async () => {
  const fs = fakeFs(); // no files at all
  const out = await rotateCheckpoint('/tmp/missing.json', { fs, now: () => 'T' });
  assert.equal(out.rotated, true);
  assert.ok(fs._files.has('/tmp/missing.json'));
});

test('rotateCheckpoint resets an EXISTING checkpoint to the null sentinel', async () => {
  const fs = fakeFs({
    '/tmp/brand-state.json': JSON.stringify({ session: { id: 'planted-fragment' } }),
  });
  await rotateCheckpoint('/tmp/brand-state.json', { fs, now: () => 'T' });
  const written = JSON.parse(fs._files.get('/tmp/brand-state.json'));
  assert.equal(written.session, null);
});

test('rotateCheckpoint default now produces an ISO timestamp', async () => {
  const fs = fakeFs();
  await rotateCheckpoint('/tmp/x.json', { fs });
  const written = JSON.parse(fs.writes[0].data);
  assert.match(written.lastRotated, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

test('rotateCheckpoint propagates an unrecoverable FS error', async () => {
  const fs = {
    async writeFile() {
      const err = new Error('EACCES: permission denied');
      err.code = 'EACCES';
      throw err;
    },
  };
  await assert.rejects(() => rotateCheckpoint('/root/locked.json', { fs }), /EACCES/);
});
