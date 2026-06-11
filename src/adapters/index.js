// The adapter-dispatch registry — resolves an adapter NAME to its actual implementation.
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room). Realizes docs/04-adapters.md §"Registering and selecting an
// adapter" (the engine's "driver catalog") at the level of CALLABLES.
//
// Two registries sit side by side, by design:
//   - src/loader/adapter-registry.js answers "does an adapter by this NAME exist on this
//     edge?" (name-existence + the result-kind/source-kind TYPING gate). It is what the
//     loader validates the config's adapter selection against (validate-before-acting).
//   - THIS file answers the next question the run path asks: "given that name, WHICH
//     functions do I call?" — it maps the name to the concrete adapter module's callables.
//
// Keeping the two separate keeps responsibilities clean: the loader validates wiring as
// DATA without importing any adapter implementation, while the run path resolves a name to
// code through this map. The map is the single place the engine's known adapter
// implementations are enumerated; adding an adapter is a deliberate code touch HERE (the
// same shape docs/04 step 3 describes: "register the adapter under a stable name"), not a
// hidden import scattered across the run path.
//
// Generic by construction: this file names NO client. It binds adapter NAMES (format kinds:
// "dtcg-tokens", "react") to functions; client knowledge lives in configs/fixtures, never
// here. The dispatch is the same for every client — only the config's selected names differ.

import {
  ADAPTER_NAME as DTCG_NAME,
  SOURCE_KIND as DTCG_SOURCE_KIND,
  readDesignSystem,
} from "./input/dtcg-tokens.js";
import {
  ADAPTER_NAME as FLAT_NAME,
  SOURCE_KIND as FLAT_SOURCE_KIND,
  readDesignSystem as readFlatDesignSystem,
} from "./input/flat-tokens.js";
import {
  ADAPTER_NAME as REACT_NAME,
  RESULT_KIND as REACT_RESULT_KIND,
  makeComponentResult,
  renderReact,
} from "./output/react.js";
import {
  ADAPTER_NAME as WEB_COMPONENTS_NAME,
  RESULT_KIND as WEB_COMPONENTS_RESULT_KIND,
  makeComponentResult as makeWebComponentResult,
  renderWebComponent,
} from "./output/web-components.js";

/** The two adapter edges (kept in step with src/loader/adapter-registry.js EDGES). */
export const EDGES = Object.freeze({ INPUT: "input", OUTPUT: "output" });

// The adapter-local file-transport cache (upload-once, reference-many), keyed by the source
// content-hash (T-HARD-07 / docs/04 §file transport). Re-exported so a file-bearing adapter and
// the run path can reuse the one implementation rather than each rolling its own keying.
export { createUploadCache } from "./file-transport.js";

// --- input edge: name -> { kind, read } --------------------------------------------------
//
// `read({ references, identity?, readFile? })` -> a normalized DESCRIPTION (input edge).
// `kind` is the source-kind this adapter produces — carried here so the run path can pair it
// with the loader's typing without re-importing the module.
const INPUT_ADAPTERS = Object.freeze({
  [DTCG_NAME]: Object.freeze({ kind: DTCG_SOURCE_KIND, read: readDesignSystem }),
  // The SECOND input adapter for one source-kind (genericity proof, INPUT mirror — T-P2-04): it
  // produces the SAME `design-system` source-kind as `dtcg-tokens`, reading a different on-disk
  // FORM (a flat token list). Two adapters reading equivalent sources assemble the same
  // normalized description — the input-edge mirror of the output-edge proof. Registered HERE
  // (docs/04 step 3), with no change to the core.
  [FLAT_NAME]: Object.freeze({ kind: FLAT_SOURCE_KIND, read: readFlatDesignSystem }),
});

// --- output edge: name -> { kind, makeResult, render } -----------------------------------
//
// `makeResult(spec, identity?)` -> a normalized RESULT (output edge); `render(result)` -> a
// concrete artifact. `kind` is the result-kind this adapter accepts.
const OUTPUT_ADAPTERS = Object.freeze({
  [REACT_NAME]: Object.freeze({
    kind: REACT_RESULT_KIND,
    makeResult: makeComponentResult,
    render: renderReact,
  }),
  // The SECOND output adapter for one result-kind (genericity proof, Gate 2): it accepts the
  // SAME `frontend-component` result as `react` and renders a different FORM (a vanilla custom
  // element). Adding it is a deliberate code touch HERE (docs/04 step 3) — and NOWHERE in the
  // core; that non-change to the engine is what the proof asserts.
  [WEB_COMPONENTS_NAME]: Object.freeze({
    kind: WEB_COMPONENTS_RESULT_KIND,
    makeResult: makeWebComponentResult,
    render: renderWebComponent,
  }),
});

function assertEdge(edge) {
  if (edge !== EDGES.INPUT && edge !== EDGES.OUTPUT) {
    throw new Error(`unknown adapter edge "${edge}" (expected "input" or "output")`);
  }
}

/**
 * Resolve an input-adapter name to its implementation.
 *
 * @param {string} name  the adapter name from the client config (ctx.adapters.input).
 * @returns {{ kind: string, read: Function }} the input adapter's callables.
 * @throws {Error} loud and early if the name is unknown (validate-before-acting).
 */
export function getInputAdapter(name) {
  const impl = INPUT_ADAPTERS[name];
  if (!impl) {
    throw new Error(
      `no input adapter implementation registered under "${name}" (known: ${inputAdapterNames().join(", ") || "none"})`,
    );
  }
  return impl;
}

/**
 * Resolve an output-adapter name to its implementation.
 *
 * @param {string} name  the adapter name from the client config (ctx.adapters.output).
 * @returns {{ kind: string, makeResult: Function, render: Function }} the output adapter's callables.
 * @throws {Error} loud and early if the name is unknown.
 */
export function getOutputAdapter(name) {
  const impl = OUTPUT_ADAPTERS[name];
  if (!impl) {
    throw new Error(
      `no output adapter implementation registered under "${name}" (known: ${outputAdapterNames().join(", ") || "none"})`,
    );
  }
  return impl;
}

/**
 * Resolve an adapter by edge + name. Convenience for callers that carry the edge as data.
 * @param {("input"|"output")} edge
 * @param {string} name
 */
export function getAdapter(edge, name) {
  assertEdge(edge);
  return edge === EDGES.INPUT ? getInputAdapter(name) : getOutputAdapter(name);
}

/** Whether an implementation is registered under this edge + name. */
export function hasAdapter(edge, name) {
  assertEdge(edge);
  const table = edge === EDGES.INPUT ? INPUT_ADAPTERS : OUTPUT_ADAPTERS;
  return Object.prototype.hasOwnProperty.call(table, name);
}

/** The registered input-adapter names, sorted (stable order). */
export function inputAdapterNames() {
  return Object.keys(INPUT_ADAPTERS).sort();
}

/** The registered output-adapter names, sorted (stable order). */
export function outputAdapterNames() {
  return Object.keys(OUTPUT_ADAPTERS).sort();
}
