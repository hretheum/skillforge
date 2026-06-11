// Tests for the ECC→SFG import adapter.
//
// Sources: concept + first principles + public ECC specification (github.com/affaan-m/ECC README); zero files from any third-party skills-factory codebase (clean-room).
//
// Covers: parseEccSkill (valid / missing fields / no frontmatter / malformed), the conservative
// registry stub shape and defaults, and fetchEccSkill with an INJECTED fetch (no real HTTP).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseEccSkill,
  eccEntryToRegistryStub,
  fetchEccSkill,
} from '../../src/adapters/ecc-import.js';

const VALID = [
  '---',
  'name: tidy-imports',
  'description: Sort and dedupe import statements',
  'origin: community',
  '---',
  '',
  '# Tidy Imports',
  '',
  'Run over the file and reorder imports.',
].join('\n');

// =====================================================================================
// parseEccSkill
// =====================================================================================

test('parseEccSkill: valid frontmatter -> all fields + body', () => {
  const r = parseEccSkill(VALID);
  assert.equal(r.name, 'tidy-imports');
  assert.equal(r.description, 'Sort and dedupe import statements');
  assert.equal(r.origin, 'community');
  assert.match(r.body, /# Tidy Imports/);
  assert.match(r.body, /reorder imports/);
  assert.equal(r.body.startsWith('---'), false);
});

test('parseEccSkill: missing fields -> nulls, body still parsed', () => {
  const text = ['---', 'name: only-name', '---', 'body here'].join('\n');
  const r = parseEccSkill(text);
  assert.equal(r.name, 'only-name');
  assert.equal(r.description, null);
  assert.equal(r.origin, null);
  assert.equal(r.body, 'body here');
});

test('parseEccSkill: no frontmatter -> all nulls, whole text is body', () => {
  const text = '# Just a heading\n\nno frontmatter at all';
  const r = parseEccSkill(text);
  assert.equal(r.name, null);
  assert.equal(r.description, null);
  assert.equal(r.origin, null);
  assert.equal(r.body, text);
});

test('parseEccSkill: malformed YAML (unclosed fence) -> nulls, all body', () => {
  const text = ['---', 'name: broken', 'description: no closing fence', 'still going'].join('\n');
  const r = parseEccSkill(text);
  assert.equal(r.name, null);
  assert.equal(r.description, null);
  assert.equal(r.body, text);
});

test('parseEccSkill: tolerates quotes, comments, and blank lines in frontmatter', () => {
  const text = [
    '---',
    '# a comment',
    'name: "quoted-name"',
    '',
    "description: 'single quoted'",
    'origin: ECC',
    'not-a-kv-line',
    '---',
    'body',
  ].join('\n');
  const r = parseEccSkill(text);
  assert.equal(r.name, 'quoted-name');
  assert.equal(r.description, 'single quoted');
  assert.equal(r.origin, 'ECC');
});

test('parseEccSkill: non-string input -> safe empty result', () => {
  const r = parseEccSkill(undefined);
  assert.equal(r.name, null);
  assert.equal(r.body, '');
});

// =====================================================================================
// eccEntryToRegistryStub
// =====================================================================================

test('eccEntryToRegistryStub: conservative defaults for a complete parse', () => {
  const stub = eccEntryToRegistryStub(parseEccSkill(VALID));
  assert.equal(stub.enabled, false);
  assert.equal(stub.owner, 'imported-ecc');
  assert.equal(stub.skillKind, 'instruction');
  assert.equal(stub.description, 'Sort and dedupe import statements');
  assert.equal(stub.origin, 'community');
  assert.deepEqual(stub.requiredTools, []);
  assert.deepEqual(stub.requiredAdapters, { input: [], output: [] });
  assert.deepEqual(stub.requiredSecrets, []);
  assert.deepEqual(stub.scope, { clients: ['*'], projects: ['*'] });
  assert.equal(stub.model, 'inherit');
  assert.equal(stub._importSource, 'ecc');
  assert.equal(stub._importName, 'tidy-imports');
});

test('eccEntryToRegistryStub: capability fields always carry a TODO note', () => {
  const stub = eccEntryToRegistryStub(parseEccSkill(VALID));
  const joined = stub._importNotes.join('\n');
  assert.match(joined, /requiredTools: \/\/ TODO: fill in/);
  assert.match(joined, /requiredAdapters: \/\/ TODO: fill in/);
  assert.match(joined, /requiredSecrets: \/\/ TODO: fill in/);
  assert.match(joined, /compose: \/\/ TODO: fill in/);
});

test('eccEntryToRegistryStub: missing name/description add their own TODO notes + null origin defaults to ECC', () => {
  const stub = eccEntryToRegistryStub({ name: null, description: null, origin: null, body: '' });
  const joined = stub._importNotes.join('\n');
  assert.match(joined, /name: \/\/ TODO: fill in/);
  assert.match(joined, /description: \/\/ TODO: fill in/);
  assert.equal(stub.origin, 'ECC');
  assert.equal(stub._importName, null);
  assert.equal(stub.description, null);
});

test('eccEntryToRegistryStub: undefined input does not throw', () => {
  const stub = eccEntryToRegistryStub(undefined);
  assert.equal(stub.enabled, false);
  assert.equal(stub.owner, 'imported-ecc');
});

// =====================================================================================
// fetchEccSkill (injected fetch — no real HTTP)
// =====================================================================================

test('fetchEccSkill: injected fetch returns mock SKILL.md -> correct parse', async () => {
  let calledUrl = null;
  const stubFetch = async (url) => {
    calledUrl = url;
    return { ok: true, status: 200, async text() { return VALID; } };
  };
  const r = await fetchEccSkill('tidy-imports', { fetch: stubFetch });
  assert.equal(r.name, 'tidy-imports');
  assert.equal(r.origin, 'community');
  assert.equal(calledUrl, 'https://raw.githubusercontent.com/affaan-m/ECC/main/skills/tidy-imports/SKILL.md');
});

test('fetchEccSkill: url-encodes the skill name', async () => {
  let calledUrl = null;
  const stubFetch = async (url) => {
    calledUrl = url;
    return { ok: true, status: 200, async text() { return VALID; } };
  };
  await fetchEccSkill('weird name', { fetch: stubFetch });
  assert.match(calledUrl, /skills\/weird%20name\/SKILL\.md$/);
});

test('fetchEccSkill: non-ok response -> throws with status', async () => {
  const stubFetch = async () => ({ ok: false, status: 404, async text() { return ''; } });
  await assert.rejects(
    () => fetchEccSkill('missing', { fetch: stubFetch }),
    /status 404/,
  );
});

test('fetchEccSkill: empty skill name -> throws', async () => {
  await assert.rejects(
    () => fetchEccSkill('', { fetch: async () => ({ ok: true, async text() { return ''; } }) }),
    /non-empty string/,
  );
});

test('fetchEccSkill: no fetch implementation -> throws', async () => {
  await assert.rejects(
    () => fetchEccSkill('x', { fetch: null }),
    /no fetch implementation/,
  );
});
