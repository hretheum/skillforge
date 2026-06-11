// Input adapter `dtcg-tokens` — a DTCG (W3C Design Tokens) reader.
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room). Realizes docs/04-adapters.md §"The input adapter contract" +
// "the determinism rule", producing the input-edge normalized form of docs/04a.
//
// What it is: a GENERIC reader for the DTCG format — it serves any client who keeps tokens
// in DTCG, it does not know the client by name (docs/04 §"it does not know the client by
// name"). It turns references to a DTCG token file into a byte-deterministic normalized
// DESCRIPTION whose source-kind is `design-system`. Client specifics (which file, which
// values) live in the config/fixture, never in this code.
//
// The DTCG shape it reads (per the W3C spec):
//   - a token GROUP is a plain object; a token is an object with a `$value`.
//   - `$type` is inherited down the tree from the nearest ancestor that declares one.
//   - a value of the form "{dotted.path}" is an ALIAS to another token (a role binding).
//   - `$description` / `$extensions` are metadata; `$extensions` notably carries
//     run-irrelevant, sometimes volatile annotations, so they are NOT carried into the
//     normalized payload (they would threaten byte-determinism and add no binding fact).
//
// The normalized `design-system` payload it emits has two parts:
//   - `tokens`  — every literal-valued leaf as { name, type, value }, sorted by name.
//   - `roles`   — every alias leaf as { name, type, alias } (the dotted target, unwrapped),
//                 sorted by name. Roles are the binding structure the output edge consumes.
// Both arrays are sorted by `name` so the description is order-stable regardless of the
// source file's key order — the precondition the determinism-gate checks (the canonical
// serializer in src/core also sorts object keys, but array order is significant there, so
// the adapter must impose a stable array order itself).

import { readFileSync } from "node:fs";

import { makeDescription } from "../../core/index.js";

/** The source-kind this adapter produces. Typed so the loader can check wiring (docs/04 §typing). */
export const SOURCE_KIND = "design-system";

/** The stable registry name (docs/04 §"Registering and selecting an adapter"). */
export const ADAPTER_NAME = "dtcg-tokens";

/** Which reference key in the client config addresses the DTCG token hub. */
const TOKEN_HUB_REF = "tokenHub";

const ALIAS_RE = /^\{([^}]+)\}$/;
const DTCG_META_KEYS = new Set(["$value", "$type", "$description", "$extensions"]);

/**
 * Whether a node is a DTCG token (has a `$value`) rather than a group.
 */
function isToken(node) {
  return node !== null && typeof node === "object" && !Array.isArray(node) && "$value" in node;
}

/**
 * Whether a node is a plain object that could be a DTCG group.
 */
function isGroup(node) {
  return node !== null && typeof node === "object" && !Array.isArray(node) && !("$value" in node);
}

/**
 * If a value is a DTCG alias "{dotted.path}", return the unwrapped path; else null.
 * Only a value that is EXACTLY one alias reference is treated as an alias (a composite
 * value embedding an alias is a literal for the purpose of the binding structure).
 */
function aliasTarget(value) {
  if (typeof value !== "string") return null;
  const m = ALIAS_RE.exec(value.trim());
  return m ? m[1].trim() : null;
}

/**
 * Walk a DTCG tree, collecting leaves into `tokens` (literals) and `roles` (aliases).
 *
 * @param {object} node       the current group/token node
 * @param {string} path       the dotted name accumulated so far
 * @param {string|undefined} inheritedType  the nearest ancestor's `$type`
 * @param {{tokens: object[], roles: object[]}} acc  accumulator
 */
function walk(node, path, inheritedType, acc) {
  const type = typeof node.$type === "string" ? node.$type : inheritedType;

  if (isToken(node)) {
    const value = node.$value;
    const alias = aliasTarget(value);
    if (alias !== null) {
      acc.roles.push({ name: path, type: type ?? null, alias });
    } else {
      // Literal value. Only JSON-scalar values are carried (the binding fact); composite
      // object values (e.g. DTCG shadow/typography) are flattened to their canonical JSON
      // so they stay byte-stable through the core serializer.
      acc.tokens.push({ name: path, type: type ?? null, value });
    }
    return;
  }

  if (!isGroup(node)) return;

  for (const key of Object.keys(node)) {
    if (DTCG_META_KEYS.has(key)) continue; // group-level metadata, not a child token
    const child = node[key];
    if (child === null || typeof child !== "object" || Array.isArray(child)) continue;
    const childPath = path === "" ? key : `${path}.${key}`;
    walk(child, childPath, type, acc);
  }
}

/**
 * Parse a DTCG document into a deterministic { tokens, roles } payload.
 *
 * @param {object} dtcg  the parsed DTCG token document
 * @returns {{tokens: object[], roles: object[]}}
 */
export function dtcgToPayload(dtcg) {
  if (dtcg === null || typeof dtcg !== "object" || Array.isArray(dtcg)) {
    throw new TypeError("DTCG document must be a JSON object");
  }
  const acc = { tokens: [], roles: [] };
  // The root itself is a group; its own $type (if any) seeds inheritance.
  walk(dtcg, "", typeof dtcg.$type === "string" ? dtcg.$type : undefined, acc);

  // Impose a stable array order: sort by name. Names are unique dotted paths, so the sort
  // is total and the result is order-stable regardless of source key order.
  acc.tokens.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  acc.roles.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return acc;
}

/**
 * Read a client's DTCG token source and return the normalized description.
 *
 * @param {object} args
 * @param {Record<string, {ref: string, resolvedPath: string|null, local: boolean}>} args.references
 *        the loader's resolved references (docs/06); this adapter reads `tokenHub`.
 * @param {string} [args.identity]  the envelope identity (a stable handle for WHICH source
 *        this is — NOT the client name); defaults to the reference address.
 * @param {(path: string) => string} [args.readFile]  injectable reader (defaults to fs);
 *        keeps the adapter unit-testable and lets a caller pass pre-loaded bytes.
 * @returns {{edge: string, envelope: object, payload: object}} a normalized description.
 */
export function readDesignSystem({ references, identity, readFile = defaultReadFile } = {}) {
  if (!references || typeof references !== "object") {
    throw new TypeError("dtcg-tokens adapter requires the loader's resolved `references`");
  }
  const hub = references[TOKEN_HUB_REF];
  if (!hub || typeof hub.ref !== "string") {
    throw new TypeError(
      `dtcg-tokens adapter needs a "${TOKEN_HUB_REF}" reference addressing the DTCG token file`,
    );
  }
  if (!hub.local || typeof hub.resolvedPath !== "string") {
    // The MVP DTCG reader handles local-path token files. A non-local handle (e.g. a
    // design-tool URL) is a different transport and out of this adapter's MVP scope —
    // fail loud rather than silently read nothing (the "validate before acting" rule).
    throw new TypeError(
      `dtcg-tokens adapter can only read a local-path "${TOKEN_HUB_REF}" at MVP; got "${hub.ref}"`,
    );
  }

  const text = readFile(hub.resolvedPath);
  let dtcg;
  try {
    dtcg = JSON.parse(text);
  } catch (cause) {
    // A malformed source is a PERMANENT runtime failure (docs/04 §runtime-failure: retrying
    // cannot help). Flag it so the failure contract classifies it intentionally (not via the
    // fail-closed fallback). The message names the reference, never the file's raw contents.
    const err = new TypeError(`DTCG token file at "${hub.ref}" is not valid JSON: ${cause.message}`);
    err.isMalformed = true;
    throw err;
  }

  const payload = dtcgToPayload(dtcg);
  // Identity addresses WHICH source this is, not the client. Default to the reference
  // address (stable, content-free) so the envelope carries no client name.
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
