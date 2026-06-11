// Tier-1 prompt rendering with byte-determinism — the core's stability-tiers contract.
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room). Realizes docs/02-architecture-overview.md §"How the core lays out a
// prompt: stability tiers" (esp. the "tier-1 byte-determinism is a CORE contract" callout) and
// docs/07-build-plan.md §Verification (the determinism gate extends to cover the prefix).
//
// The core assembles every skill prompt in STABILITY TIERS, most-stable first, never
// interleaved (docs/02):
//   - tier 1 ENGINE/SKILL  — the engine instructions + the skill recipe. Identical across
//                            EVERY client and EVERY run. The CORE owns its byte-stability.
//   - tier 2 CLIENT        — the normalized description from the input adapter. Identical
//                            across THAT client's runs. The INPUT ADAPTER owns its
//                            byte-stability (T-MVP-06); it already carries a content-hash in
//                            its envelope, which this renderer reuses (it does not recompute a
//                            second, divergent hash for the same bytes).
//   - tier 3 REQUEST       — the specific, variable ask. Different (almost) every run.
//
// Why this lives in the core and is byte-deterministic: the prompt-prefix cache saving (and
// the genericity tests that key off it) only hold if the WHOLE prefix (tier1+tier2) is
// byte-for-byte identical across runs. The prefix has TWO OWNERS (docs/02 L199-209 + docs/10):
// tier 1 = core, tier 2 = adapter. So this renderer:
//   - serializes tier 1 with the SAME canonical discipline as the normalized form (stable key
//     order, stable number format, no timestamps/run-ids/whitespace churn — canonical.js), and
//   - emits a distinct TIER-1 PREFIX HASH alongside the tier-2 content-hash, so a cache-hit dip
//     can be attributed to the right owner instead of always blaming the adapter.
//
// PROVIDER-BLIND. This renders the tiers' CONTENT and ORDER as data (a structured object plus a
// canonical text rendering); it does NOT speak any backend's wire format or cache-breakpoint
// API. Marking tier boundaries onto a vendor's cache is a runtime/output-adapter concern
// (docs/02 "the mechanism that pays off here lives at the edge"). The core only emits the tiers
// in order and keeps tiers 1-2 deterministic.

import { canonicalize } from "./canonical.js";
import { contentHash } from "./content-hash.js";
import { validateNormalized } from "./normalized-form.js";

/** Ordered tier identifiers, most-stable first. The order is part of the contract. */
export const TIER_ORDER = Object.freeze(["tier1", "tier2", "tier3"]);

/** A stable, human-meaningful boundary marker per tier (data, not a vendor directive). */
const TIER_LABEL = Object.freeze({
  tier1: "ENGINE/SKILL",
  tier2: "CLIENT",
  tier3: "REQUEST",
});

function assert(cond, msg) {
  if (!cond) throw new TypeError(msg);
}

/**
 * Render the stability-tiers prompt for one run, byte-deterministically.
 *
 * @param {object} promptTiers  the run's structured tier handoff (src/engine/run.js):
 *   { tier1: { engine, skill }, tier2: <normalized description>, tier3: { request, project } }.
 *   tier2 MUST be a normalized value (it carries its own content-hash — the adapter is its
 *   byte-stability owner).
 * @returns {{
 *   tiers: { tier1: string, tier2: string, tier3: string },  // canonical bytes per tier
 *   prefix: string,            // tier1 + tier2 assembled, stable-first (the cacheable prefix)
 *   full: string,             // prefix + tier3 (the whole prompt, in order)
 *   tier1PrefixHash: string,  // hash over tier-1 bytes (CORE's determinism owner)
 *   tier2ContentHash: string, // tier-2's existing envelope content-hash (ADAPTER's owner)
 *   prefixHash: string,       // hash over the whole tier1+tier2 prefix (the cache-key proxy)
 * }}
 */
export function renderPromptTiers(promptTiers) {
  assert(promptTiers && typeof promptTiers === "object" && !Array.isArray(promptTiers),
    "promptTiers must be an object with tier1/tier2/tier3");
  for (const t of TIER_ORDER) {
    assert(t in promptTiers, `promptTiers is missing ${t}`);
  }

  // tier 2 is a normalized value — validate it and reuse its OWN content-hash (the adapter is
  // the tier-2 byte-stability owner; recomputing a separate hash here would create two hashes
  // for the same bytes, exactly the drift the content-hash exists to prevent).
  const tier2Value = promptTiers.tier2;
  validateNormalized(tier2Value);
  // tier-2's content-hash IS the source content-hash promoted to a first-class envelope field
  // (T-HARD-07 / docs/04a): the SAME value the file-transport upload cache keys off
  // (src/adapters/file-transport.js). Reading the envelope field here (not recomputing) is what
  // keeps the tier-2 cache-hit diagnostic and the file re-upload decision on ONE value.
  const tier2ContentHash = tier2Value.envelope.contentHash;

  // Each tier is rendered as a canonical, labelled block so the boundaries are explicit data
  // (a runtime adapter maps them to cache breakpoints; the core only marks them).
  const tier1Bytes = renderTierBlock("tier1", promptTiers.tier1);
  const tier2Bytes = renderTierBlock("tier2", normalizedForPrompt(tier2Value));
  const tier3Bytes = renderTierBlock("tier3", promptTiers.tier3);

  const prefix = `${tier1Bytes}\n${tier2Bytes}`;
  const full = `${prefix}\n${tier3Bytes}`;

  return {
    tiers: { tier1: tier1Bytes, tier2: tier2Bytes, tier3: tier3Bytes },
    prefix,
    full,
    // tier-1 prefix hash: the CORE's determinism signal, distinct from the adapter's tier-2
    // content-hash so the two owners are told apart (docs/10 cache-hit determinism owner).
    tier1PrefixHash: contentHash(promptTiers.tier1),
    tier2ContentHash,
    // the whole-prefix hash is the cheap proxy for "is the cacheable prefix byte-identical?".
    prefixHash: hashOfBytes(prefix),
  };
}

/**
 * Render one tier as a canonical, labelled block: a stable header line naming the tier, then
 * the tier's payload canonically serialized. The header is fixed text (no run-variable data),
 * so the block is byte-deterministic for a given payload.
 */
function renderTierBlock(tier, payload) {
  const label = TIER_LABEL[tier];
  // canonicalize enforces the byte-stability rules (sorted keys, stable numbers, no volatile
  // keys / timestamps / run-ids); a volatile datum in any tier fails loudly here.
  const body = canonicalize(payload);
  return `<<${tier}:${label}>>\n${body}`;
}

/**
 * Reduce a normalized value to the data the prompt carries for tier 2: the kind + identity +
 * the payload (the client facts). The content-hash and schema-version are envelope plumbing,
 * not prompt content; identity is included because it is human-meaningful provenance. The
 * result is a plain object so canonicalize sees only data.
 */
function normalizedForPrompt(value) {
  return {
    kind: value.envelope.kind,
    identity: value.envelope.identity,
    payload: value.payload,
  };
}

/** sha256 over raw bytes (a string), self-describing like content-hash. */
function hashOfBytes(bytes) {
  // Hash a wrapper object so the digest is over canonical bytes and stays format-consistent
  // with content-hash (which hashes canonicalize(value)). Wrapping a string is canonical and
  // stable, so this is a deterministic digest of the prefix text.
  return contentHash({ prefix: bytes });
}
