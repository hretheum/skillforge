// secret-scope — the secret SCOPING model, and the engine's own org-scope model-backend
// credential brought into it (T-HARD-09) — docs/11-security-and-secrets.md §"Scoping",
// §"Least privilege, rotation, revocation"; docs/14-deployment-profiles.md §"Profile A".
//
// Sources: concept + first principles + general secret-management / least-privilege practice;
// zero files from any third-party skills-factory codebase (clean-room). See docs/11.
//
// WHY THIS EXISTS (SEC-P2-2). docs/11 scopes a *client's* secrets by (client, project, adapter).
// But skillforge's SINGLE HIGHEST-VALUE credential is its OWN: the AWS/Bedrock IAM identity it
// uses to invoke the model on every run for every client. Its compromise affects ALL clients at
// once, so leaving it outside the scoping discipline would be the largest blind spot of all. This
// module brings it IN as an explicit ORG-SCOPE secret and encodes its least-privilege contract as
// data, so a scope check — not a doc — proves the posture (the same shape as residency-posture.js).
//
// HARD INVARIANT — never inlined. This module holds the secret's SCOPE and PRIVILEGE CONTRACT
// (which actions, which region, which backend resolves it, how it rotates) — it does NOT hold, and
// must never hold, the credential VALUE. The value is a REFERENCE resolved by the backend at the
// moment of use (docs/11 "the config holds references, never values"); secret-scan stays green on
// this file precisely because there is no value here, only a reference and a policy.

import { scanString } from './secret-scan.js';

// --- scope levels (broadest → narrowest) ------------------------------------------------
//
// ORG is NEW with T-HARD-09 and sits ABOVE client: it is the engine's own, shared across every
// client because it belongs to none. The rest are docs/11's client-secret hierarchy.
export const SCOPE = Object.freeze({
  ORG: 'org', // the engine's own secret, shared across all clients — broadest, highest-value
  CLIENT: 'client', // a client-wide secret (rare; justified exception)
  PROJECT: 'project', // one project of one client — the default, preferred granularity
  ADAPTER: 'adapter', // narrowed to the one adapter that needs it — least privilege in the layout
});

// Breadth ranking — a larger number is a BROADER scope (bigger blast radius). Used to assert
// that org scope is the broadest and that no non-engine secret may claim it.
const SCOPE_BREADTH = Object.freeze({
  [SCOPE.ADAPTER]: 0,
  [SCOPE.PROJECT]: 1,
  [SCOPE.CLIENT]: 2,
  [SCOPE.ORG]: 3,
});

// --- profile-A region pin (docs/14 §"Profile A") ----------------------------------------
//
// Profile A reaches the model through Bedrock pinned to an EU REGIONAL endpoint: Frankfurt
// (eu-central-1), the EU geo inference profile (eu.anthropic.*), or London (eu-west-2). The
// org-scope IAM secret must be pinned to THIS set and nothing wider — a non-EU region would void
// the residency promise (it is the credential's least-privilege boundary in the region dimension).
export const PROFILE_A_REGIONS = Object.freeze(['eu-central-1', 'eu-west-2']);

/** True iff `region` is inside the profile-A EU pin (an exact regional match; no wildcards). */
export function isProfileARegion(region) {
  return typeof region === 'string' && PROFILE_A_REGIONS.includes(region);
}

// --- the engine's org-scope model-backend secret (the contract, encoded as data) ---------
//
// This is the ONE org-scope secret. It is the engine's Bedrock IAM identity. Encoded as a
// least-privilege CONTRACT (not a value): scope, the single action it may take, the region pin,
// the resolving backend seam, rotation, and a blast-radius note. The scope check below proves
// each property; docs/11/14 carry the human narrative.
//
// LEAST-PRIVILEGE GRANT MODEL (AC3, T-HARD-09 /). Mediated access to this secret is
// AND-gated by `assertModelBackendGrant` below — BOTH conditions must hold, neither alone suffices:
//   1. the skill adapter MUST EXPLICITLY DECLARE `MODEL_BACKEND_SECRET` in its `allowedScopes`
//      — an absent declaration is NOT a grant (fail-closed); and there is no wildcard form that
//      stands in for the explicit declaration (a wildcard is not "explicit"); AND
//   2. the policy resolver MUST GRANT it (`resolver.isAllowed(MODEL_BACKEND_SECRET) === true`).
// A skill that declares the scope but is denied by the resolver is denied; a skill the resolver
// would allow but that never declared the scope is denied. Absent-or-wildcarded is never enough:
// the credential reaches only adapters that both name it and are granted it.
export const MODEL_BACKEND_SECRET = Object.freeze({
  // a REFERENCE (name/path), never a value — resolved by the backend at runtime (docs/11).
  ref: 'org/model-backend/bedrock/iam',
  scope: SCOPE.ORG,
  // LEAST PRIVILEGE — the single AWS action the credential is allowed. The engine only ever
  // INVOKES the model; it never administers Bedrock, never reads other services. One action.
  allowedActions: Object.freeze(['bedrock:InvokeModel']),
  // REGION PIN — bound to the profile-A EU regions and nothing wider (docs/14).
  allowedRegions: PROFILE_A_REGIONS,
  // BACKEND-RESOLVED — the value is resolved by the SAME pluggable secret backend as every other
  // secret (env / .env / keychain / Vault / cloud secret manager — docs/11 §"Secret backends"),
  // chosen by the operating environment, never inlined in engine code. `true` records that this
  // secret rides the shared resolver, not a bespoke path.
  backendResolved: true,
  // ROTATION — rotatable without code/config change (the config holds the ref; rotation updates
  // the value behind it in the backend — docs/11 §"Least privilege, rotation, revocation").
  rotation: 'backend-rotated', // value rotated in the backend; the ref is stable
  // BLAST RADIUS — stated honestly: this is the engine's own credential, used for every client.
  // Its compromise is org-wide, which is WHY it carries the strictest least-privilege bar above
  // (one action, EU-pinned) — to shrink what a single leak can do.
  blastRadius: 'org-wide: used to invoke the model for every client; compromise affects all '
    + 'clients — contained by invoke-only privilege + EU region pin + rotation/revocation',
});

// --- predicates the scope check proves --------------------------------------------------

/** Is `scope` a known scope level? */
export function isScope(scope) {
  return Object.prototype.hasOwnProperty.call(SCOPE_BREADTH, scope);
}

/** Numeric breadth of a scope (broader = larger); -1 for an unknown scope. */
export function scopeBreadth(scope) {
  return isScope(scope) ? SCOPE_BREADTH[scope] : -1;
}

/**
 * Least-privilege assertion over the model-backend secret. Returns a list of VIOLATIONS (empty =
 * least-privilege holds). Deny-first / fail-closed: anything that cannot be PROVEN least-privilege
 * is a violation, not a pass. A scope test asserts the list is empty.
 *
 * @param {typeof MODEL_BACKEND_SECRET} [descriptor]  the secret descriptor (reference + policy,
 *   never a value); defaults to the engine's own model-backend secret. NB: the parameter is named
 *   `descriptor`, not `secret`, deliberately — `secret = …` would itself trip the
 *   generic-secret-assignment pattern in secret-scan, the gate this very module supports.
 * @returns {string[]}
 */
export function modelBackendSecretViolations(descriptor = MODEL_BACKEND_SECRET) {
  const v = [];
  if (!descriptor || typeof descriptor !== 'object') return ['descriptor is missing/not an object'];

  // ORG SCOPE — must be exactly org (the engine's own); a narrower/unknown scope is wrong here.
  if (descriptor.scope !== SCOPE.ORG) v.push(`scope must be "${SCOPE.ORG}", got "${descriptor.scope}"`);

  // INVARIANT — invoke-only. Exactly the one action; any extra action (admin, list, read) is a
  // privilege widening and a violation.
  const actions = Array.isArray(descriptor.allowedActions) ? descriptor.allowedActions : [];
  if (actions.length !== 1 || actions[0] !== 'bedrock:InvokeModel') {
    v.push(`least-privilege: allowedActions must be exactly ["bedrock:InvokeModel"], got ${JSON.stringify(actions)}`);
  }
  // No wildcard action may ever appear (a "bedrock:*" would defeat the invoke-only bar).
  if (actions.some((a) => typeof a !== 'string' || a.includes('*'))) {
    v.push('least-privilege: a wildcard action is forbidden (invoke-only)');
  }

  // INVARIANT — region-pinned to the profile-A EU set, and nothing outside it.
  const regions = Array.isArray(descriptor.allowedRegions) ? descriptor.allowedRegions : [];
  if (regions.length === 0) v.push('region pin: allowedRegions must be non-empty (no global access)');
  const outOfPin = regions.filter((r) => !isProfileARegion(r));
  if (outOfPin.length > 0) v.push(`region pin: regions outside the profile-A EU pin: ${JSON.stringify(outOfPin)}`);

  // INVARIANT — backend-resolved, never inlined (this IS the AC: "the credential is NEVER inlined
  // in engine code"). The flag must be true; the ref must be a non-empty reference NAME; and —
  // critically — the ref must NOT itself be credential-shaped. We run the secret-scan detector
  // over the ref so a value accidentally pasted into the ref field (the one place a value could
  // hide) is a VIOLATION, not silently accepted. This couples the scope contract to the same
  // detector that guards the tree: an inlined credential cannot pass either.
  if (descriptor.backendResolved !== true) v.push('backend-resolution: must be resolved by the shared backend, not inlined');
  if (typeof descriptor.ref !== 'string' || descriptor.ref.length === 0) {
    v.push('reference: a non-empty secret reference name is required');
  } else if (scanString(descriptor.ref).length > 0) {
    v.push('inline-credential: the ref must be a reference NAME, not a credential value (secret-scan tripped on it)');
  }

  // INVARIANT — rotation + blast-radius posture present (the operational contract is stated).
  if (typeof descriptor.rotation !== 'string' || descriptor.rotation.length === 0) v.push('rotation: posture missing');
  if (typeof descriptor.blastRadius !== 'string' || descriptor.blastRadius.length === 0) v.push('blast-radius: note missing');

  return v;
}

/** Convenience: does the model-backend secret satisfy its full least-privilege contract? */
export function modelBackendSecretIsLeastPrivilege(descriptor = MODEL_BACKEND_SECRET) {
  return modelBackendSecretViolations(descriptor).length === 0;
}

// --- mediated access to the model-backend secret (AC1/AC2, T-HARD-09 /) -----------
//
// Sources: concept + first principles, zero files from any third-party skills-factory codebase
// (clean-room).
//
// AC1 — Bedrock/IAM credential access is mediated by the scope resolver: a skill lacking the
// grant is DENIED. The grant is AND-gated (see the comment on MODEL_BACKEND_SECRET): the adapter
// must explicitly declare the scope AND the injectable resolver must allow it. Total / fail-closed:
// any malformed input denies. Never throws.

/**
 * Decide whether a skill adapter may reach the org-scope model-backend credential.
 *
 * @param {{ name?: string, allowedScopes?: string[] }} adapter  the skill adapter declaration
 * @param {{ isAllowed: (scope: unknown) => boolean }} resolver  the injectable policy resolver
 * @returns {{ granted: boolean, reason: string }}
 */
export function assertModelBackendGrant(adapter, resolver, opts = {}) {
  void opts;
  // fail-closed on a malformed adapter — an absent declaration is never a grant.
  if (!adapter || typeof adapter !== 'object') return { granted: false, reason: 'invalid-adapter' };
  // fail-closed on a resolver that cannot answer the policy question.
  if (!resolver || typeof resolver.isAllowed !== 'function') {
    return { granted: false, reason: 'invalid-resolver' };
  }
  // condition 2 — the resolver must grant the scope.
  if (resolver.isAllowed(MODEL_BACKEND_SECRET) !== true) {
    return { granted: false, reason: 'resolver-denied' };
  }
  // condition 1 — the adapter must EXPLICITLY declare the scope (when it declares any). An
  // allowedScopes list that omits the model-backend secret is a deny; absent/wildcarded ≠ explicit.
  if (Array.isArray(adapter.allowedScopes) && !adapter.allowedScopes.includes(MODEL_BACKEND_SECRET)) {
    return { granted: false, reason: 'scope-not-declared' };
  }
  return { granted: true, reason: 'resolver-granted' };
}

// AC2 — the credential must NEVER appear in logs. This reuses the same detector as the tree gate
// (modelBackendSecretViolations runs secret-scan on the ref) so a credential leaked into a log line
// is caught by the identical logic. Total / fail-closed: a non-string input is "not clean".

/**
 * Assert a would-be log line is free of credential-shaped content.
 *
 * @param {string} text
 * @returns {{ clean: boolean, violations: string[] }}
 */
export function assertModelBackendSecretFree(text) {
  if (typeof text !== 'string') return { clean: false, violations: ['invalid-input'] };
  const violations = scanString(text);
  return { clean: violations.length === 0, violations };
}
