// cache-hit determinism diagnostics — attribute a cache-hit drop to its OWNER (OBS-02).
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room). Realizes docs/10-telemetry-and-grafana.md §"Who owns cache-hit
// determinism" (OBS-02) and reuses the two byte-stable fingerprints the prompt-tiers renderer
// already emits (src/core/prompt-tiers.js): tier-1 prefix hash (the CORE's owner) and tier-2
// content hash (the INPUT ADAPTER's owner).
//
// WHY THIS EXISTS (OBS-02). The cache-hit ratio is the single biggest cost lever, so when it drops
// the dashboard must send the operator to the RIGHT cause — otherwise the most important cost KPI
// is "something broke, somewhere". The cached prefix is byte-stable only if BOTH tiers are stable,
// and the two tiers have TWO OWNERS:
//   - tier 1 (engine/skill text) — byte-determinism owned by the CORE.
//   - tier 2 (the normalized description) — byte-determinism owned by the INPUT ADAPTER.
// An annotation that names only the input adapter would mis-attribute a tier-1 regression. The fix
// (docs/10) is two-part: (1) name BOTH owners, and (2) carry a secondary signal that distinguishes
// them — the two per-run fingerprints. This module is part (2): given a run's fingerprints and a
// BASELINE (the last known-good run for the same client+skill), it tells which hash CHANGED and so
// names the owner at fault; if both held but the ratio still dropped, the cause is downstream of the
// prefix (backend/cache behavior), not a determinism regression.
//
// HONEST INFRA BOUNDARY. This is the ENGINE-SIDE EMISSION + ATTRIBUTION LOGIC (real code, tested).
// The fingerprints ride as low-cardinality telemetry attributes alongside the cache-hit metric the
// runtime emits; the PANEL that reads the ratio and shows the attribution is on the DEPLOY stack
// (deploy/ dashboards). This module produces and reasons over the signal; it does not draw it.
//
// SECRET-FREE. Each fingerprint is an opaque content-hash digest (sha256:<hex>) — a grouping /
// diagnostic key, never client content or a secret value (docs/10 privacy). The builder fail-closed
// secret-scans its own attributes, the same discipline as the skill_result event.

import { hasSecret } from "../governance/secret-scan.js";
import { isContentHash } from "./content-hash.js";

/** The two determinism owners the cache-hit attribution distinguishes (docs/10 OBS-02). */
export const CACHE_OWNER = Object.freeze({
  CORE: "core", // tier 1 — the engine/skill text (prompt-tiers tier1PrefixHash)
  INPUT_ADAPTER: "input-adapter", // tier 2 — the normalized description (envelope content-hash)
  DOWNSTREAM: "downstream", // both fingerprints held → the cause is backend/cache, not determinism
});

/** The telemetry attribute keys the fingerprints ride as (low-cardinality, secret-free). */
export const CACHE_DIAG_ATTR = Object.freeze({
  TIER1_PREFIX_HASH: "skillforge.cache.tier1_prefix_hash",
  TIER2_CONTENT_HASH: "skillforge.cache.tier2_content_hash",
});

function assert(cond, msg) {
  if (!cond) throw new TypeError(msg);
}

/**
 * Build the per-run cache-diagnostic attributes from a rendered prompt-tiers result. PURE. These
 * ride alongside the runtime's cache-hit metric so a drop can be localized. Validates that each
 * fingerprint is a well-formed content-hash and refuses a secret-bearing value (fail-closed).
 *
 * @param {{ tier1PrefixHash: string, tier2ContentHash: string }} rendered  the prompt-tiers output
 *   (src/core/prompt-tiers.js renderPromptTiers()).
 * @returns {{ "skillforge.cache.tier1_prefix_hash": string, "skillforge.cache.tier2_content_hash": string }}
 * @throws {TypeError} on a malformed hash or a credential-shaped value
 */
export function cacheDiagnosticAttributes({ tier1PrefixHash, tier2ContentHash } = {}) {
  assert(isContentHash(tier1PrefixHash), `tier1PrefixHash must be a content-hash, got ${JSON.stringify(tier1PrefixHash)}`);
  assert(isContentHash(tier2ContentHash), `tier2ContentHash must be a content-hash, got ${JSON.stringify(tier2ContentHash)}`);

  const attrs = {
    [CACHE_DIAG_ATTR.TIER1_PREFIX_HASH]: tier1PrefixHash,
    [CACHE_DIAG_ATTR.TIER2_CONTENT_HASH]: tier2ContentHash,
  };
  // An opaque digest is not credential-shaped, but scan anyway — telemetry is never a leak surface
  // (the same fail-closed posture as the skill_result event and the resource attributes).
  if (hasSecret(attrs)) {
    throw new TypeError(
      "refusing to build cache-diagnostic attributes: a fingerprint is credential-shaped " +
        "(the fingerprints are opaque content-hash digests, never a secret value)",
    );
  }
  return attrs;
}

/**
 * Attribute a cache-hit drop to its owner by comparing a run's fingerprints to a BASELINE (the last
 * known-good run for the same client+skill). PURE — the dashboard would call this when the ratio
 * falls; the unit test calls it to prove a simulated tier-1 vs tier-2 break is attributed correctly.
 *
 * Logic (docs/10 OBS-02): whichever fingerprint CHANGED names the owner at fault. If tier 1 changed,
 * the CORE broke byte-determinism; if tier 2 changed, the INPUT ADAPTER did. If BOTH held, the
 * prefix is byte-identical, so a ratio drop is DOWNSTREAM of the prefix (backend/cache behavior),
 * not a determinism regression. (If both changed, both owners are named — neither is masked.)
 *
 * @param {{tier1PrefixHash:string,tier2ContentHash:string}} current   this run's fingerprints
 * @param {{tier1PrefixHash:string,tier2ContentHash:string}} baseline  the last known-good run's
 * @returns {{
 *   tier1Changed: boolean, tier2Changed: boolean,
 *   owners: string[],          // the owner(s) at fault, or ["downstream"] if both held
 *   downstream: boolean,        // true iff the prefix is byte-identical (drop is not a determinism break)
 *   message: string,            // an operator-facing, both-owner-aware annotation
 * }}
 */
export function attributeCacheDrop(current, baseline) {
  // Validate both ends carry well-formed fingerprints (validate before reasoning).
  cacheDiagnosticAttributes(current);
  cacheDiagnosticAttributes(baseline);

  const tier1Changed = current.tier1PrefixHash !== baseline.tier1PrefixHash;
  const tier2Changed = current.tier2ContentHash !== baseline.tier2ContentHash;

  const owners = [];
  if (tier1Changed) owners.push(CACHE_OWNER.CORE);
  if (tier2Changed) owners.push(CACHE_OWNER.INPUT_ADAPTER);

  if (owners.length === 0) {
    // Both fingerprints held → the cacheable prefix is byte-identical, so a ratio drop is downstream
    // of the prefix (backend/cache behavior), NOT a determinism regression. The panel must not blame
    // either owner here (the mis-attribution OBS-02 exists to prevent).
    return {
      tier1Changed,
      tier2Changed,
      owners: [CACHE_OWNER.DOWNSTREAM],
      downstream: true,
      message:
        "cache-hit drop with BOTH prefix fingerprints unchanged — the prefix is byte-identical; " +
        "the cause is downstream of the prefix (backend/cache behavior), not a tier-1/tier-2 " +
        "determinism regression.",
    };
  }

  // At least one fingerprint changed → name the owner(s) at fault. The message names BOTH tiers'
  // owners so the panel is never half-blind, then points at the one(s) that actually changed.
  const fault = owners
    .map((o) => (o === CACHE_OWNER.CORE ? "tier 1 / engine-skill text (CORE)" : "tier 2 / normalized description (INPUT ADAPTER)"))
    .join(" and ");
  return {
    tier1Changed,
    tier2Changed,
    owners,
    downstream: false,
    message:
      `cache-hit drop localized: ${fault} changed between runs. ` +
      "The cached prefix has two determinism owners — tier 1 (CORE) and tier 2 (INPUT ADAPTER); " +
      "the changed fingerprint above names the one at fault.",
  };
}
