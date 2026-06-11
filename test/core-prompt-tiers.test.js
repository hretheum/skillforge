// Tests for the tier-1 prompt rendering byte-determinism (docs/02 §stability tiers,
// docs/07 §Verification — the determinism gate extended to the prefix).
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { renderPromptTiers, TIER_ORDER } from "../src/core/prompt-tiers.js";
import { makeDescription, contentHash, isContentHash } from "../src/core/index.js";

const goldenPath = fileURLToPath(new URL("./fixtures/prompt-prefix-golden.txt", import.meta.url));

// A tier-2 normalized description (the input adapter's byte-stable output). The default
// identity mirrors a LIVE run: the DTCG input adapter defaults identity to the reference
// ADDRESS, so this synthetic shape and a real run() produce the same golden prefix — which
// lets T-MVP-14's determinism-gate drive the renderer from either source without a false-fail.
function description(identity = "./resources/example-studio.tokens.json") {
  return makeDescription({
    kind: "design-system",
    identity,
    payload: {
      roles: [
        { alias: "color.primitive.red", name: "color.semantic.accent", type: "color" },
        { alias: "color.primitive.ink", name: "color.semantic.bg", type: "color" },
        { alias: "color.primitive.paper", name: "color.semantic.fg", type: "color" },
      ],
      tokens: [
        { name: "border.width.base", type: "dimension", value: "2px" },
        { name: "color.primitive.ink", type: "color", value: "#0b0a0a" },
        { name: "color.primitive.paper", type: "color", value: "#f4f0e7" },
        { name: "color.primitive.red", type: "color", value: "#e5232b" },
        { name: "space.1", type: "dimension", value: "4px" },
        { name: "space.2", type: "dimension", value: "8px" },
        { name: "space.3", type: "dimension", value: "16px" },
      ],
    },
  });
}

function tiers(overrides = {}) {
  return {
    tier1: { engine: "skillforge", skill: "create-component" },
    tier2: description(),
    tier3: { request: { componentName: "Button" }, project: null },
    ...overrides,
  };
}

test("emits the three tiers in stable order, most-stable first", () => {
  const r = renderPromptTiers(tiers());
  assert.deepEqual(TIER_ORDER, ["tier1", "tier2", "tier3"]);
  const i1 = r.full.indexOf("<<tier1:ENGINE/SKILL>>");
  const i2 = r.full.indexOf("<<tier2:CLIENT>>");
  const i3 = r.full.indexOf("<<tier3:REQUEST>>");
  assert.ok(i1 >= 0 && i2 > i1 && i3 > i2, "tiers must appear in order 1→2→3, never interleaved");
});

test("the prefix is exactly tier1+tier2 (the cacheable prefix); full adds tier3", () => {
  const r = renderPromptTiers(tiers());
  assert.equal(r.prefix, `${r.tiers.tier1}\n${r.tiers.tier2}`);
  assert.equal(r.full, `${r.prefix}\n${r.tiers.tier3}`);
});

test("determinism: two renders of the same request → byte-identical prefix (the acceptance)", () => {
  const a = renderPromptTiers(tiers());
  const b = renderPromptTiers(tiers());
  assert.equal(a.prefix, b.prefix);
  assert.equal(a.full, b.full);
  assert.equal(a.prefixHash, b.prefixHash);
  assert.equal(a.tier1PrefixHash, b.tier1PrefixHash);
});

test("determinism-gate: the prefix byte-matches the checked-in golden", () => {
  const golden = readFileSync(goldenPath, "utf8");
  assert.equal(renderPromptTiers(tiers()).prefix, golden,
    "prompt prefix drifted from the golden — tier-1/tier-2 rendering changed");
});

test("tier-1 is byte-stable regardless of key order in the tier-1 object", () => {
  const a = renderPromptTiers(tiers({ tier1: { engine: "skillforge", skill: "create-component" } }));
  const b = renderPromptTiers(tiers({ tier1: { skill: "create-component", engine: "skillforge" } }));
  assert.equal(a.tiers.tier1, b.tiers.tier1);
  assert.equal(a.tier1PrefixHash, b.tier1PrefixHash);
});

test("two-owner attribution: tier-1 prefix hash is distinct from tier-2 content-hash", () => {
  const r = renderPromptTiers(tiers());
  assert.ok(isContentHash(r.tier1PrefixHash));
  assert.ok(isContentHash(r.tier2ContentHash));
  assert.notEqual(r.tier1PrefixHash, r.tier2ContentHash);
});

test("tier-2 content-hash is REUSED from the adapter's envelope (not recomputed divergently)", () => {
  const t = tiers();
  const r = renderPromptTiers(t);
  assert.equal(r.tier2ContentHash, t.tier2.envelope.contentHash);
});

test("a tier-1 change moves the tier-1 hash AND the prefix hash, but NOT the tier-2 hash", () => {
  const base = renderPromptTiers(tiers());
  const changed = renderPromptTiers(tiers({ tier1: { engine: "skillforge", skill: "create-openapi" } }));
  assert.notEqual(changed.tier1PrefixHash, base.tier1PrefixHash); // core owner moved
  assert.notEqual(changed.prefixHash, base.prefixHash); // prefix changed
  assert.equal(changed.tier2ContentHash, base.tier2ContentHash); // adapter owner unchanged
});

test("a tier-2 change moves the tier-2 hash AND the prefix hash, but NOT the tier-1 hash", () => {
  // The tier-2 content-hash is over the PAYLOAD (the client facts), so move the payload —
  // a different token value is a genuine source change the adapter owns.
  const base = renderPromptTiers(tiers());
  const changedDesc = makeDescription({
    kind: "design-system",
    identity: "example-studio/tokens@golden",
    payload: { roles: [], tokens: [{ name: "color.primitive.red", type: "color", value: "#ff0000" }] },
  });
  const changed = renderPromptTiers(tiers({ tier2: changedDesc }));
  assert.notEqual(changed.tier2ContentHash, base.tier2ContentHash); // adapter owner moved
  assert.notEqual(changed.prefixHash, base.prefixHash);
  assert.equal(changed.tier1PrefixHash, base.tier1PrefixHash); // core owner unchanged
});

test("changing only tier-2 identity changes the prefix but NOT the tier-2 content-hash", () => {
  // The content-hash is over the payload, not the envelope identity — so two sources with the
  // same payload but different identities share a content-hash, yet render a different prefix
  // (identity is human-meaningful provenance carried in the tier-2 block).
  const base = renderPromptTiers(tiers());
  const renamed = renderPromptTiers(tiers({ tier2: description("different/source") }));
  assert.equal(renamed.tier2ContentHash, base.tier2ContentHash); // payload identical → same hash
  assert.notEqual(renamed.prefix, base.prefix); // identity differs in the rendered block
});

test("a tier-3 (request) change does NOT change the cacheable prefix", () => {
  const base = renderPromptTiers(tiers());
  const changed = renderPromptTiers(tiers({ tier3: { request: { componentName: "Seal" }, project: "p2" } }));
  assert.equal(changed.prefix, base.prefix, "tier-3 is variable; the prefix must stay stable");
  assert.equal(changed.prefixHash, base.prefixHash);
  assert.notEqual(changed.full, base.full); // but the whole prompt differs
});

test("rejects a volatile datum in any tier (no timestamps/run-ids in the prefix)", () => {
  assert.throws(
    () => renderPromptTiers(tiers({ tier1: { engine: "skillforge", skill: "x", timestamp: 1 } })),
    /volatile key/,
  );
});

test("requires tier2 to be a normalized value (carries its own content-hash)", () => {
  // A non-normalized tier-2 is rejected by validateNormalized (it has no edge/envelope) —
  // the renderer will not build a prefix around an unvalidated client payload.
  assert.throws(() => renderPromptTiers(tiers({ tier2: { not: "normalized" } })), /edge|envelope|normalized/);
});

test("requires all three tiers to be present", () => {
  const t = tiers();
  delete t.tier3;
  assert.throws(() => renderPromptTiers(t), /missing tier3/);
});

test("prefixHash is a stable digest of the prefix bytes", () => {
  const r = renderPromptTiers(tiers());
  assert.equal(r.prefixHash, contentHash({ prefix: r.prefix }));
});
