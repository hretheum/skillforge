// Input adapter `flat-tokens` — a FLAT design-token reader (the input-edge genericity mirror).
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room). Realizes docs/04-adapters.md §"How to add a new adapter" step 6
// (the mirror: "the same skill fed by two different input adapters reading EQUIVALENT sources
// should assemble the SAME result") + §"The input adapter contract" + "the determinism rule".
//
// WHY IT EXISTS. The output edge proves genericity with two adapters (react, web-components)
// rendering ONE result into two FORMS (T-P2-02/03). This is the INPUT-edge mirror (T-P2-04): a
// SECOND input adapter that reads a DIFFERENT on-disk REPRESENTATION of the same design system
// and normalizes it to the BYTE-IDENTICAL `design-system` description the DTCG adapter produces.
// If `flat-tokens` reading an equivalent flat file and `dtcg-tokens` reading the nested DTCG
// file assemble the same normalized description (the equivalence relation, src/core/equivalence
// .js), then the input edge adds FORM, not CONTENT — the core is generic with respect to the
// source FORMAT, exactly as the output edge is generic with respect to the artifact KIND.
//
// THE FLAT FORMAT IT READS. A deliberately different shape from DTCG's nested tree: a single
// JSON ARRAY of flat entries, each addressing a token by its already-dotted `name` —
//   [
//     { "name": "color.primitive.red", "type": "color", "value": "#e5232b" },
//     { "name": "color.semantic.accent", "type": "color", "ref": "color.primitive.red" }
//   ]
// An entry with a `value` is a LITERAL token; an entry with a `ref` (a dotted target) is an
// ALIAS (a role binding). `type` is carried verbatim (no DTCG-style inheritance — the flat
// format states each entry's type explicitly, or omits it → null). This is a genuinely
// different representation (flat list vs nested groups, explicit `ref` vs `{dotted}` string,
// explicit per-entry type vs inherited `$type`) that maps onto the SAME normalized payload.
//
// SAME NORMALIZED OUTPUT AS dtcg-tokens. It produces the identical { tokens, roles } payload:
//   - `tokens` — every literal entry as { name, type, value }, sorted by name.
//   - `roles`  — every ref entry as { name, type, alias }, sorted by name.
// Both arrays sorted by name → order-stable regardless of the source array's order (the
// determinism precondition the gate checks). Client specifics live in the flat file, never here.
//
// Generic by construction: this file names NO client. It is a reader for the FLAT format —
// it serves any client who keeps tokens flat, it does not know the client by name (docs/04).

import { readFileSync } from "node:fs";

import { makeDescription } from "../../core/index.js";

/** The source-kind this adapter produces — IDENTICAL to dtcg-tokens (the mirror's whole point). */
export const SOURCE_KIND = "design-system";

/** The stable registry name (docs/04 §"Registering and selecting an adapter"). */
export const ADAPTER_NAME = "flat-tokens";

/** Which reference key in the client config addresses the flat token file. */
const TOKEN_HUB_REF = "tokenHub";

/**
 * Parse a flat token document (an array of entries) into the deterministic { tokens, roles }
 * payload — the SAME shape dtcg-tokens emits, so the two are comparable under the equivalence
 * relation.
 *
 * @param {Array<{name: string, type?: string, value?: unknown, ref?: string}>} flat
 * @returns {{tokens: object[], roles: object[]}}
 */
export function flatToPayload(flat) {
  if (!Array.isArray(flat)) {
    throw new TypeError("flat token document must be a JSON array of entries");
  }
  const acc = { tokens: [], roles: [] };

  for (const entry of flat) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new TypeError("each flat token entry must be an object");
    }
    if (typeof entry.name !== "string" || entry.name.length === 0) {
      throw new TypeError("each flat token entry must carry a non-empty dotted `name`");
    }
    const type = typeof entry.type === "string" ? entry.type : null;

    const hasRef = typeof entry.ref === "string" && entry.ref.length > 0;
    const hasValue = "value" in entry && entry.value !== undefined;
    // An entry is EITHER a literal (value) or an alias (ref) — never both, never neither.
    if (hasRef && hasValue) {
      throw new TypeError(`flat token "${entry.name}" has both value and ref (an entry is one or the other)`);
    }
    if (!hasRef && !hasValue) {
      throw new TypeError(`flat token "${entry.name}" has neither value nor ref`);
    }

    if (hasRef) {
      acc.roles.push({ name: entry.name, type, alias: entry.ref });
    } else {
      acc.tokens.push({ name: entry.name, type, value: entry.value });
    }
  }

  // Impose the same stable array order as dtcg-tokens: sort by name. Names are unique dotted
  // paths, so the sort is total and the result is order-stable regardless of source order.
  acc.tokens.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  acc.roles.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return acc;
}

/**
 * Read a client's flat token source and return the normalized description. Mirror of
 * dtcg-tokens.readDesignSystem: same args, same return contract, same source-kind.
 *
 * @param {object} args
 * @param {Record<string, {ref: string, resolvedPath: string|null, local: boolean}>} args.references
 * @param {string} [args.identity]
 * @param {(path: string) => string} [args.readFile]
 * @returns {{edge: string, envelope: object, payload: object}} a normalized description.
 */
export function readDesignSystem({ references, identity, readFile = defaultReadFile } = {}) {
  if (!references || typeof references !== "object") {
    throw new TypeError("flat-tokens adapter requires the loader's resolved `references`");
  }
  const hub = references[TOKEN_HUB_REF];
  if (!hub || typeof hub.ref !== "string") {
    throw new TypeError(
      `flat-tokens adapter needs a "${TOKEN_HUB_REF}" reference addressing the flat token file`,
    );
  }
  if (!hub.local || typeof hub.resolvedPath !== "string") {
    throw new TypeError(
      `flat-tokens adapter can only read a local-path "${TOKEN_HUB_REF}" at MVP; got "${hub.ref}"`,
    );
  }

  const text = readFile(hub.resolvedPath);
  let flat;
  try {
    flat = JSON.parse(text);
  } catch (cause) {
    // A malformed source is a PERMANENT runtime failure (docs/04 §runtime-failure); flag it so
    // the failure contract classifies it intentionally. The message names the reference, never
    // the file's raw contents.
    const err = new TypeError(`flat token file at "${hub.ref}" is not valid JSON: ${cause.message}`);
    err.isMalformed = true;
    throw err;
  }

  const payload = flatToPayload(flat);
  return makeDescription({
    kind: SOURCE_KIND,
    identity: identity ?? hub.ref,
    payload,
  });
}

function defaultReadFile(path) {
  return readFileSync(path, "utf8");
}

/**
 * Register this adapter under its stable name on the input edge.
 * @param {{register: (edge: string, name: string) => void}} registry
 */
export function register(registry) {
  registry.register("input", ADAPTER_NAME);
}
