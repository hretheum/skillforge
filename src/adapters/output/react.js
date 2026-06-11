// Output adapter `react` — renders a normalized `frontend-component` result into a thin
// React wrapper that emits the design system's canonical CSS classes.
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room). Realizes docs/04-adapters.md §"The output adapter contract" +
// "the fidelity rule", consuming the output-edge normalized form (tagged-union result,
// result-kind `frontend-component`) of docs/04a.
//
// The fidelity rule (docs/04 §fidelity): for a design system's component output the artifact is
// a THIN React wrapper emitting the canonical classes, with the brand-craft staying in the
// source CSS ("code as the source of truth"). So this adapter:
//   - RENDERS what the result decided; it makes no decisions of its own (docs/04 §"it does
//     not change the content of the result, only its form").
//   - DOES NOT reach back to the source (docs/04 §"it does not reach back to the source") —
//     it works solely on the normalized result. The result already carries EXPLICIT
//     references to the source CSS classes it binds to, so the adapter never re-reads the
//     design system to learn them (this closes API-05: fidelity without a source re-read).
//
// The `frontend-component` payload it accepts (the result-kind's shape):
//   {
//     componentName: "Button",            // PascalCase React component name
//     element:       "button",            // the host HTML element
//     baseClass:     "hbtn",              // the canonical base CSS class (from source)
//     variants: [                          // optional: prop-driven class additions
//       { prop: "variant", value: "acc", class: "hbtn--acc" },
//       { prop: "size",    value: "s",   class: "hbtn--sm"  }
//     ],
//     decorations: [                       // optional: fixed inner markup (e.g. craft hooks)
//       { element: "span", class: "sq", ariaHidden: true }
//     ],
//     sourceClasses: ["hbtn", "hbtn--acc", "hbtn--sm", "sq"]  // EXPLICIT source-class refs
//   }
//
// Output determinism: the emitted file text is a pure function of the result payload — no
// timestamps, no run IDs (per docs/04 §determinism + docs/04a byte-stability). The same
// result yields byte-identical source every run, which the fidelity check pins via a golden.

import { makeResult, validateNormalized } from "../../core/index.js";

/** The result-kind this adapter accepts (docs/04 §"Skill↔adapter typing"). */
export const RESULT_KIND = "frontend-component";

/** The stable registry name (docs/04 §"Registering and selecting an adapter"). */
export const ADAPTER_NAME = "react";

const PASCAL_RE = /^[A-Z][A-Za-z0-9]*$/;
const HTML_NAME_RE = /^[a-z][a-z0-9-]*$/;

function assert(cond, msg) {
  if (!cond) throw new TypeError(msg);
}

/**
 * Build a normalized `frontend-component` result. A skill's core would call this; exposed so
 * tests and the genericity proof can construct a result without inventing the shape.
 *
 * @param {object} spec  the component spec (see the payload shape above).
 * @param {string} [identity]  the artifact's intended name handle (NOT the client name).
 * @returns {{edge: string, envelope: object, payload: object}} a normalized result.
 */
export function makeComponentResult(spec, identity) {
  validateComponentSpec(spec);
  return makeResult({
    kind: RESULT_KIND,
    identity: identity ?? spec.componentName,
    payload: spec,
  });
}

/**
 * Validate a `frontend-component` payload's shape (the adapter renders only a well-formed
 * result — "validate before acting").
 */
export function validateComponentSpec(spec) {
  assert(spec && typeof spec === "object" && !Array.isArray(spec), "component spec must be an object");
  assert(PASCAL_RE.test(spec.componentName ?? ""), `componentName must be PascalCase, got ${JSON.stringify(spec.componentName)}`);
  assert(HTML_NAME_RE.test(spec.element ?? ""), `element must be an HTML tag name, got ${JSON.stringify(spec.element)}`);
  assert(typeof spec.baseClass === "string" && spec.baseClass.length > 0, "baseClass must be a non-empty string");
  assert(Array.isArray(spec.sourceClasses) && spec.sourceClasses.length > 0,
    "sourceClasses must be a non-empty array (explicit references to the source CSS classes — the fidelity rule)");

  const variants = spec.variants ?? [];
  assert(Array.isArray(variants), "variants must be an array");
  for (const v of variants) {
    assert(v && typeof v === "object", "each variant must be an object");
    assert(typeof v.prop === "string" && v.prop.length > 0, "variant.prop must be a non-empty string");
    assert(typeof v.value === "string" && v.value.length > 0, "variant.value must be a non-empty string");
    assert(typeof v.class === "string" && v.class.length > 0, "variant.class must be a non-empty string");
  }

  // Fidelity guard: every class the wrapper can emit must be declared in sourceClasses, so
  // the adapter never invents a class the design system did not author (no source re-read,
  // no adapter-originated decision).
  const declared = new Set(spec.sourceClasses);
  assert(declared.has(spec.baseClass), `baseClass "${spec.baseClass}" is not declared in sourceClasses`);
  for (const v of variants) {
    assert(declared.has(v.class), `variant class "${v.class}" is not declared in sourceClasses`);
  }

  const decorations = spec.decorations ?? [];
  assert(Array.isArray(decorations), "decorations must be an array");
  for (const d of decorations) {
    assert(d && typeof d === "object", "each decoration must be an object");
    assert(HTML_NAME_RE.test(d.element ?? ""), "decoration.element must be an HTML tag name");
    assert(typeof d.class === "string" && d.class.length > 0, "decoration.class must be a non-empty string");
    assert(declared.has(d.class), `decoration class "${d.class}" is not declared in sourceClasses`);
  }
}

/**
 * Render the normalized result into a concrete React component artifact.
 *
 * @param {{edge: string, envelope: object, payload: object}} result  a normalized result.
 * @returns {{filename: string, language: string, source: string, sourceClasses: string[]}}
 *   the artifact: a filename, the React source text, and the explicit source-class
 *   references it binds (carried through from the result for downstream verification).
 */
export function renderReact(result) {
  validateNormalized(result);
  assert(result.edge === "output", "react adapter renders an output-edge result");
  assert(result.envelope.kind === RESULT_KIND,
    `react adapter only accepts result-kind "${RESULT_KIND}", got "${result.envelope.kind}"`);

  const spec = result.payload;
  validateComponentSpec(spec);

  const source = renderSource(spec);
  return {
    filename: `${spec.componentName}.tsx`,
    language: "tsx",
    source,
    // Carry the explicit source-class references through to the artifact — the fidelity
    // evidence (which canonical classes this wrapper binds), with no source re-read.
    sourceClasses: [...spec.sourceClasses],
  };
}

/**
 * Render the React source text. Pure function of the spec → byte-deterministic.
 */
function renderSource(spec) {
  const { componentName, element, baseClass, variants = [], decorations = [] } = spec;

  // Stable prop order: by prop name, then value, so the emitted props/types never reorder.
  const sortedVariants = [...variants].sort((a, b) =>
    a.prop !== b.prop ? cmp(a.prop, b.prop) : cmp(a.value, b.value),
  );

  // Group variant values by prop to build a union type + a default per prop.
  const propMap = new Map();
  for (const v of sortedVariants) {
    if (!propMap.has(v.prop)) propMap.set(v.prop, []);
    propMap.get(v.prop).push(v);
  }
  const props = [...propMap.keys()];

  const lines = [];
  lines.push(`// ${componentName} — generated React wrapper for the design system.`);
  lines.push(`// Thin wrapper: it emits the canonical CSS classes; the craft stays in the`);
  lines.push(`// source stylesheet (code-as-source-of-truth). Requires the DS stylesheet at runtime.`);
  lines.push(`// Bound source classes: ${[...spec.sourceClasses].join(", ")}.`);
  lines.push("");
  lines.push(`import { forwardRef, type ComponentPropsWithoutRef } from "react";`);
  lines.push("");

  // Per-prop union types.
  for (const prop of props) {
    const values = propMap.get(prop).map((v) => `"${v.value}"`);
    lines.push(`export type ${pascal(componentName)}${pascal(prop)} = ${values.join(" | ")};`);
  }
  if (props.length > 0) lines.push("");

  lines.push(`export interface ${componentName}Props extends ComponentPropsWithoutRef<"${element}"> {`);
  for (const prop of props) {
    lines.push(`  ${prop}?: ${pascal(componentName)}${pascal(prop)};`);
  }
  lines.push(`}`);
  lines.push("");

  // Destructure props in stable order.
  const destructured = [...props, "className", "children", "...rest"].join(", ");
  lines.push(`export const ${componentName} = forwardRef<HTMLElement, ${componentName}Props>(function ${componentName}(`);
  lines.push(`  { ${destructured} },`);
  lines.push(`  ref,`);
  lines.push(`) {`);

  // Class list: base + one conditional per variant value, in stable order.
  lines.push(`  const cls = [`);
  lines.push(`    "${baseClass}",`);
  for (const v of sortedVariants) {
    lines.push(`    ${v.prop} === "${v.value}" && "${v.class}",`);
  }
  lines.push(`    className,`);
  lines.push(`  ]`);
  lines.push(`    .filter(Boolean)`);
  lines.push(`    .join(" ");`);
  lines.push("");

  // Render the host element with decorations (fixed inner markup) then children.
  lines.push(`  return (`);
  lines.push(`    <${element} ref={ref as never} className={cls} {...rest}>`);
  for (const d of decorations) {
    const aria = d.ariaHidden ? ` aria-hidden="true"` : "";
    lines.push(`      <${d.element} className="${d.class}"${aria} />`);
  }
  lines.push(`      {children}`);
  lines.push(`    </${element}>`);
  lines.push(`  );`);
  lines.push(`});`);
  lines.push("");
  lines.push(`${componentName}.displayName = "${componentName}";`);
  lines.push("");
  lines.push(`export default ${componentName};`);
  lines.push("");

  return lines.join("\n");
}

function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function pascal(s) {
  return s.replace(/(^|[-_])([a-z0-9])/g, (_, __, ch) => ch.toUpperCase());
}

/**
 * Register this adapter under its stable name on the output edge.
 * @param {{register: (edge: string, name: string) => void}} registry
 */
export function register(registry) {
  registry.register("output", ADAPTER_NAME);
}
