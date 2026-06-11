// Tests for the `react` output adapter: normalized frontend-component result → thin React
// wrapper, fidelity (explicit source-class references, no source re-read), and determinism.
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  renderReact,
  makeComponentResult,
  validateComponentSpec,
  RESULT_KIND,
  ADAPTER_NAME,
  register,
} from "../src/adapters/output/react.js";
import { makeResult } from "../src/core/index.js";

const goldenPath = fileURLToPath(new URL("./fixtures/react-golden-Button.tsx", import.meta.url));

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

test("accepts result-kind frontend-component and produces a .tsx artifact", () => {
  const result = makeComponentResult(buttonSpec(), "Button");
  assert.equal(result.envelope.kind, RESULT_KIND);
  assert.equal(RESULT_KIND, "frontend-component");
  const art = renderReact(result);
  assert.equal(art.filename, "Button.tsx");
  assert.equal(art.language, "tsx");
});

test("fidelity-gate: artifact byte-matches the checked-in golden", () => {
  const art = renderReact(makeComponentResult(buttonSpec(), "Button"));
  const golden = readFileSync(goldenPath, "utf8");
  assert.equal(art.source, golden,
    "React artifact drifted from the golden — the rendered wrapper changed");
});

test("the wrapper emits the canonical base class and variant classes", () => {
  const art = renderReact(makeComponentResult(buttonSpec(), "Button"));
  assert.match(art.source, /"hbtn"/);
  assert.match(art.source, /variant === "acc" && "hbtn--acc"/);
  assert.match(art.source, /size === "s" && "hbtn--sm"/);
});

test("fidelity: artifact carries explicit references to the source CSS classes (no re-read)", () => {
  const art = renderReact(makeComponentResult(buttonSpec(), "Button"));
  assert.deepEqual(art.sourceClasses, ["hbtn", "hbtn--acc", "hbtn--sm", "sq"]);
});

test("determinism: same result renders byte-identical source every run", () => {
  const a = renderReact(makeComponentResult(buttonSpec(), "Button")).source;
  const b = renderReact(makeComponentResult(buttonSpec(), "Button")).source;
  assert.equal(a, b);
});

test("determinism: variant order in the spec does not change the artifact", () => {
  const spec = buttonSpec();
  const reordered = { ...spec, variants: [...spec.variants].reverse() };
  const a = renderReact(makeComponentResult(spec, "Button")).source;
  const b = renderReact(makeComponentResult(reordered, "Button")).source;
  assert.equal(a, b);
});

test("rejects a class the source did not author (no adapter-originated class)", () => {
  const spec = buttonSpec();
  spec.variants.push({ prop: "tone", value: "loud", class: "hbtn--loud" }); // not in sourceClasses
  assert.throws(() => validateComponentSpec(spec), /not declared in sourceClasses/);
});

test("rejects a base class missing from sourceClasses", () => {
  assert.throws(
    () => validateComponentSpec({ ...buttonSpec(), sourceClasses: ["hbtn--acc", "hbtn--sm", "sq"] }),
    /baseClass "hbtn" is not declared/,
  );
});

test("rejects an empty sourceClasses (fidelity rule needs explicit references)", () => {
  assert.throws(() => validateComponentSpec({ ...buttonSpec(), sourceClasses: [] }), /sourceClasses must be a non-empty array/);
});

test("rejects a non-PascalCase component name and a bad element", () => {
  assert.throws(() => validateComponentSpec({ ...buttonSpec(), componentName: "button" }), /PascalCase/);
  assert.throws(() => validateComponentSpec({ ...buttonSpec(), element: "Button" }), /HTML tag/);
});

test("refuses a result of the wrong result-kind (typing)", () => {
  const wrong = makeResult({ kind: "openapi-spec", identity: "x", payload: { foo: 1 } });
  assert.throws(() => renderReact(wrong), /only accepts result-kind "frontend-component"/);
});

test("renders a variant-less component (just the base class + children)", () => {
  const spec = {
    componentName: "Seal",
    element: "div",
    baseClass: "seal",
    sourceClasses: ["seal"],
  };
  const art = renderReact(makeComponentResult(spec, "Seal"));
  assert.match(art.source, /"seal"/);
  assert.match(art.source, /export const Seal/);
  assert.equal(art.filename, "Seal.tsx");
});

test("register adds the adapter under its stable name on the output edge", () => {
  const seen = [];
  register({ register: (edge, name) => seen.push([edge, name]) });
  assert.deepEqual(seen, [["output", "react"]]);
  assert.equal(ADAPTER_NAME, "react");
});
