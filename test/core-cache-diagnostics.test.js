// Cache-hit determinism diagnostics — attribute a cache-hit drop to its OWNER (T-P4-05 / OBS-02,
// docs/10 §"Who owns cache-hit determinism").
//
// Sources: concept + first principles, zero third-party skills-factory files (clean-room).
//
// WHAT THIS PROVES. The cached prefix has TWO determinism owners — tier 1 (the engine/skill text,
// owned by the CORE) and tier 2 (the normalized description, owned by the INPUT ADAPTER). A
// cache-hit drop can be either's fault, and the dashboard must point at the RIGHT one. Using the
// two byte-stable fingerprints the prompt-tiers renderer already emits, this test simulates each
// break in isolation and proves the attribution:
//   - a TIER-1 break (the core's text changed)        → owner = core, NOT the input adapter.
//   - a TIER-2 break (the normalized description)      → owner = input-adapter, NOT the core.
//   - both fingerprints HELD but the ratio dropped     → downstream (backend/cache), neither owner.
// Plus: the diagnostic attributes are well-formed content-hashes and secret-free.

import { test } from "node:test";
import assert from "node:assert/strict";

import { renderPromptTiers } from "../src/core/prompt-tiers.js";
import { makeDescription } from "../src/core/index.js";
import {
  CACHE_OWNER,
  CACHE_DIAG_ATTR,
  cacheDiagnosticAttributes,
  attributeCacheDrop,
} from "../src/core/cache-diagnostics.js";

// A tier-2 normalized description (the input adapter's byte-stable output). `accent` lets us perturb
// ONLY tier 2 (the description) without touching tier 1.
function description(accent = "#e5232b") {
  return makeDescription({
    kind: "design-system",
    identity: "./resources/example-studio.tokens.json",
    payload: {
      roles: [{ alias: "color.primitive.red", name: "color.semantic.accent", type: "color" }],
      tokens: [{ name: "color.primitive.red", type: "color", value: accent }],
    },
  });
}

function tiers({ skill = "create-component", accent = "#e5232b" } = {}) {
  return {
    tier1: { engine: "skillforge", skill }, // perturb `skill` to break tier 1 only
    tier2: description(accent), // perturb `accent` to break tier 2 only
    tier3: { request: { componentName: "Button" }, project: null },
  };
}

// Reduce a rendered tiers result to the two fingerprints attributeCacheDrop compares.
function fingerprints(rendered) {
  return { tier1PrefixHash: rendered.tier1PrefixHash, tier2ContentHash: rendered.tier2ContentHash };
}

// --- the attribute builder ----------------------------------------------------------------

test("cacheDiagnosticAttributes carries the two owner-keyed fingerprints (well-formed hashes)", () => {
  const r = renderPromptTiers(tiers());
  const attrs = cacheDiagnosticAttributes(fingerprints(r));
  assert.equal(attrs[CACHE_DIAG_ATTR.TIER1_PREFIX_HASH], r.tier1PrefixHash);
  assert.equal(attrs[CACHE_DIAG_ATTR.TIER2_CONTENT_HASH], r.tier2ContentHash);
  assert.match(attrs[CACHE_DIAG_ATTR.TIER1_PREFIX_HASH], /^sha256:[0-9a-f]{64}$/);
  assert.match(attrs[CACHE_DIAG_ATTR.TIER2_CONTENT_HASH], /^sha256:[0-9a-f]{64}$/);
});

test("cacheDiagnosticAttributes refuses a malformed fingerprint (validate before reasoning)", () => {
  assert.throws(
    () => cacheDiagnosticAttributes({ tier1PrefixHash: "not-a-hash", tier2ContentHash: "sha256:" + "0".repeat(64) }),
    /tier1PrefixHash must be a content-hash/,
  );
});

// --- attribution: each break in isolation -------------------------------------------------

test("a clean re-run (both fingerprints identical) attributes nothing to either owner", () => {
  const base = fingerprints(renderPromptTiers(tiers()));
  const same = fingerprints(renderPromptTiers(tiers())); // deterministic → identical
  assert.deepEqual(same, base, "the same tiers render byte-identical fingerprints");
  const d = attributeCacheDrop(same, base);
  assert.equal(d.tier1Changed, false);
  assert.equal(d.tier2Changed, false);
  assert.equal(d.downstream, true);
  assert.deepEqual(d.owners, [CACHE_OWNER.DOWNSTREAM]);
  assert.match(d.message, /downstream of the prefix/);
});

test("★ a TIER-1 break is attributed to the CORE, not the input adapter", () => {
  const base = fingerprints(renderPromptTiers(tiers()));
  // Perturb ONLY tier 1 (the engine/skill text) — tier 2 (the description) is unchanged.
  const broken = fingerprints(renderPromptTiers(tiers({ skill: "create-component-v2" })));

  assert.notEqual(broken.tier1PrefixHash, base.tier1PrefixHash, "tier-1 fingerprint changed");
  assert.equal(broken.tier2ContentHash, base.tier2ContentHash, "tier-2 fingerprint held");

  const d = attributeCacheDrop(broken, base);
  assert.equal(d.tier1Changed, true);
  assert.equal(d.tier2Changed, false);
  assert.deepEqual(d.owners, [CACHE_OWNER.CORE], "tier-1 break → CORE is named");
  assert.ok(!d.owners.includes(CACHE_OWNER.INPUT_ADAPTER), "the input adapter is NOT blamed for a tier-1 break");
  assert.match(d.message, /CORE/);
});

test("★ a TIER-2 break is attributed to the INPUT ADAPTER, not the core", () => {
  const base = fingerprints(renderPromptTiers(tiers()));
  // Perturb ONLY tier 2 (the normalized description) — tier 1 (engine/skill text) is unchanged.
  const broken = fingerprints(renderPromptTiers(tiers({ accent: "#abcdef" })));

  assert.equal(broken.tier1PrefixHash, base.tier1PrefixHash, "tier-1 fingerprint held");
  assert.notEqual(broken.tier2ContentHash, base.tier2ContentHash, "tier-2 fingerprint changed");

  const d = attributeCacheDrop(broken, base);
  assert.equal(d.tier1Changed, false);
  assert.equal(d.tier2Changed, true);
  assert.deepEqual(d.owners, [CACHE_OWNER.INPUT_ADAPTER], "tier-2 break → INPUT ADAPTER is named");
  assert.ok(!d.owners.includes(CACHE_OWNER.CORE), "the core is NOT blamed for a tier-2 break");
  assert.match(d.message, /INPUT ADAPTER/);
});

test("both tiers changed → both owners are named (neither break is masked)", () => {
  const base = fingerprints(renderPromptTiers(tiers()));
  const broken = fingerprints(renderPromptTiers(tiers({ skill: "create-component-v2", accent: "#abcdef" })));
  const d = attributeCacheDrop(broken, base);
  assert.equal(d.tier1Changed, true);
  assert.equal(d.tier2Changed, true);
  assert.deepEqual(d.owners.sort(), [CACHE_OWNER.CORE, CACHE_OWNER.INPUT_ADAPTER].sort());
  assert.equal(d.downstream, false);
});
