// Output adapter `web-components` — renders a normalized `frontend-component` result into a
// vanilla, zero-dependency custom element that emits the design system's canonical CSS classes.
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room). Realizes docs/04-adapters.md §"The output adapter contract" +
// "the fidelity rule", consuming the SAME output-edge normalized form as the `react` adapter
// (tagged-union result, result-kind `frontend-component`) of docs/04a.
//
// WHY THIS ADAPTER EXISTS. It is the SECOND output form for the genericity proof (Gate 2,
// docs/07 §"Gate 2"; docs/04 §"how to add a new adapter" step 6): the SAME create-component
// skill, the SAME normalized result, rendered through TWO different output adapters → two
// artifact FORMS of one intent. A React `.tsx` wrapper and a vanilla custom element are
// different forms of the same decision the core made once. Producing this second form is a
// new adapter PLUG + a config selection — ZERO change to the engine core. That non-change is
// exactly what the proof asserts.
//
// SAME CONTRACT AS `react`. This adapter accepts the SAME result-kind (`frontend-component`)
// so the same skill renders both, and it obeys the SAME fidelity rule (docs/04 §fidelity):
//   - RENDERS what the result decided; it makes no decisions of its own (docs/04 §"it does not
//     change the content of the result, only its form").
//   - DOES NOT reach back to the source — it works solely on the normalized result, which
//     already carries EXPLICIT references to the source CSS classes it binds (sourceClasses),
//     so the adapter never re-reads the design system (closes API-05 the same way `react` does).
//   - Craft stays in the SOURCE CSS ("code as the source of truth"); the custom element is a
//     thin shell that composes the canonical class string onto its host, nothing more.
//
// The `frontend-component` payload it accepts (identical to the react adapter's — one
// result-kind, one shape; the two adapters differ only in the form they render):
//   {
//     componentName: "Button",            // PascalCase logical name (→ kebab custom-element tag)
//     element:       "button",            // the host HTML element the shell wraps
//     baseClass:     "hbtn",              // the canonical base CSS class (from source)
//     variants: [                          // optional: attribute-driven class additions
//       { prop: "variant", value: "acc", class: "hbtn--acc" }
//     ],
//     decorations: [                       // optional: fixed inner markup (craft hooks)
//       { element: "span", class: "sq", ariaHidden: true }
//     ],
//     sourceClasses: ["hbtn", "hbtn--acc", "sq"] // EXPLICIT source-class refs (fidelity)
//   }
//
// Output determinism: the emitted file text is a pure function of the result payload — no
// timestamps, no run IDs (docs/04 §determinism + docs/04a byte-stability). Same result →
// byte-identical source every run, pinned by a checked-in golden.

import { makeResult, validateNormalized } from "../../core/index.js";
import { validateComponentSpec } from "./react.js";

/** The result-kind this adapter accepts — the SAME as `react` (docs/04 §"Skill↔adapter typing"). */
export const RESULT_KIND = "frontend-component";

/** The stable registry name (docs/04 §"Registering and selecting an adapter"). */
export const ADAPTER_NAME = "web-components";

function assert(cond, msg) {
  if (!cond) throw new TypeError(msg);
}

/**
 * Build a normalized `frontend-component` result. Identical contract to the react adapter's
 * makeComponentResult — one result-kind, one shape — so the genericity proof can hand the SAME
 * result to both adapters. Exposed so tests/the proof construct a result without inventing the
 * shape.
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
 * Render the normalized result into a concrete custom-element artifact.
 *
 * @param {{edge: string, envelope: object, payload: object}} result  a normalized result.
 * @returns {{filename: string, language: string, source: string, sourceClasses: string[], tagName: string}}
 *   the artifact: a filename, the JS source text, the custom-element tag name, and the
 *   explicit source-class references it binds (carried through for downstream verification).
 */
export function renderWebComponent(result) {
  validateNormalized(result);
  assert(result.edge === "output", "web-components adapter renders an output-edge result");
  assert(result.envelope.kind === RESULT_KIND,
    `web-components adapter only accepts result-kind "${RESULT_KIND}", got "${result.envelope.kind}"`);

  const spec = result.payload;
  // Reuse the react adapter's shape validation — there is ONE frontend-component contract, and
  // both adapters render it; duplicating the validator would let the two definitions drift.
  validateComponentSpec(spec);

  const tagName = kebab(spec.componentName);
  const source = renderSource(spec, tagName);
  return {
    filename: `${tagName}.js`,
    language: "js",
    source,
    tagName,
    // Carry the explicit source-class references through — the fidelity evidence (which
    // canonical classes this element binds), with no source re-read.
    sourceClasses: [...spec.sourceClasses],
  };
}

/**
 * Render the custom-element source text. Pure function of the spec → byte-deterministic.
 *
 * The element observes one attribute per variant prop; on attribute change it recomposes the
 * canonical class string onto its host (base + each matching variant class), preserving any
 * caller-supplied classes. Decorations are fixed inner markup mirrored from the result.
 */
function renderSource(spec, tagName) {
  const { componentName, element, baseClass, variants = [], decorations = [] } = spec;

  // Stable order: by prop name, then value, so emitted attributes/branches never reorder
  // (the same canonicalizing discipline the react adapter applies).
  const sortedVariants = [...variants].sort((a, b) =>
    a.prop !== b.prop ? cmp(a.prop, b.prop) : cmp(a.value, b.value),
  );

  // The distinct variant prop names become observed attributes, in stable order.
  const observed = [];
  for (const v of sortedVariants) {
    if (!observed.includes(v.prop)) observed.push(v.prop);
  }

  const className = `${componentName}Element`;

  const lines = [];
  lines.push(`// ${componentName} — generated Web Component (custom element) for the design system.`);
  lines.push(`// Thin shell: it composes the canonical CSS classes onto its host; the craft stays in`);
  lines.push(`// the source stylesheet (code-as-source-of-truth). Requires the DS stylesheet at runtime.`);
  lines.push(`// Bound source classes: ${[...spec.sourceClasses].join(", ")}.`);
  lines.push("");
  lines.push(`export class ${className} extends HTMLElement {`);

  // Observed attributes (one per variant prop) — stable JSON array literal.
  lines.push(`  static get observedAttributes() {`);
  lines.push(`    return [${observed.map((p) => `"${p}"`).join(", ")}];`);
  lines.push(`  }`);
  lines.push("");

  lines.push(`  connectedCallback() {`);
  lines.push(`    this._render();`);
  lines.push(`  }`);
  lines.push("");
  lines.push(`  attributeChangedCallback() {`);
  lines.push(`    this._render();`);
  lines.push(`  }`);
  lines.push("");

  lines.push(`  _render() {`);
  // Build the class list: base + one branch per variant value, in stable order.
  lines.push(`    const cls = [`);
  lines.push(`      "${baseClass}",`);
  for (const v of sortedVariants) {
    lines.push(`      this.getAttribute("${v.prop}") === "${v.value}" && "${v.class}",`);
  }
  lines.push(`    ].filter(Boolean);`);
  lines.push("");
  lines.push(`    const host = this.querySelector("${element}") ?? this._mount();`);
  lines.push(`    host.className = cls.join(" ");`);
  lines.push(`  }`);
  lines.push("");

  // Mount the host element once, with fixed decorations, then a slot for projected children.
  lines.push(`  _mount() {`);
  lines.push(`    const host = document.createElement("${element}");`);
  for (const d of decorations) {
    lines.push(`    const ${decoVar(d)} = document.createElement("${d.element}");`);
    lines.push(`    ${decoVar(d)}.className = "${d.class}";`);
    if (d.ariaHidden) lines.push(`    ${decoVar(d)}.setAttribute("aria-hidden", "true");`);
    lines.push(`    host.appendChild(${decoVar(d)});`);
  }
  lines.push(`    host.appendChild(document.createElement("slot"));`);
  lines.push(`    this.appendChild(host);`);
  lines.push(`    return host;`);
  lines.push(`  }`);
  lines.push(`}`);
  lines.push("");
  lines.push(`if (!customElements.get("${tagName}")) {`);
  lines.push(`  customElements.define("${tagName}", ${className});`);
  lines.push(`}`);
  lines.push("");

  return lines.join("\n");
}

function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function kebab(s) {
  // PascalCase → kebab-case, and prefix-join so the tag always has a hyphen (custom elements
  // require one). "Button" → "x-button"; "FormField" → "x-form-field".
  const body = s
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
  return `x-${body}`;
}

function decoVar(d) {
  // A stable local variable name per decoration, derived from its class (deterministic).
  return `deco_${d.class.replace(/[^a-z0-9]+/gi, "_")}`;
}

/**
 * Register this adapter under its stable name on the output edge.
 * @param {{register: (edge: string, name: string) => void}} registry
 */
export function register(registry) {
  registry.register("output", ADAPTER_NAME);
}
