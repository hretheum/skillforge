// The engine's adapter-KINDS catalog — which `kind`s each adapter speaks.
//
// Sources: docs/04-adapters.md §"Skill↔adapter typing" and docs/04a-normalized-form.md
// (the envelope `kind` tag). The design is original to this project. Zero files from any
// third-party skills-factory codebase (clean-room).
//
// WHY THIS EXISTS, SEPARATE FROM THE ADAPTER REGISTRY. src/loader/adapter-registry.js
// answers only "does an adapter by this name exist on this edge" — names, no kinds (it says
// so on its own line 12-14). The result-kind TYPING of the wiring (docs/04 §typing) needs a
// second fact per adapter: which source-kinds an input adapter PRODUCES and which
// result-kinds an output adapter ACCEPTS. This module records exactly that, and it derives
// the facts from the adapters' OWN exported constants (SOURCE_KIND / RESULT_KIND) so the
// catalog can never drift from the adapters it describes — the same single-source-of-truth
// discipline registry-lint uses by importing defaultAdapterRegistry().
//
// An adapter may speak more than one kind (docs/04 §"An adapter may accept more than one
// kind"), so each edge maps an adapter name to an ARRAY of kinds. The MVP adapters speak one
// kind each; the array shape leaves room for that growth without a contract change.

import { SOURCE_KIND as DTCG_SOURCE_KIND, ADAPTER_NAME as DTCG_NAME } from "../adapters/input/dtcg-tokens.js";
import { SOURCE_KIND as FLAT_SOURCE_KIND, ADAPTER_NAME as FLAT_NAME } from "../adapters/input/flat-tokens.js";
import { RESULT_KIND as REACT_RESULT_KIND, ADAPTER_NAME as REACT_NAME } from "../adapters/output/react.js";
import { RESULT_KIND as WEB_COMPONENTS_RESULT_KIND, ADAPTER_NAME as WEB_COMPONENTS_NAME } from "../adapters/output/web-components.js";

import { EDGES } from "../loader/adapter-registry.js";

/**
 * Build a kinds catalog from explicit per-edge maps. Kept injectable (mirroring
 * createAdapterRegistry) so the typing primitive is testable in isolation and later adapters
 * extend it as data rather than editing a consumer.
 *
 * @param {{ input?: Record<string,string[]>, output?: Record<string,string[]> }} [seed]
 * @returns {{
 *   produces: (name: string) => string[],   // source-kinds an INPUT adapter produces
 *   accepts:  (name: string) => string[],    // result-kinds an OUTPUT adapter accepts
 *   has: (edge: string, name: string) => boolean,
 * }}
 */
export function createAdapterKinds(seed = {}) {
  const input = new Map(Object.entries(seed.input ?? {}));
  const output = new Map(Object.entries(seed.output ?? {}));

  return {
    produces(name) {
      return [...(input.get(name) ?? [])];
    },
    accepts(name) {
      return [...(output.get(name) ?? [])];
    },
    has(edge, name) {
      if (edge === EDGES.INPUT) return input.has(name);
      if (edge === EDGES.OUTPUT) return output.has(name);
      throw new Error(`unknown adapter edge "${edge}" (expected "input" or "output")`);
    },
  };
}

/**
 * The default kinds catalog for the MVP, derived from the adapters' own exported `kind`
 * constants — the single source of truth. Adding an adapter means importing its constants
 * here, exactly as registering its name happens against the adapter registry.
 */
export function defaultAdapterKinds() {
  return createAdapterKinds({
    input: {
      [DTCG_NAME]: [DTCG_SOURCE_KIND],
      // Second input adapter, SAME source-kind as dtcg-tokens (the input-edge mirror's pair).
      [FLAT_NAME]: [FLAT_SOURCE_KIND],
    },
    output: {
      [REACT_NAME]: [REACT_RESULT_KIND],
      // Second output adapter, SAME result-kind as react (the genericity proof's pair).
      [WEB_COMPONENTS_NAME]: [WEB_COMPONENTS_RESULT_KIND],
    },
  });
}
