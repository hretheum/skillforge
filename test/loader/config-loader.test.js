// Tests for the client config loader (T-MVP-02).
//
// Covers the happy path (loads the real Example Studio config) and the failure paths of the
// validate-before-acting chain: each link must fail LOUD and EARLY with a LoaderError that
// names the failing gate. Temp fixtures keep failure-path cases independent of the committed
// Example Studio config. Stack: node:test + node:assert, zero runtime deps.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadClientConfig,
  createAdapterRegistry,
  defaultAdapterRegistry,
  LoaderError,
  isLoaderError,
  GATES,
  assertDataOnly,
} from '../../src/loader/index.js';
import { profileEvaluator, PROFILES } from '../../src/governance/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const realClientsDir = join(repoRoot, 'clients');

// --- temp-fixture helper ----------------------------------------------------------------
// Build a throwaway clients_dir with one client whose config is the given object. Returns
// the clients_dir path; registers cleanup with the test context.
function makeClient(t, { client = 'acme', config, extraFiles = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sf-loader-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const clientDir = join(dir, client);
  mkdirSync(clientDir, { recursive: true });
  if (config !== undefined) {
    const body = typeof config === 'string' ? config : JSON.stringify(config, null, 2);
    writeFileSync(join(clientDir, 'config.json'), body);
  }
  for (const [rel, content] of Object.entries(extraFiles)) {
    const p = join(clientDir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  return dir;
}

const goodConfig = (over = {}) => ({
  identity: { identifier: 'acme', displayName: 'Acme Corp' },
  adapters: { input: 'dtcg-tokens', output: 'react' },
  references: {},
  ...over,
});

// =====================================================================================
// Happy path
// =====================================================================================

test('loads the real Example Studio config end-to-end', () => {
  const ctx = loadClientConfig({ clientsDir: realClientsDir, client: 'example-studio' });
  assert.equal(ctx.identifier, 'example-studio');
  assert.equal(ctx.displayName, 'Example Studio');
  assert.equal(ctx.adapters.input, 'dtcg-tokens');
  assert.equal(ctx.adapters.output, 'react');
  assert.equal(ctx.profile, 'compliance');
  // local references resolve to an absolute path; the figma:// handle is accepted as a
  // well-formed non-local address (resolved later by the input adapter).
  assert.equal(ctx.references.tokenHub.local, true);
  assert.ok(ctx.references.tokenHub.resolvedPath);
  assert.equal(ctx.references.designSystemSource.local, false);
  assert.equal(ctx.references.designSystemSource.resolvedPath, null);
  assert.deepEqual(ctx.secretRefs, ['example-studio/ds/figma/api-token']);
  // client-has-skill (conjunct 2): BC has ADOPTED create-component and the competitive skills.
  assert.ok(ctx.skills.includes('create-component'), 'must include create-component');
  assert.ok(ctx.skills.includes('competitive-platform-analysis'), 'must include competitive-platform-analysis');
  assert.ok(ctx.skills.includes('benchmark-methodology'), 'must include benchmark-methodology');
  assert.ok(ctx.skills.includes('competitive-report-structure'), 'must include competitive-report-structure');
});

test('loads a minimal valid config from a temp clients_dir', (t) => {
  const dir = makeClient(t, { config: goodConfig() });
  const ctx = loadClientConfig({ clientsDir: dir, client: 'acme' });
  assert.equal(ctx.identifier, 'acme');
  assert.equal(ctx.profile, null); // profile is optional
});

// --- skills (client adoption — docs/06 §client-has-skill, conjunct 2) -------------------

test('skills: absent in config -> [] (adopts nothing; deny-first / silence = not adopted)', (t) => {
  const dir = makeClient(t, { config: goodConfig() }); // goodConfig has no `skills`
  const ctx = loadClientConfig({ clientsDir: dir, client: 'acme' });
  assert.deepEqual(ctx.skills, []);
});

test('skills: a declared list is returned as string[]', (t) => {
  const dir = makeClient(t, { config: goodConfig({ skills: ['create-component', 'write-tests'] }) });
  const ctx = loadClientConfig({ clientsDir: dir, client: 'acme' });
  assert.deepEqual(ctx.skills, ['create-component', 'write-tests']);
});

test('skills: non-string entries are filtered out (read is always .includes-safe)', (t) => {
  const dir = makeClient(t, { config: goodConfig({ skills: ['create-component', 42, null, { x: 1 }] }) });
  const ctx = loadClientConfig({ clientsDir: dir, client: 'acme' });
  assert.deepEqual(ctx.skills, ['create-component']);
});

test('skills: a non-array `skills` value -> [] (treated as no adoption)', (t) => {
  const dir = makeClient(t, { config: goodConfig({ skills: 'create-component' }) });
  const ctx = loadClientConfig({ clientsDir: dir, client: 'acme' });
  assert.deepEqual(ctx.skills, []);
});

// =====================================================================================
// Link 1 — clients_dir
// =====================================================================================

test('missing clients_dir fails LOUD at the clients-dir gate (startup error)', () => {
  assert.throws(
    () => loadClientConfig({ client: 'example-studio' }),
    (e) => isLoaderError(e) && e.gate === GATES.CLIENTS_DIR,
  );
});

test('non-existent clients_dir fails at the clients-dir gate', () => {
  assert.throws(
    () => loadClientConfig({ clientsDir: '/no/such/dir/anywhere', client: 'acme' }),
    (e) => e instanceof LoaderError && e.gate === GATES.CLIENTS_DIR,
  );
});

// =====================================================================================
// Link 2 — client
// =====================================================================================

test('missing client identifier fails at the client gate', (t) => {
  const dir = makeClient(t, { config: goodConfig() });
  assert.throws(
    () => loadClientConfig({ clientsDir: dir }),
    (e) => e.gate === GATES.CLIENT,
  );
});

test('unknown client fails at the client gate', () => {
  assert.throws(
    () => loadClientConfig({ clientsDir: realClientsDir, client: 'does-not-exist' }),
    (e) => e.gate === GATES.CLIENT && /not found/.test(e.message),
  );
});

// =====================================================================================
// Link 3 — config (parse + structure + data-only + identity match)
// =====================================================================================

test('non-JSON config fails at the config gate', (t) => {
  const dir = makeClient(t, { config: '{ this is not json' });
  assert.throws(
    () => loadClientConfig({ clientsDir: dir, client: 'acme' }),
    (e) => e.gate === GATES.CONFIG && /not valid JSON/.test(e.message),
  );
});

test('config that is a JSON array (not object) fails at the config gate', (t) => {
  const dir = makeClient(t, { config: '[]' });
  assert.throws(
    () => loadClientConfig({ clientsDir: dir, client: 'acme' }),
    (e) => e.gate === GATES.CONFIG,
  );
});

test('missing identity fails at the config gate', (t) => {
  const cfg = goodConfig();
  delete cfg.identity;
  const dir = makeClient(t, { config: cfg });
  assert.throws(
    () => loadClientConfig({ clientsDir: dir, client: 'acme' }),
    (e) => e.gate === GATES.CONFIG && e.field === 'identity',
  );
});

test('missing displayName fails at the config gate naming the field', (t) => {
  const cfg = goodConfig({ identity: { identifier: 'acme' } });
  const dir = makeClient(t, { config: cfg });
  assert.throws(
    () => loadClientConfig({ clientsDir: dir, client: 'acme' }),
    (e) => e.gate === GATES.CONFIG && e.field === 'displayName',
  );
});

test('identity.identifier mismatching the directory fails at the config gate', (t) => {
  const cfg = goodConfig({ identity: { identifier: 'other', displayName: 'Other' } });
  const dir = makeClient(t, { client: 'acme', config: cfg });
  assert.throws(
    () => loadClientConfig({ clientsDir: dir, client: 'acme' }),
    (e) => e.gate === GATES.CONFIG && /does not match/.test(e.message),
  );
});

// =====================================================================================
// Link 4 — adapters (selected by name, must exist in the registry)
// =====================================================================================

test('unknown input adapter fails LOUD at the adapters gate', (t) => {
  const cfg = goodConfig({ adapters: { input: 'typo-reader', output: 'react' } });
  const dir = makeClient(t, { config: cfg });
  assert.throws(
    () => loadClientConfig({ clientsDir: dir, client: 'acme' }),
    (e) => e.gate === GATES.ADAPTERS && e.subject === 'typo-reader',
  );
});

test('unknown output adapter fails at the adapters gate', (t) => {
  const cfg = goodConfig({ adapters: { input: 'dtcg-tokens', output: 'nope' } });
  const dir = makeClient(t, { config: cfg });
  assert.throws(
    () => loadClientConfig({ clientsDir: dir, client: 'acme' }),
    (e) => e.gate === GATES.ADAPTERS && e.field === 'adapters.output',
  );
});

test('a custom registry can extend the known adapters', (t) => {
  const cfg = goodConfig({ adapters: { input: 'jira', output: 'openapi' } });
  const dir = makeClient(t, { config: cfg });
  const registry = createAdapterRegistry({ input: ['jira'], output: ['openapi'] });
  const ctx = loadClientConfig({ clientsDir: dir, client: 'acme', adapterRegistry: registry });
  assert.equal(ctx.adapters.input, 'jira');
});

// =====================================================================================
// Link 5 — references (address must resolve; non-local handle accepted)
// =====================================================================================

test('unresolvable local reference fails LOUD at the references gate', (t) => {
  const cfg = goodConfig({ references: { tokens: './resources/missing.json' } });
  const dir = makeClient(t, { config: cfg });
  assert.throws(
    () => loadClientConfig({ clientsDir: dir, client: 'acme' }),
    (e) => e.gate === GATES.REFERENCES && /cannot open the resource/.test(e.message),
  );
});

test('resolvable local reference passes and is resolved to an absolute path', (t) => {
  const cfg = goodConfig({ references: { tokens: './resources/tokens.json' } });
  const dir = makeClient(t, {
    config: cfg,
    extraFiles: { 'resources/tokens.json': '{}' },
  });
  const ctx = loadClientConfig({ clientsDir: dir, client: 'acme' });
  assert.equal(ctx.references.tokens.local, true);
  assert.ok(resolve(ctx.references.tokens.resolvedPath));
});

test('non-local handle (scheme://) is accepted without filesystem resolution', (t) => {
  const cfg = goodConfig({ references: { ds: 'figma://abc123' } });
  const dir = makeClient(t, { config: cfg });
  const ctx = loadClientConfig({ clientsDir: dir, client: 'acme' });
  assert.equal(ctx.references.ds.local, false);
  assert.equal(ctx.references.ds.resolvedPath, null);
});

// =====================================================================================
// Tenancy isolation (T-P3-03 / ARCH-06) — the per-client subtree is the isolation unit:
// a client's local reference may resolve only INSIDE its own subtree. A reference that escapes
// (../other-client/…, or an absolute path into a sibling) must be REFUSED at the references gate,
// before any adapter opens the file — otherwise the loader silently cross-reads another tenant.
// =====================================================================================

// Build two co-resident clients in one clients_dir; client `victim` owns a private resource,
// client `attacker` is given the config under test (which may try to escape into victim's subtree).
function makeTwoClients(t, { attackerConfig } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sf-tenancy-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // victim — owns a "private" resource a sibling must not be able to read.
  const victimDir = join(dir, 'victim');
  mkdirSync(join(victimDir, 'resources'), { recursive: true });
  writeFileSync(join(victimDir, 'config.json'), JSON.stringify({
    identity: { identifier: 'victim', displayName: 'Victim' },
    adapters: { input: 'dtcg-tokens', output: 'react' },
    references: {},
  }));
  // A marker the cross-read test would surface — deliberately NOT credential-shaped (no
  // secret-ish key=value), so secret-scan does not false-positive on this synthetic fixture.
  writeFileSync(join(victimDir, 'resources', 'private.json'), '{"victimOnlyMarker":"do-not-cross-read"}');
  // attacker — the config under test.
  const attackerDir = join(dir, 'attacker');
  mkdirSync(join(attackerDir, 'resources'), { recursive: true });
  writeFileSync(join(attackerDir, 'config.json'), JSON.stringify(attackerConfig, null, 2));
  writeFileSync(join(attackerDir, 'resources', 'own.json'), '{}');
  return { dir, victimDir };
}

const attackerBase = (references) => ({
  identity: { identifier: 'attacker', displayName: 'Attacker' },
  adapters: { input: 'dtcg-tokens', output: 'react' },
  references,
});

test('tenancy: a ../sibling reference escaping the subtree is refused at the references gate', (t) => {
  const { dir } = makeTwoClients(t, {
    attackerConfig: attackerBase({ tokens: '../victim/resources/private.json' }),
  });
  assert.throws(
    () => loadClientConfig({ clientsDir: dir, client: 'attacker' }),
    (e) => e.gate === GATES.REFERENCES && /escapes client .* subtree/.test(e.message),
  );
});

test('tenancy: an ABSOLUTE reference into a sibling subtree is refused at the references gate', (t) => {
  const { dir, victimDir } = makeTwoClients(t, {
    // built below once we know victimDir's absolute path
    attackerConfig: attackerBase({ tokens: 'placeholder' }),
  });
  // Rewrite the attacker config with the victim's REAL absolute path (a path that exists, so the
  // refusal is the containment check firing — not merely "file not found").
  const abs = join(victimDir, 'resources', 'private.json');
  writeFileSync(
    join(dir, 'attacker', 'config.json'),
    JSON.stringify(attackerBase({ tokens: abs }), null, 2),
  );
  assert.throws(
    () => loadClientConfig({ clientsDir: dir, client: 'attacker' }),
    (e) => e.gate === GATES.REFERENCES && /escapes client .* subtree/.test(e.message),
  );
});

test('tenancy: a legitimate within-subtree reference still resolves (the guard is not over-broad)', (t) => {
  const { dir } = makeTwoClients(t, {
    attackerConfig: attackerBase({ tokens: './resources/own.json' }),
  });
  const ctx = loadClientConfig({ clientsDir: dir, client: 'attacker' });
  assert.equal(ctx.references.tokens.local, true);
  assert.ok(ctx.references.tokens.resolvedPath.endsWith(join('attacker', 'resources', 'own.json')));
});

test('tenancy: a non-local scheme:// reference is unaffected by containment (names no fs path)', (t) => {
  const { dir } = makeTwoClients(t, {
    attackerConfig: attackerBase({ ds: 'figma://shared-but-not-a-path' }),
  });
  const ctx = loadClientConfig({ clientsDir: dir, client: 'attacker' });
  assert.equal(ctx.references.ds.local, false);
  assert.equal(ctx.references.ds.resolvedPath, null);
});

// =====================================================================================
// Link 6 — profile (call the evaluator; deny stops the loader)
// =====================================================================================

test('profile-evaluator deny stops the loader at the profile gate', (t) => {
  const cfg = goodConfig({ profile: 'compliance' });
  const dir = makeClient(t, { config: cfg });
  const denyFilesApi = {
    evaluate: (profile, feature) =>
      feature === 'files-api' && profile === 'compliance'
        ? { decision: 'deny', reason: 'Files API forbidden under compliance' }
        : { decision: 'allow' },
  };
  assert.throws(
    () =>
      loadClientConfig({
        clientsDir: dir,
        client: 'acme',
        profileEvaluator: denyFilesApi,
        requiredFeatures: ['files-api'],
      }),
    (e) => e.gate === GATES.PROFILE && /Files API forbidden/.test(e.message),
  );
});

test('default evaluator defers (allows) so the profile link does not block', (t) => {
  const cfg = goodConfig({ profile: 'compliance' });
  const dir = makeClient(t, { config: cfg });
  // even with required features, the default defer-all evaluator lets it through
  const ctx = loadClientConfig({
    clientsDir: dir,
    client: 'acme',
    requiredFeatures: ['files-api', 'batch'],
  });
  assert.equal(ctx.profile, 'compliance');
});

// --- loader + REAL profile-evaluator (T-MVP-03 wired in), deny-first consumption ---------

test('loader uses the real profile-evaluator: files-api under compliance is rejected at profile gate', (t) => {
  const cfg = goodConfig({ profile: PROFILES.COMPLIANCE });
  const dir = makeClient(t, { config: cfg });
  assert.throws(
    () =>
      loadClientConfig({
        clientsDir: dir,
        client: 'acme',
        profileEvaluator,
        requiredFeatures: ['files-api'],
      }),
    (e) => e.gate === GATES.PROFILE && e.subject === 'files-api' && /forbidden under the compliance/.test(e.message),
  );
});

test('loader + real evaluator: client-side feature under compliance passes', (t) => {
  const cfg = goodConfig({ profile: PROFILES.COMPLIANCE });
  const dir = makeClient(t, { config: cfg });
  const ctx = loadClientConfig({
    clientsDir: dir,
    client: 'acme',
    profileEvaluator,
    requiredFeatures: ['messages-api', 'prompt-caching'],
  });
  assert.equal(ctx.profile, 'compliance');
});

test('loader is fail-closed: a MALFORMED verdict stops the chain at the profile gate', (t) => {
  const cfg = goodConfig({ profile: 'compliance' });
  const dir = makeClient(t, { config: cfg });
  const malformed = { evaluate: () => ({ verdict: 'sure' }) }; // no `decision`
  assert.throws(
    () =>
      loadClientConfig({
        clientsDir: dir,
        client: 'acme',
        profileEvaluator: malformed,
        requiredFeatures: ['files-api'],
      }),
    (e) => e.gate === GATES.PROFILE && /malformed verdict/.test(e.message),
  );
});

test('loader is fail-closed: a THROWING evaluator stops the chain (no crash-through-as-allow)', (t) => {
  const cfg = goodConfig({ profile: 'compliance' });
  const dir = makeClient(t, { config: cfg });
  const thrower = {
    evaluate() {
      throw new Error('evaluator defect');
    },
  };
  assert.throws(
    () =>
      loadClientConfig({
        clientsDir: dir,
        client: 'acme',
        profileEvaluator: thrower,
        requiredFeatures: ['files-api'],
      }),
    (e) => e.gate === GATES.PROFILE && /threw while checking/.test(e.message),
  );
});

// =====================================================================================
// "data only, no logic" guard
// =====================================================================================

test('data-only guard rejects an embedded function (nested), naming its path', () => {
  // JSON is the first line of defence — it cannot encode a function — but the loader still
  // refuses one if injected by a non-JSON path. Exercise the exported guard directly.
  const withFn = {
    identity: { identifier: 'acme', displayName: 'Acme' },
    skillParameters: { hook: () => 'evil' },
  };
  assert.throws(
    () => assertDataOnly(withFn),
    (e) => e instanceof LoaderError && e.gate === GATES.CONFIG && e.field === 'skillParameters.hook',
  );
});

test('data-only guard accepts a plain nested data object', () => {
  assert.doesNotThrow(() =>
    assertDataOnly({ a: { b: [1, 'x', { c: true, d: null }] }, e: 'str' }),
  );
});

// default registry exposes exactly the MVP adapter names
test('default adapter registry knows dtcg-tokens (input) and react (output)', () => {
  const reg = defaultAdapterRegistry();
  assert.ok(reg.has('input', 'dtcg-tokens'));
  assert.ok(reg.has('output', 'react'));
  assert.ok(!reg.has('input', 'react'));
});
