// mcp/server auto-update visibility tests (audit fix #2). A hidden auto-update loop is a silent
// repair anti-pattern: when config.autoUpdate is on, the server used to re-install each available
// bundle on startup AND suppress the notice ("the update has already happened"), swapping the
// model's instruction source with NO operator visibility. The fix keeps the safe autoUpdate=false
// default unchanged, but makes the auto-apply path VISIBLE: it still installs, and it still returns
// a notice (marked autoApplied) that handleListSkills surfaces to the client.
//
// The logic is extracted into applyUpdateNotices({ notices, autoUpdate, addSource }) — a small,
// injectable function (addSource performs the install) so the install/notice behavior is unit-
// testable without a real network, store, or server process.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyUpdateNotices } from '../../src/mcp/server.js';

const AVAILABLE = [
  { source: 'ecc', updateAvailable: true, installed: '1.0.0', latest: '1.1.0' },
  { source: '@scope/bundle', updateAvailable: true, installed: '2.0.0', latest: '2.0.1' },
];
const NONE = [
  { source: 'ecc', updateAvailable: false, installed: '1.0.0', latest: '1.0.0' },
];

test('autoUpdate=false returns the available updates as notices (notify-only, no install)', async () => {
  const calls = [];
  const result = await applyUpdateNotices({
    notices: AVAILABLE,
    autoUpdate: false,
    addSource: async (source) => calls.push(source),
  });
  assert.equal(calls.length, 0, 'must NOT install when autoUpdate is off');
  assert.equal(result.length, 2, 'both available updates surface as notices');
  // The notices are the available updates themselves (current behavior preserved).
  assert.deepEqual(result.map((n) => n.source).sort(), ['@scope/bundle', 'ecc']);
});

test('autoUpdate=true installs each update AND returns a visible auto-applied notice', async () => {
  const calls = [];
  const result = await applyUpdateNotices({
    notices: AVAILABLE,
    autoUpdate: true,
    addSource: async (source) => calls.push(source),
  });
  // It installed every available update via the injected addSource.
  assert.deepEqual(calls.sort(), ['@scope/bundle', 'ecc']);
  // And it did NOT suppress the notice — the operator sees what was auto-installed.
  assert.equal(result.length, 2, 'auto-applied updates must still produce visible notices');
  for (const n of result) {
    assert.equal(n.autoApplied, true, 'each notice marks itself auto-applied');
    assert.equal(typeof n.source, 'string');
  }
});

test('no available updates yields an empty notice array (autoUpdate off)', async () => {
  const result = await applyUpdateNotices({
    notices: NONE,
    autoUpdate: false,
    addSource: async () => {},
  });
  assert.deepEqual(result, []);
});

test('no available updates yields an empty notice array and no installs (autoUpdate on)', async () => {
  const calls = [];
  const result = await applyUpdateNotices({
    notices: NONE,
    autoUpdate: true,
    addSource: async (source) => calls.push(source),
  });
  assert.equal(calls.length, 0, 'nothing to install when no updates are available');
  assert.deepEqual(result, []);
});
