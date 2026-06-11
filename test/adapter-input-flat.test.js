// The input-edge genericity mirror (T-P2-04): two input adapters reading EQUIVALENT sources
// assemble the SAME normalized description.
//
// Sources: concept + first principles, zero third-party skills-factory files (clean-room).
// docs/04 §"How to add a new adapter" step 6 (the mirror). Asserts the flat-tokens adapter and
// the dtcg-tokens adapter — reading a FLAT file vs a NESTED DTCG file that represent the SAME
// design system — produce descriptions that are EQUIVALENT under the relation from T-P2-01.
// This proves the input edge adds FORM, not CONTENT (the core is generic over the source format).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { readDesignSystem as readDtcg } from "../src/adapters/input/dtcg-tokens.js";
import { readDesignSystem as readFlat, flatToPayload, SOURCE_KIND } from "../src/adapters/input/flat-tokens.js";
import { resultsEquivalent, assertEquivalent } from "../src/core/index.js";

const DTCG_FIXTURE = fileURLToPath(new URL("./fixtures/dtcg-example-studio.tokens.json", import.meta.url));
const FLAT_FIXTURE = fileURLToPath(new URL("./fixtures/flat-example-studio.tokens.json", import.meta.url));

// A loader-shaped reference handle pointing the adapter at a fixture path (the adapter reads
// `references.tokenHub`). `local: true` + resolvedPath is what the loader hands a local file.
function refsTo(path) {
  return { tokenHub: { ref: "./tokens", resolvedPath: path, local: true } };
}

test("the flat-tokens adapter produces the design-system source-kind (mirror of dtcg-tokens)", () => {
  const flat = readFlat({ references: refsTo(FLAT_FIXTURE) });
  assert.equal(flat.edge, "input");
  assert.equal(flat.envelope.kind, SOURCE_KIND);
  assert.equal(SOURCE_KIND, "design-system");
});

test("MIRROR: flat-tokens and dtcg-tokens assemble EQUIVALENT descriptions for equivalent sources", () => {
  const fromDtcg = readDtcg({ references: refsTo(DTCG_FIXTURE) });
  const fromFlat = readFlat({ references: refsTo(FLAT_FIXTURE) });

  // The two read DIFFERENT on-disk representations…
  assert.notEqual(
    readFileSync(DTCG_FIXTURE, "utf8"),
    readFileSync(FLAT_FIXTURE, "utf8"),
    "the two fixtures must be genuinely different source representations",
  );
  // …yet assemble the SAME normalized description under the T-P2-01 equivalence relation.
  assert.ok(resultsEquivalent(fromDtcg, fromFlat), "the two input adapters must agree on the normalized description");
  // assertEquivalent throws with a localized clause if not — call it so a break is loud.
  assert.doesNotThrow(() => assertEquivalent(fromDtcg, fromFlat, "dtcg-tokens vs flat-tokens"));
});

test("the equivalence is on intent, not identity: identities legitimately differ", () => {
  const fromDtcg = readDtcg({ references: refsTo(DTCG_FIXTURE), identity: "src-A" });
  const fromFlat = readFlat({ references: refsTo(FLAT_FIXTURE), identity: "src-B" });
  assert.notEqual(fromDtcg.envelope.identity, fromFlat.envelope.identity);
  assert.ok(resultsEquivalent(fromDtcg, fromFlat), "differing identity must not break equivalence");
});

test("flatToPayload: literals → tokens, refs → roles, both sorted by name (order-independent)", () => {
  const payload = flatToPayload([
    { name: "color.semantic.accent", type: "color", ref: "color.primitive.red" },
    { name: "color.primitive.red", type: "color", value: "#e5232b" },
    { name: "space.1", type: "dimension", value: "4px" },
  ]);
  assert.deepEqual(payload.tokens.map((t) => t.name), ["color.primitive.red", "space.1"]);
  assert.deepEqual(payload.roles.map((r) => r.name), ["color.semantic.accent"]);
  assert.deepEqual(payload.roles[0], { name: "color.semantic.accent", type: "color", alias: "color.primitive.red" });
});

test("flatToPayload: rejects an entry that is both a value and a ref (one or the other)", () => {
  assert.throws(
    () => flatToPayload([{ name: "x", value: "1", ref: "y" }]),
    /both value and ref/,
  );
});

test("flatToPayload: rejects an entry with neither value nor ref", () => {
  assert.throws(() => flatToPayload([{ name: "x", type: "color" }]), /neither value nor ref/);
});

test("flatToPayload: rejects a non-array document and a nameless entry", () => {
  assert.throws(() => flatToPayload({ not: "an array" }), /must be a JSON array/);
  assert.throws(() => flatToPayload([{ value: "1" }]), /non-empty dotted `name`/);
});

test("readDesignSystem (flat): a malformed source flags isMalformed (classifies PERMANENT)", () => {
  const err = (() => {
    try {
      readFlat({ references: refsTo(FLAT_FIXTURE), readFile: () => "{ not json" });
    } catch (e) {
      return e;
    }
  })();
  assert.ok(err);
  assert.equal(err.isMalformed, true);
  // The reference is named, the raw file contents are NOT echoed.
  assert.doesNotMatch(err.message, /not json/);
});

test("readDesignSystem (flat): the description is byte-deterministic for one source", () => {
  const a = readFlat({ references: refsTo(FLAT_FIXTURE) });
  const b = readFlat({ references: refsTo(FLAT_FIXTURE) });
  assert.equal(a.envelope.contentHash, b.envelope.contentHash);
});
