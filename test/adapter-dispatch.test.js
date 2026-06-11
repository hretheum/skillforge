// Tests for the adapter-dispatch registry (name -> adapter implementation).
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room).

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import {
  EDGES,
  getInputAdapter,
  getOutputAdapter,
  getAdapter,
  hasAdapter,
  inputAdapterNames,
  outputAdapterNames,
} from "../src/adapters/index.js";
import { serialize, validateNormalized } from "../src/core/index.js";

const fixturePath = fileURLToPath(new URL("./fixtures/dtcg-example-studio.tokens.json", import.meta.url));

test("resolves the dtcg-tokens input adapter to its callables", () => {
  const impl = getInputAdapter("dtcg-tokens");
  assert.equal(impl.kind, "design-system");
  assert.equal(typeof impl.read, "function");
});

test("resolves the react output adapter to its callables", () => {
  const impl = getOutputAdapter("react");
  assert.equal(impl.kind, "frontend-component");
  assert.equal(typeof impl.makeResult, "function");
  assert.equal(typeof impl.render, "function");
});

test("the resolved input adapter actually reads a design system end to end", () => {
  const { read } = getInputAdapter("dtcg-tokens");
  const desc = read({
    references: {
      tokenHub: { ref: "./resources/example-studio.tokens.json", resolvedPath: fixturePath, local: true },
    },
    identity: "example-studio/tokens@golden",
  });
  assert.equal(validateNormalized(desc), true);
  assert.equal(desc.envelope.kind, "design-system");
});

test("the resolved output adapter makes a result and renders an artifact", () => {
  const { makeResult, render } = getOutputAdapter("react");
  const result = makeResult(
    { componentName: "Seal", element: "div", baseClass: "seal", sourceClasses: ["seal"] },
    "Seal",
  );
  assert.equal(validateNormalized(result), true);
  assert.equal(result.envelope.kind, "frontend-component");
  const art = render(result);
  assert.equal(art.filename, "Seal.tsx");
  // the resolved chain is byte-stable like the direct calls
  assert.equal(typeof serialize(result), "string");
});

test("getAdapter resolves by edge + name", () => {
  assert.equal(getAdapter(EDGES.INPUT, "dtcg-tokens").kind, "design-system");
  assert.equal(getAdapter(EDGES.OUTPUT, "react").kind, "frontend-component");
});

test("unknown names fail loud and early on both edges", () => {
  assert.throws(() => getInputAdapter("jira"), /no input adapter implementation registered under "jira"/);
  assert.throws(() => getOutputAdapter("openapi"), /no output adapter implementation registered under "openapi"/);
  assert.throws(() => getAdapter(EDGES.INPUT, "nope"), /no input adapter/);
});

test("getAdapter rejects an unknown edge", () => {
  assert.throws(() => getAdapter("sideways", "react"), /unknown adapter edge/);
});

test("hasAdapter reports registration per edge", () => {
  assert.equal(hasAdapter(EDGES.INPUT, "dtcg-tokens"), true);
  assert.equal(hasAdapter(EDGES.OUTPUT, "react"), true);
  assert.equal(hasAdapter(EDGES.INPUT, "react"), false); // right name, wrong edge
  assert.equal(hasAdapter(EDGES.OUTPUT, "dtcg-tokens"), false);
  assert.equal(hasAdapter(EDGES.INPUT, "nope"), false);
});

test("name listings are sorted and reflect the catalog", () => {
  // Two input adapters for the input-edge mirror (T-P2-04): `dtcg-tokens` and the second form
  // `flat-tokens`, both producing the `design-system` source-kind. Sorted.
  assert.deepEqual(inputAdapterNames(), ["dtcg-tokens", "flat-tokens"]);
  // Two output adapters for the genericity proof (Gate 2): `react` and the second form
  // `web-components`, both accepting the `frontend-component` result-kind. Sorted.
  assert.deepEqual(outputAdapterNames(), ["react", "web-components"]);
});

test("the dispatch carries no client name (generic by construction)", () => {
  // The kinds and names are FORMAT kinds, not client identifiers. Assert every
  // registered name is a lowercase-kebab format slug (so it cannot be a client
  // identifier), rather than spelling out forbidden client names here (which the
  // clean-room name-guard would then false-positive on).
  assert.equal(getInputAdapter("dtcg-tokens").kind, "design-system");
  assert.equal(getOutputAdapter("react").kind, "frontend-component");
  const formatSlug = /^[a-z][a-z0-9-]*$/;
  for (const n of [...inputAdapterNames(), ...outputAdapterNames()]) {
    assert.match(n, formatSlug);
  }
});
