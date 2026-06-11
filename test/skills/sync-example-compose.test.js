// Tests for the sync-example compose step: the minimal bidirectional sync recipe that
// proves the `sync` kind is live in the registry.
//
// Sources: concept + first principles, zero third-party skills-factory files (clean-room).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeSync } from '../../src/skills/sync-example/compose.js';
import { syncDescriptor } from '../../src/registry/kinds/index.js';
import { resolveComposeRef } from '../../src/skills/compose-registry.js';

test('composeSync returns gateable write intents for BOTH sides', () => {
  const out = composeSync({
    request: { client: 'acme', leftPath: 'acme/left.json', rightPath: 'acme/right.json' },
    description: { envelope: { kind: 'design-system' } },
  });
  assert.equal(out.intents.length, 2);
  assert.deepEqual(out.intents.map((i) => i.tool), ['Write', 'Write']);
  assert.deepEqual(out.intents.map((i) => i.toolInput.file_path), ['acme/left.json', 'acme/right.json']);
  // the output satisfies the sync descriptor's compose contract
  assert.deepEqual(syncDescriptor.compose.validateOutput(out), []);
});

test('composeSync defaults the side paths off the client handle', () => {
  const out = composeSync({ request: { client: 'beta' } });
  assert.deepEqual(out.intents.map((i) => i.toolInput.file_path), ['beta/sync-left.json', 'beta/sync-right.json']);
});

test('composeSync rejects a non-object request', () => {
  assert.throws(() => composeSync({ request: null }), /must be an object/);
});

test('the sync-example compose ref resolves to composeSync', () => {
  assert.equal(resolveComposeRef('sync-example/compose.js#composeSync'), composeSync);
});
