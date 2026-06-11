// Source content-hash as a first-class envelope field, shared by file re-upload AND the tier-2
// cache-hit diagnostic (T-HARD-07 / docs/04a §envelope content-hash, docs/04 §file transport).
//
// Sources: concept + first principles, zero third-party skills-factory files (clean-room).
//
// THE ACCEPTANCE THIS PROVES (T-HARD-07): "the SAME content-hash keys the file re-upload AND feeds
// the tier-2 cache diagnostic." docs/04a names the envelope content-hash as THE SINGLE value behind
// determinism, prompt-prefix cache validity, and the upload-once/reference-many file optimization.
// This test proves the two consumers the audit asked to unify read the IDENTICAL value:
//   - the file-transport upload cache keys off sourceContentHash(description);
//   - the tier-2 cache-hit diagnostic reads the SAME envelope content-hash (via prompt-tiers);
// and the file cache behaves: upload-once / reference-many, and a CHANGED source re-uploads.

import { test } from "node:test";
import assert from "node:assert/strict";

import { makeDescription, makeResult, sourceContentHash } from "../src/core/index.js";
import { renderPromptTiers } from "../src/core/prompt-tiers.js";
import { createUploadCache } from "../src/adapters/index.js";

// A tier-2 normalized description (the input adapter's byte-stable output). `accent` lets us change
// the SOURCE without touching anything else.
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

function tiers(desc) {
  return {
    tier1: { engine: "skillforge", skill: "create-component" },
    tier2: desc,
    tier3: { request: { componentName: "Button" }, project: null },
  };
}

// =====================================================================================
// THE UNIFICATION — file re-upload key === tier-2 diagnostic value === sourceContentHash
// =====================================================================================

test("the file re-upload key and the tier-2 cache diagnostic use the IDENTICAL content-hash", () => {
  const desc = description();

  // consumer 1 — the file-transport upload cache keys off the source content-hash
  const cache = createUploadCache();
  const fileKey = cache.keyFor(desc);

  // consumer 2 — the tier-2 cache-hit diagnostic (via the prompt-tiers renderer)
  const rendered = renderPromptTiers(tiers(desc));
  const tier2DiagnosticHash = rendered.tier2ContentHash;

  // the promoted first-class field itself
  const promoted = sourceContentHash(desc);

  // all three are ONE value (the T-HARD-07 acceptance)
  assert.equal(fileKey, promoted, "file re-upload key must equal the source content-hash");
  assert.equal(tier2DiagnosticHash, promoted, "tier-2 diagnostic must read the SAME source content-hash");
  assert.equal(fileKey, tier2DiagnosticHash, "the two consumers must share one value");
});

test("sourceContentHash is the envelope's content-hash promoted to a named field", () => {
  const desc = description();
  assert.equal(sourceContentHash(desc), desc.envelope.contentHash);
});

// =====================================================================================
// THE FILE CONSUMER — upload-once / reference-many, and a changed source RE-UPLOADS
// =====================================================================================

test("upload-once, reference-many — the same source uploads once, then reuses the handle", () => {
  const desc = description();
  const cache = createUploadCache();
  let uploads = 0;
  const upload = (key) => {
    uploads++;
    return `file-handle-for-${key.slice(0, 16)}`;
  };

  const first = cache.ensureUploaded(desc, upload);
  assert.equal(first.reused, false);
  assert.equal(uploads, 1);

  // a second call for the SAME source (a fresh-but-equal description) reuses, does NOT re-upload
  const again = cache.ensureUploaded(description(), upload);
  assert.equal(again.reused, true);
  assert.equal(again.handle, first.handle);
  assert.equal(uploads, 1, "an unchanged source must not re-upload");
  assert.equal(cache.size(), 1);
});

test("a CHANGED source has a different content-hash → cache miss → re-upload", () => {
  const cache = createUploadCache();
  let uploads = 0;
  const upload = () => `handle-${++uploads}`;

  cache.ensureUploaded(description("#e5232b"), upload);
  const changed = cache.ensureUploaded(description("#00aaff"), upload); // different source bytes

  assert.equal(changed.reused, false, "a changed source must re-upload");
  assert.equal(uploads, 2);
  assert.equal(cache.size(), 2);
  // and the diagnostic agrees the tier-2 fingerprint changed for the changed source
  const a = renderPromptTiers(tiers(description("#e5232b"))).tier2ContentHash;
  const b = renderPromptTiers(tiers(description("#00aaff"))).tier2ContentHash;
  assert.notEqual(a, b, "changed source → different tier-2 fingerprint (consumers stay in lockstep)");
});

// =====================================================================================
// EDGE / VALIDATION — source content-hash is an INPUT-edge notion; bad input fails loud
// =====================================================================================

test("sourceContentHash rejects an OUTPUT result (it hashes a source, not an artifact)", () => {
  const result = makeResult({
    kind: "frontend-component",
    identity: "Button",
    payload: { componentName: "Button", parts: [] },
  });
  assert.throws(() => sourceContentHash(result), /INPUT description/);
});

test("the upload cache validates the description (rejecting a non-normalized value)", () => {
  const cache = createUploadCache();
  assert.throws(() => cache.keyFor({ not: "normalized" }), /edge must be "input" or "output"/);
  assert.throws(() => cache.ensureUploaded(description(), "not-a-function"), /upload\(key\)/);
});
