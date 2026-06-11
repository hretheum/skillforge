// Tests for the secret SCOPING model and the engine's org-scope model-backend credential
// (T-HARD-09) — docs/11-security-and-secrets.md §"Scoping" / §"Least privilege"; docs/14 §"Profile A".
//
// AC (docs/16 line 169): a scope test proves the org-scope secret is least-privilege
// (bedrock:InvokeModel only, region-pinned to the profile-A EU set) and resolved via the backend
// — never inlined in engine code. secret-scan green is proven by the CI gate over the tree (this
// file and the module carry only a REFERENCE name + a policy, never a value).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SCOPE,
  PROFILE_A_REGIONS,
  MODEL_BACKEND_SECRET,
  isScope,
  scopeBreadth,
  isProfileARegion,
  modelBackendSecretViolations,
  modelBackendSecretIsLeastPrivilege,
  assertModelBackendGrant,
  assertModelBackendSecretFree,
} from '../../src/governance/index.js';
import { scanValue } from '../../src/governance/index.js';

// =====================================================================================
// Scope hierarchy — org is the new, broadest level
// =====================================================================================

test('org is the broadest scope; adapter the narrowest (blast-radius ordering)', () => {
  assert.ok(scopeBreadth(SCOPE.ORG) > scopeBreadth(SCOPE.CLIENT));
  assert.ok(scopeBreadth(SCOPE.CLIENT) > scopeBreadth(SCOPE.PROJECT));
  assert.ok(scopeBreadth(SCOPE.PROJECT) > scopeBreadth(SCOPE.ADAPTER));
  assert.equal(isScope('org'), true);
  assert.equal(isScope('nonsense'), false);
  assert.equal(scopeBreadth('nonsense'), -1);
});

// =====================================================================================
// The engine's org-scope model-backend secret — AC proof
// =====================================================================================

test('AC: the model-backend secret is org-scope, least-privilege, region-pinned, backend-resolved', () => {
  assert.deepEqual(
    modelBackendSecretViolations(),
    [],
    'the engine model-backend secret must satisfy its full least-privilege contract',
  );
  assert.equal(modelBackendSecretIsLeastPrivilege(), true);

  // spell out each AC clause directly (not only via the aggregate violations list):
  assert.equal(MODEL_BACKEND_SECRET.scope, SCOPE.ORG, 'org-scope');
  assert.deepEqual(
    MODEL_BACKEND_SECRET.allowedActions,
    ['bedrock:InvokeModel'],
    'least-privilege: invoke-only, exactly one action',
  );
  assert.deepEqual(
    MODEL_BACKEND_SECRET.allowedRegions,
    PROFILE_A_REGIONS,
    'region-pinned to the profile-A EU set',
  );
  for (const r of MODEL_BACKEND_SECRET.allowedRegions) {
    assert.equal(isProfileARegion(r), true, `region ${r} is inside the profile-A EU pin`);
  }
  assert.equal(MODEL_BACKEND_SECRET.backendResolved, true, 'resolved via the shared backend');
  assert.ok(MODEL_BACKEND_SECRET.rotation.length > 0, 'rotation posture stated');
  assert.ok(MODEL_BACKEND_SECRET.blastRadius.length > 0, 'blast-radius note present');
});

test('region pin rejects non-EU / global regions', () => {
  assert.equal(isProfileARegion('us-east-1'), false);
  assert.equal(isProfileARegion('*'), false);
  assert.equal(isProfileARegion(''), false);
  assert.equal(isProfileARegion(undefined), false);
  // and the canonical EU regions are accepted
  assert.equal(isProfileARegion('eu-central-1'), true);
  assert.equal(isProfileARegion('eu-west-2'), true);
});

// =====================================================================================
// NON-VACUITY — each violation actually bites when the contract is tampered
// =====================================================================================

test('NON-VACUITY: a widened action set is rejected (invoke-only bites)', () => {
  const tampered = { ...MODEL_BACKEND_SECRET, allowedActions: ['bedrock:InvokeModel', 'bedrock:ListFoundationModels'] };
  const v = modelBackendSecretViolations(tampered);
  assert.ok(v.some((m) => m.includes('least-privilege')), 'extra action must be a violation');
});

test('NON-VACUITY: a wildcard action is rejected', () => {
  const tampered = { ...MODEL_BACKEND_SECRET, allowedActions: ['bedrock:*'] };
  assert.ok(modelBackendSecretViolations(tampered).some((m) => m.includes('wildcard')));
});

test('NON-VACUITY: a non-EU region in the pin is rejected (region pin bites)', () => {
  const tampered = { ...MODEL_BACKEND_SECRET, allowedRegions: ['eu-central-1', 'us-east-1'] };
  const v = modelBackendSecretViolations(tampered);
  assert.ok(v.some((m) => m.includes('region pin') && m.includes('us-east-1')));
});

test('NON-VACUITY: an empty region pin (= global) is rejected', () => {
  const tampered = { ...MODEL_BACKEND_SECRET, allowedRegions: [] };
  assert.ok(modelBackendSecretViolations(tampered).some((m) => m.includes('non-empty')));
});

test('NON-VACUITY: a non-org scope is rejected', () => {
  const tampered = { ...MODEL_BACKEND_SECRET, scope: SCOPE.CLIENT };
  assert.ok(modelBackendSecretViolations(tampered).some((m) => m.includes('scope must be')));
});

test('NON-VACUITY: an inlined (non-backend-resolved) secret is rejected', () => {
  const tampered = { ...MODEL_BACKEND_SECRET, backendResolved: false };
  assert.ok(modelBackendSecretViolations(tampered).some((m) => m.includes('backend-resolution')));
});

test('NON-VACUITY: an INLINED credential value in the ref field is rejected (the AC)', () => {
  // The AC is "the credential is NEVER inlined in engine code". If a real value were ever pasted
  // into the ref field instead of a reference name, the contract must reject it — the scope check
  // runs the secret-scan detector over the ref. Synthesize a credential-shaped value AT RUNTIME
  // (clean-room: never a literal in the tree) and assert it is rejected as an inline credential.
  const lowers = 'abcdefghijklmnopqrstuvwxyz';
  const uppers = lowers.toUpperCase();
  const digits = '0123456789';
  let inlined = '';
  for (let i = 0; i < 14; i++) inlined += lowers[(i * 7 + 3) % 26] + uppers[(i * 5 + 1) % 26] + digits[(i * 3) % 10];
  const tampered = { ...MODEL_BACKEND_SECRET, ref: inlined }; // a VALUE where a NAME belongs
  assert.ok(
    modelBackendSecretViolations(tampered).some((m) => m.includes('inline-credential')),
    'a credential-shaped ref must be rejected as an inlined credential',
  );
  // and the legit path-shaped reference name is NOT rejected
  assert.equal(
    modelBackendSecretViolations({ ...MODEL_BACKEND_SECRET, ref: 'org/model-backend/bedrock/iam' }).some((m) =>
      m.includes('inline-credential'),
    ),
    false,
    'a reference NAME must not be mistaken for an inlined credential',
  );
});

test('NON-VACUITY: a missing rotation / blast-radius posture is rejected', () => {
  assert.ok(modelBackendSecretViolations({ ...MODEL_BACKEND_SECRET, rotation: '' }).some((m) => m.includes('rotation')));
  assert.ok(modelBackendSecretViolations({ ...MODEL_BACKEND_SECRET, blastRadius: '' }).some((m) => m.includes('blast-radius')));
});

test('NON-VACUITY: a malformed secret object fails closed', () => {
  // null / a non-object / an empty object cannot be proven least-privilege → fail closed.
  // (passing no argument deliberately validates the REAL secret via the default param, so it is
  // not a "malformed" case — null is the malformed input here.)
  assert.ok(modelBackendSecretViolations(null).length > 0);
  assert.ok(modelBackendSecretViolations(42).length > 0);
  assert.ok(modelBackendSecretViolations({}).length > 0);
});

// =====================================================================================
// NEVER INLINED — the model carries a REFERENCE, not a value
// =====================================================================================

test('the secret carries a reference NAME, never a credential value', () => {
  // a path-shaped reference is safe to carry (docs/11 references-not-values); secret-scan must
  // NOT flag the whole secret object as containing a credential value.
  assert.equal(typeof MODEL_BACKEND_SECRET.ref, 'string');
  assert.ok(MODEL_BACKEND_SECRET.ref.includes('/'), 'reference is a path-shaped name');
  const findings = scanValue(MODEL_BACKEND_SECRET);
  assert.deepEqual(
    findings,
    [],
    'the org-scope secret descriptor must contain only a reference + policy, no credential-shaped value',
  );
});

// =====================================================================================
// MEDIATED ACCESS — assertModelBackendGrant (AC1): adapter-declared AND resolver-granted
// =====================================================================================

const ALLOW_ALL = { isAllowed: () => true };
const DENY_ALL = { isAllowed: () => false };

test('grant: granted when the resolver allows AND the scope is declared', () => {
  const adapter = { name: 'demo', allowedScopes: [MODEL_BACKEND_SECRET] };
  assert.deepEqual(assertModelBackendGrant(adapter, ALLOW_ALL), {
    granted: true,
    reason: 'resolver-granted',
  });
});

test('grant: granted when the resolver allows and the adapter declares no scope list (no narrowing)', () => {
  // an adapter that declares no allowedScopes list is not narrowed by condition 1; the resolver
  // alone decides. (an empty list, by contrast, declares "none" — see the scope-not-declared test.)
  const adapter = { name: 'demo' };
  assert.deepEqual(assertModelBackendGrant(adapter, ALLOW_ALL), {
    granted: true,
    reason: 'resolver-granted',
  });
});

test('grant: denied when the resolver denies (resolver-denied) even if the scope is declared', () => {
  const adapter = { name: 'demo', allowedScopes: [MODEL_BACKEND_SECRET] };
  assert.deepEqual(assertModelBackendGrant(adapter, DENY_ALL), {
    granted: false,
    reason: 'resolver-denied',
  });
});

test('grant: denied when the scope is not declared (scope-not-declared) even if the resolver allows', () => {
  const adapter = { name: 'demo', allowedScopes: [] }; // declares a list that omits the secret
  assert.deepEqual(assertModelBackendGrant(adapter, ALLOW_ALL), {
    granted: false,
    reason: 'scope-not-declared',
  });
});

test('grant: denied when allowedScopes lists other scopes but not the model-backend secret', () => {
  const adapter = { name: 'demo', allowedScopes: ['some-other-scope', SCOPE.PROJECT] };
  assert.equal(assertModelBackendGrant(adapter, ALLOW_ALL).reason, 'scope-not-declared');
});

test('grant: fail-closed on a null/non-object adapter (invalid-adapter)', () => {
  assert.deepEqual(assertModelBackendGrant(null, ALLOW_ALL), { granted: false, reason: 'invalid-adapter' });
  assert.deepEqual(assertModelBackendGrant(42, ALLOW_ALL), { granted: false, reason: 'invalid-adapter' });
});

test('grant: fail-closed on a null/invalid resolver (invalid-resolver)', () => {
  const adapter = { name: 'demo', allowedScopes: [MODEL_BACKEND_SECRET] };
  assert.deepEqual(assertModelBackendGrant(adapter, null), { granted: false, reason: 'invalid-resolver' });
  assert.deepEqual(assertModelBackendGrant(adapter, {}), { granted: false, reason: 'invalid-resolver' });
  assert.deepEqual(assertModelBackendGrant(adapter, { isAllowed: 'nope' }), {
    granted: false,
    reason: 'invalid-resolver',
  });
});

test('grant: never throws (total) across malformed inputs', () => {
  assert.doesNotThrow(() => assertModelBackendGrant(undefined, undefined));
  assert.doesNotThrow(() => assertModelBackendGrant({ allowedScopes: null }, ALLOW_ALL));
});

// =====================================================================================
// NEVER LOGGED — assertModelBackendSecretFree (AC2)
// =====================================================================================

test('secret-free: clean on a safe log line', () => {
  assert.deepEqual(assertModelBackendSecretFree('invoked the model for client foo in eu-central-1'), {
    clean: true,
    violations: [],
  });
});

test('secret-free: not clean when the text contains a credential-shaped value', () => {
  // synthesize a credential-shaped token AT RUNTIME (clean-room: never a literal in the tree).
  const lowers = 'abcdefghijklmnopqrstuvwxyz';
  const uppers = lowers.toUpperCase();
  const digits = '0123456789';
  let token = '';
  for (let i = 0; i < 14; i++) token += lowers[(i * 7 + 3) % 26] + uppers[(i * 5 + 1) % 26] + digits[(i * 3) % 10];
  const result = assertModelBackendSecretFree(`leaked: ${token}`);
  assert.equal(result.clean, false, 'a credential-shaped value in a log line must not be clean');
  assert.ok(result.violations.length > 0, 'the violation must be reported');
});

test('secret-free: fail-closed on a non-string input', () => {
  assert.deepEqual(assertModelBackendSecretFree(undefined), { clean: false, violations: ['invalid-input'] });
  assert.deepEqual(assertModelBackendSecretFree(42), { clean: false, violations: ['invalid-input'] });
  assert.deepEqual(assertModelBackendSecretFree(null), { clean: false, violations: ['invalid-input'] });
});
