// Tests for the `web-components` output adapter: normalized frontend-component result → a
// vanilla custom element, fidelity (explicit source-class references, no source re-read),
// determinism, and — the genericity point — that it consumes the SAME normalized result as
// the `react` adapter (one intent, two forms).
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room). See docs/04-adapters.md step 6, docs/07 §"Gate 2".

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  renderWebComponent,
  makeComponentResult,
  RESULT_KIND,
  ADAPTER_NAME,
  register,
} from "../src/adapters/output/web-components.js";
import { makeComponentResult as makeReactResult } from "../src/adapters/output/react.js";
import { makeResult, resultsEquivalent } from "../src/core/index.js";

// `.js.txt` so node's test runner does not pick the golden up as a test file; it is a fixture.
const goldenPath = fileURLToPath(new URL("./fixtures/web-components-golden-Button.js.txt", import.meta.url));

function buttonSpec() {
  return {
    componentName: "Button",
    element: "button",
    baseClass: "hbtn",
    variants: [
      { prop: "variant", value: "acc", class: "hbtn--acc" },
      { prop: "size", value: "s", class: "hbtn--sm" },
    ],
    decorations: [{ element: "span", class: "sq", ariaHidden: true }],
    sourceClasses: ["hbtn", "hbtn--acc", "hbtn--sm", "sq"],
  };
}

test("accepts result-kind frontend-component (the SAME kind react accepts)", () => {
  const result = makeComponentResult(buttonSpec(), "Button");
  assert.equal(result.envelope.kind, RESULT_KIND);
  assert.equal(RESULT_KIND, "frontend-component");
  const art = renderWebComponent(result);
  assert.equal(art.filename, "x-button.js");
  assert.equal(art.language, "js");
  assert.equal(art.tagName, "x-button");
});

test("fidelity-gate: artifact byte-matches the checked-in golden", () => {
  const art = renderWebComponent(makeComponentResult(buttonSpec(), "Button"));
  const golden = readFileSync(goldenPath, "utf8");
  assert.equal(art.source, golden,
    "web-component artifact drifted from the golden — the rendered element changed");
});

test("the element composes the canonical base class and variant classes", () => {
  const art = renderWebComponent(makeComponentResult(buttonSpec(), "Button"));
  assert.match(art.source, /"hbtn"/);
  assert.match(art.source, /this\.getAttribute\("variant"\) === "acc" && "hbtn--acc"/);
  assert.match(art.source, /this\.getAttribute\("size"\) === "s" && "hbtn--sm"/);
});

test("the element observes one attribute per variant prop, in stable order", () => {
  const art = renderWebComponent(makeComponentResult(buttonSpec(), "Button"));
  assert.match(art.source, /return \["size", "variant"\];/);
});

test("fidelity: artifact carries explicit references to the source CSS classes (no re-read)", () => {
  const art = renderWebComponent(makeComponentResult(buttonSpec(), "Button"));
  assert.deepEqual(art.sourceClasses, ["hbtn", "hbtn--acc", "hbtn--sm", "sq"]);
});

test("the custom-element tag always carries a hyphen (custom-element requirement)", () => {
  const art = renderWebComponent(makeComponentResult({
    componentName: "FormField",
    element: "div",
    baseClass: "ff",
    sourceClasses: ["ff"],
  }, "FormField"));
  assert.equal(art.tagName, "x-form-field");
  assert.match(art.source, /customElements\.define\("x-form-field", FormFieldElement\)/);
});

test("determinism: same result renders byte-identical source every run", () => {
  const a = renderWebComponent(makeComponentResult(buttonSpec(), "Button")).source;
  const b = renderWebComponent(makeComponentResult(buttonSpec(), "Button")).source;
  assert.equal(a, b);
});

test("determinism: variant order in the spec does not change the artifact", () => {
  const spec = buttonSpec();
  const reordered = { ...spec, variants: [...spec.variants].reverse() };
  const a = renderWebComponent(makeComponentResult(spec, "Button")).source;
  const b = renderWebComponent(makeComponentResult(reordered, "Button")).source;
  assert.equal(a, b);
});

test("reuses the react adapter's fidelity validation (a class the source did not author is rejected)", () => {
  const spec = buttonSpec();
  spec.variants.push({ prop: "tone", value: "loud", class: "hbtn--loud" }); // not in sourceClasses
  assert.throws(() => renderWebComponent(makeComponentResult(spec, "Button")), /not declared in sourceClasses/);
});

test("refuses a result of the wrong result-kind (typing)", () => {
  const wrong = makeResult({ kind: "openapi-spec", identity: "x", payload: { foo: 1 } });
  assert.throws(() => renderWebComponent(wrong), /only accepts result-kind "frontend-component"/);
});

test("renders a variant-less component (just the base class + slot)", () => {
  const spec = {
    componentName: "Seal",
    element: "div",
    baseClass: "seal",
    sourceClasses: ["seal"],
  };
  const art = renderWebComponent(makeComponentResult(spec, "Seal"));
  assert.match(art.source, /"seal"/);
  assert.match(art.source, /export class SealElement/);
  assert.equal(art.filename, "x-seal.js");
  assert.match(art.source, /static get observedAttributes\(\) \{\s*return \[\];/);
});

test("register adds the adapter under its stable name on the output edge", () => {
  const seen = [];
  register({ register: (edge, name) => seen.push([edge, name]) });
  assert.deepEqual(seen, [["output", "web-components"]]);
  assert.equal(ADAPTER_NAME, "web-components");
});

// --- THE GENERICITY POINT: one intent, two forms ---------------------------------------------

test("genericity: the React result and the Web-Components result of one spec are EQUIVALENT", () => {
  // The SAME spec, two output adapters → two normalized results that express the SAME intent
  // (the equivalence relation `≈` from T-P2-01 holds). The artifacts differ in FORM; the
  // results agree. This is the assertion the Gate 2 harness (T-P2-03) mechanizes.
  const spec = buttonSpec();
  const viaReact = makeReactResult(spec, "Button");
  const viaWebComponents = makeComponentResult(spec, "Button");
  assert.equal(resultsEquivalent(viaReact, viaWebComponents), true);
});

test("genericity: the two adapters render DIFFERENT forms of that one intent", () => {
  const spec = buttonSpec();
  const wc = renderWebComponent(makeComponentResult(spec, "Button"));
  // The web-component form is a .js custom element, not a .tsx React wrapper.
  assert.equal(wc.language, "js");
  assert.match(wc.source, /extends HTMLElement/);
  assert.doesNotMatch(wc.source, /forwardRef/); // proves it is not the react form
});
