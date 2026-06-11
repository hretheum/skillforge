// The profile-evaluator — docs/14-deployment-profiles.md §"the profile-evaluator" +
// docs/06-loader-and-activation.md + docs/13-tool-governance.md §"Layer 0".
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room). See docs/14-deployment-profiles.md, docs/13-tool-governance.md.
//
// A small, data-driven, model-independent function `(profile, feature) -> verdict`, where
// verdict ∈ {allow, deny}. It is the SINGLE evaluator of deployment-profile legality and the
// direct sibling of the policy resolver (T-MVP-04): same deny-first, runs-without-Claude,
// CI-dry-runnable shape. It owns no policy of its own beyond *reading* the one feature×profile
// contract table that docs/14 owns — encoded here as data, the single copy enforcement reads.
//
// TWO CALL SITES, ONE LOGIC (docs/14 §enforcement):
//   * the loader, at startup, for FEATURE legality (Files API, server-side skills, batch);
//   * the policy resolver, per call, as LAYER 0 for SERVER-SIDE-TOOL legality.
// Both consume the same verdict shape this module defines and validates.
//
// DENY-FIRST POSTURE (the governance seam defaults to deny when uncertain — docs/13
// §"silence is denial", team-lead directive on T-MVP-03):
//   * an UNKNOWN profile  -> deny (we cannot prove a feature is legal under a profile we do
//     not recognise, so we refuse rather than fail open);
//   * an UNKNOWN feature   -> deny (a feature absent from the contract table is not provably
//     legal — the table is the only source of truth, and silence is denial);
//   * a MALFORMED call (non-string profile/feature) -> deny;
//   * this function NEVER throws on bad input — it resolves to deny. A throwing evaluator is
//     itself a defect that callers must also treat as deny (see isAllowed / wrapping below),
//     so a crash can never read through as allow.

/** The two deployment profiles (docs/14). */
export const PROFILES = Object.freeze({
  COMPLIANCE: 'compliance', // profile A — EU residency + ZDR; server-side conveniences forbidden
  CONVENIENCE: 'convenience', // profile B — full server-side platform; no residency/ZDR promise
});

/** Verdict decisions (the two-valued profile legality output). */
export const DECISIONS = Object.freeze({ ALLOW: 'allow', DENY: 'deny' });

// --- the feature × profile contract table (docs/14 — the single copy) -------------------
//
// docs/14 names the features FORBIDDEN under the compliance profile. We encode exactly those:
// everything not in this set is allowed under compliance, and profile B (convenience) forbids
// nothing. Keeping the table as the forbidden-set (rather than re-listing every allowed
// feature) mirrors docs/14's "❌ forbidden" rows and keeps the deny-first reading obvious.
//
// Feature handles are stable, vendor-neutral strings the loader/resolver pass in. Aliases are
// included so a caller naming the same capability differently still hits the same verdict
// (e.g. the resolver's "server-side tool" classes: code-exec, web-search, web-fetch).
const COMPLIANCE_FORBIDDEN = Object.freeze(
  new Set([
    'files-api', // Files API: server-side store, outside the EU/ZDR boundary
    'server-side-agent-skills', // skills executed in the managed runtime
    'server-side-skills', // alias
    'batch', // batch processing via the platform
    'batch-processing', // alias
    'server-side-tools', // the umbrella class (docs/13 Layer 0)
    'code-execution', // a server-side tool
    'web-search', // a server-side tool
    'web-fetch', // a server-side tool
  ]),
);

// The set of feature handles the table knows about *at all*. Under the convenience profile
// every known feature is allowed; an UNKNOWN feature is denied under BOTH profiles (deny-first:
// a feature absent from the contract table is not provably legal). Always-available features
// (Messages API, prompt caching, client-side tools, …) are listed so they are "known" and
// therefore allowed rather than denied-as-unknown.
const KNOWN_FEATURES = Object.freeze(
  new Set([
    ...COMPLIANCE_FORBIDDEN,
    // always available under both profiles (docs/14 "✅ ✅" rows):
    'messages-api',
    'prompt-caching',
    'extended-thinking',
    'client-side-tools',
    'client-side-tool-use',
    'citations',
    'structured-outputs',
    'client-side-skills',
  ]),
);

const KNOWN_PROFILES = Object.freeze(new Set(Object.values(PROFILES)));

/**
 * A verdict. Always one of DECISIONS, always carries a human-readable `reason` (so the loader's
 * "name which feature and why" requirement is met without the caller inventing text).
 * @typedef {{ decision: 'allow'|'deny', reason: string }} ProfileVerdict
 */

const allow = (reason) => Object.freeze({ decision: DECISIONS.ALLOW, reason });
const deny = (reason) => Object.freeze({ decision: DECISIONS.DENY, reason });

/**
 * Evaluate the legality of a feature under a deployment profile.
 *
 * Deny-first and total: never throws, always returns a well-formed ProfileVerdict.
 *
 * @param {unknown} profile a profile handle (expected: PROFILES.COMPLIANCE | PROFILES.CONVENIENCE)
 * @param {unknown} feature a feature handle from the contract table
 * @returns {ProfileVerdict}
 */
export function evaluate(profile, feature) {
  // malformed input -> deny (fail-closed)
  if (typeof profile !== 'string' || profile.trim() === '') {
    return deny('no deployment profile given; cannot prove the feature is legal (fail-closed)');
  }
  if (typeof feature !== 'string' || feature.trim() === '') {
    return deny('no feature given to evaluate against the deployment profile (fail-closed)');
  }

  // unknown profile -> deny (we do not recognise the posture; refuse rather than fail open)
  if (!KNOWN_PROFILES.has(profile)) {
    return deny(
      `unknown deployment profile "${profile}"; recognised profiles are ${[...KNOWN_PROFILES].join(', ')} (fail-closed)`,
    );
  }

  // unknown feature -> deny under BOTH profiles (absent from the contract table = not provably legal)
  if (!KNOWN_FEATURES.has(feature)) {
    return deny(
      `feature "${feature}" is not in the feature×profile contract table; it is not provably legal (fail-closed)`,
    );
  }

  // known feature, known profile: read the table.
  if (profile === PROFILES.COMPLIANCE && COMPLIANCE_FORBIDDEN.has(feature)) {
    return deny(
      `feature "${feature}" is forbidden under the compliance profile: it would place content outside the EU/ZDR boundary`,
    );
  }

  // convenience forbids nothing; compliance allows everything not in the forbidden set.
  return allow(`feature "${feature}" is permitted under the "${profile}" profile`);
}

/**
 * The profile-evaluator object — the shape the loader and resolver inject/consume. Matches the
 * seam the loader (T-MVP-02) already calls: `{ evaluate(profile, feature) -> verdict }`.
 */
export const profileEvaluator = Object.freeze({ evaluate });

/**
 * Validate that an arbitrary value is a well-formed verdict. The evaluator OWNS the verdict
 * shape (SRP), so this is the canonical check any consumer (loader, resolver) uses to refuse a
 * malformed verdict — deny-first: a verdict that is not provably well-formed is not trusted.
 * @param {unknown} v
 * @returns {boolean}
 */
export function isVerdict(v) {
  return (
    v !== null &&
    typeof v === 'object' &&
    (v.decision === DECISIONS.ALLOW || v.decision === DECISIONS.DENY)
  );
}

/**
 * Deny-first convenience used by call sites: returns true ONLY when the evaluator (or any
 * evaluator-shaped function) produces a well-formed `allow` verdict. Anything else — a `deny`,
 * a malformed verdict, or a THROW — collapses to false (deny). This is the wrapper the lead's
 * directive describes: a throwing/garbage evaluator resolves to deny, never crash-through-as-allow.
 *
 * @param {{evaluate: Function}} evaluator
 * @param {unknown} profile
 * @param {unknown} feature
 * @returns {boolean} true iff legal (allow); false on deny / malformed / throw
 */
export function isAllowed(evaluator, profile, feature) {
  let verdict;
  try {
    verdict = evaluator.evaluate(profile, feature);
  } catch {
    return false; // a throwing evaluator is a defect -> treat as deny
  }
  if (!isVerdict(verdict)) return false; // malformed verdict -> deny
  return verdict.decision === DECISIONS.ALLOW;
}

/** Read-only views for tests / introspection (no mutation of the contract table). */
export const _table = Object.freeze({
  complianceForbidden: () => [...COMPLIANCE_FORBIDDEN].sort(),
  knownFeatures: () => [...KNOWN_FEATURES].sort(),
  knownProfiles: () => [...KNOWN_PROFILES].sort(),
});
