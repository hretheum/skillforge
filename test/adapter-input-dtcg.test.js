// Tests for the `dtcg-tokens` input adapter: DTCG → normalized description,
// determinism against a checked-in golden, and the contract rules from docs/04.
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  readDesignSystem,
  dtcgToPayload,
  SOURCE_KIND,
  ADAPTER_NAME,
  register,
} from "../src/adapters/input/dtcg-tokens.js";
import { serialize, validateNormalized } from "../src/core/index.js";

const fixturePath = fileURLToPath(new URL("./fixtures/dtcg-example-studio.tokens.json", import.meta.url));
const goldenPath = fileURLToPath(new URL("./fixtures/dtcg-golden-description.json", import.meta.url));

function readFixture() {
  return readDesignSystem({
    references: {
      tokenHub: { ref: "./resources/example-studio.tokens.json", resolvedPath: fixturePath, local: true },
    },
    identity: "example-studio/tokens@golden",
  });
}

test("produces a normalized description with source-kind design-system", () => {
  const desc = readFixture();
  assert.equal(desc.edge, "input");
  assert.equal(desc.envelope.kind, SOURCE_KIND);
  assert.equal(SOURCE_KIND, "design-system");
  assert.equal(validateNormalized(desc), true);
});

test("flattens literals into tokens and aliases into roles", () => {
  const desc = readFixture();
  const tokenNames = desc.payload.tokens.map((t) => t.name);
  const roleNames = desc.payload.roles.map((r) => r.name);
  assert.deepEqual(tokenNames, [
    "border.width.base",
    "color.primitive.ink",
    "color.primitive.paper",
    "color.primitive.red",
    "space.1",
    "space.2",
    "space.3",
  ]);
  assert.deepEqual(roleNames, [
    "color.semantic.accent",
    "color.semantic.bg",
    "color.semantic.fg",
  ]);
});

test("aliases are unwrapped to the dotted target path (the binding structure)", () => {
  const desc = readFixture();
  const accent = desc.payload.roles.find((r) => r.name === "color.semantic.accent");
  assert.equal(accent.alias, "color.primitive.red");
  assert.equal(accent.type, "color");
});

test("$type is inherited from the nearest ancestor", () => {
  const desc = readFixture();
  // color.* inherit "color"; space.* and border.width.* inherit "dimension".
  assert.equal(desc.payload.tokens.find((t) => t.name === "color.primitive.ink").type, "color");
  assert.equal(desc.payload.tokens.find((t) => t.name === "space.1").type, "dimension");
  assert.equal(desc.payload.tokens.find((t) => t.name === "border.width.base").type, "dimension");
});

test("$extensions and $description are dropped (metadata, not binding facts)", () => {
  const desc = readFixture();
  const json = JSON.stringify(desc.payload);
  assert.equal(json.includes("$extensions"), false);
  assert.equal(json.includes("$description"), false);
  assert.equal(json.includes("cult"), false);
});

test("determinism: re-reading the same source serializes byte-identically", () => {
  const a = serialize(readFixture());
  const b = serialize(readFixture());
  assert.equal(a, b);
});

test("determinism-gate: output byte-matches the checked-in golden", () => {
  const golden = readFileSync(goldenPath, "utf8");
  assert.equal(serialize(readFixture()), golden,
    "DTCG adapter output drifted from the golden — the normalized description changed");
});

test("source key order does not change the normalized description", () => {
  // Same logical tokens, different key insertion order → identical payload (arrays sorted).
  const a = dtcgToPayload({
    color: { $type: "color", b: { $value: "#000" }, a: { $value: "#fff" } },
  });
  const b = dtcgToPayload({
    color: { $type: "color", a: { $value: "#fff" }, b: { $value: "#000" } },
  });
  assert.deepEqual(a, b);
});

test("a value that is exactly one alias is a role; a composite is a literal", () => {
  const payload = dtcgToPayload({
    role: { $value: "{color.primitive.red}" },
    composite: { $value: "1px solid {color.primitive.red}" },
  });
  assert.equal(payload.roles.length, 1);
  assert.equal(payload.roles[0].name, "role");
  assert.equal(payload.tokens.find((t) => t.name === "composite").value, "1px solid {color.primitive.red}");
});

test("rejects a non-local token hub at MVP (loud, not silent)", () => {
  assert.throws(
    () =>
      readDesignSystem({
        references: { tokenHub: { ref: "figma://abc", resolvedPath: null, local: false } },
      }),
    /local-path/,
  );
});

test("rejects a missing tokenHub reference", () => {
  assert.throws(() => readDesignSystem({ references: {} }), /tokenHub/);
});

test("rejects a malformed DTCG document", () => {
  assert.throws(() => dtcgToPayload(null), /must be a JSON object/);
  assert.throws(() => dtcgToPayload([1, 2]), /must be a JSON object/);
});

test("identity defaults to the reference address, never the client name", () => {
  const desc = readDesignSystem({
    references: {
      tokenHub: { ref: "./resources/example-studio.tokens.json", resolvedPath: fixturePath, local: true },
    },
  });
  assert.equal(desc.envelope.identity, "./resources/example-studio.tokens.json");
});

test("register adds the adapter under its stable name on the input edge", () => {
  const seen = [];
  register({ register: (edge, name) => seen.push([edge, name]) });
  assert.deepEqual(seen, [["input", "dtcg-tokens"]]);
  assert.equal(ADAPTER_NAME, "dtcg-tokens");
});
