// The normalized form: the one data shape the engine's core speaks.
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room). See docs/04a-normalized-form.md.
//
// Two payloads ride on one shared envelope:
//   - input edge  -> a normalized DESCRIPTION (one payload shape per source-kind)
//   - output edge -> a normalized RESULT       (a TAGGED UNION over the envelope,
//                                                keyed by result-kind)
//
// The envelope is IDENTICAL in both directions (kind, identity, content-hash,
// schema-version). That symmetry is what lets a single determinism/equivalence
// harness work on both edges. The core reasons about the envelope only; the
// payload is understood by the relevant adapter and skill, never by the core.

import { canonicalize } from "./canonical.js";
import { contentHash, isContentHash } from "./content-hash.js";

/**
 * The version of THIS normalized-form contract. Bumped by the rules in
 * docs/04a-normalized-form.md ("Versioning the contract"): additive = minor,
 * field/envelope/serialization change = major.
 */
export const SCHEMA_VERSION = 1;

/**
 * Which edge a normalized value belongs to. The envelope is the same on both;
 * the edge selects which payload shape and which set of kinds apply, and lets
 * the core treat a description and a result as two instances of one family.
 */
export const EDGE = Object.freeze({ INPUT: "input", OUTPUT: "output" });

const KIND_RE = /^[a-z][a-z0-9-]*$/;

function assert(condition, message) {
  if (!condition) throw new TypeError(message);
}

function isPlainObject(v) {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * Validate the part of a value the core actually reasons about: the four
 * kind-agnostic envelope fields. Throws with a precise message on the first
 * violation ("validate before acting").
 */
function validateEnvelopeFields({ kind, identity, contentHash: hash, schemaVersion }) {
  assert(typeof kind === "string" && KIND_RE.test(kind),
    `envelope.kind must be a lowercase-kebab name, got ${JSON.stringify(kind)}`);
  assert(typeof identity === "string" && identity.length > 0,
    `envelope.identity must be a non-empty string, got ${JSON.stringify(identity)}`);
  assert(isContentHash(hash),
    `envelope.contentHash must be a sha256 content-hash, got ${JSON.stringify(hash)}`);
  assert(Number.isInteger(schemaVersion) && schemaVersion >= 1,
    `envelope.schemaVersion must be an integer >= 1, got ${JSON.stringify(schemaVersion)}`);
}

/**
 * Build a normalized value (envelope + payload) for one edge.
 *
 * The content-hash is COMPUTED from the canonical serialization of the payload,
 * never accepted from the caller — so it always reflects the actual bytes.
 *
 * @param {("input"|"output")} edge - which edge this value belongs to.
 * @param {object} opts
 * @param {string} opts.kind - the source-kind (input) or result-kind (output).
 * @param {string} opts.identity - a stable handle for which thing this is
 *   (NOT the client's name).
 * @param {unknown} opts.payload - the per-kind payload (a JSON-shaped value).
 * @param {number} [opts.schemaVersion] - the contract version this conforms to.
 * @returns {{edge: string, envelope: object, payload: unknown}}
 */
export function makeNormalized(edge, { kind, identity, payload, schemaVersion = SCHEMA_VERSION } = {}) {
  assert(edge === EDGE.INPUT || edge === EDGE.OUTPUT,
    `edge must be "input" or "output", got ${JSON.stringify(edge)}`);
  assert(payload !== undefined, "payload is required");

  const hash = contentHash(payload);
  const envelope = { kind, identity, contentHash: hash, schemaVersion };
  validateEnvelopeFields(envelope);

  return Object.freeze({ edge, envelope, payload });
}

/**
 * A normalized DESCRIPTION (input edge). `kind` is a source-kind. There is one
 * payload shape per source-kind, owned by the adapters that read that kind.
 */
export function makeDescription({ kind, identity, payload, schemaVersion } = {}) {
  return makeNormalized(EDGE.INPUT, { kind, identity, payload, schemaVersion });
}

/**
 * A normalized RESULT (output edge). The result is a TAGGED UNION over the
 * shared envelope: `kind` is the result-kind tag that selects the payload shape.
 * The core type-checks skill<->adapter wiring on this tag alone, never parsing
 * the payload.
 */
export function makeResult({ kind, identity, payload, schemaVersion } = {}) {
  return makeNormalized(EDGE.OUTPUT, { kind, identity, payload, schemaVersion });
}

/**
 * Validate a normalized value's structure (both edges share this check, since
 * the envelope is kind-agnostic). Re-derives the content-hash and asserts it
 * matches — catching a payload that drifted from its recorded hash.
 *
 * @returns {true} on success; throws on the first violation.
 */
export function validateNormalized(value) {
  assert(isPlainObject(value), "normalized value must be an object");
  assert(value.edge === EDGE.INPUT || value.edge === EDGE.OUTPUT,
    `edge must be "input" or "output", got ${JSON.stringify(value.edge)}`);
  assert(isPlainObject(value.envelope), "normalized value must carry an envelope object");
  assert("payload" in value && value.payload !== undefined, "normalized value must carry a payload");

  const { kind, identity, contentHash: hash, schemaVersion } = value.envelope;
  validateEnvelopeFields({ kind, identity, contentHash: hash, schemaVersion });

  const recomputed = contentHash(value.payload);
  assert(recomputed === hash,
    `envelope.contentHash ${hash} does not match the payload (recomputed ${recomputed})`);

  return true;
}

/**
 * Serialize a whole normalized value (envelope + payload) to canonical,
 * byte-stable bytes. This is what the determinism gate byte-diffs and what the
 * tier-2 prompt prefix is built from.
 */
export function serialize(value) {
  validateNormalized(value);
  // Re-wrap into a plain object so the canonical encoder sees only data (the
  // returned value from makeNormalized is frozen but still a plain object).
  return canonicalize({
    edge: value.edge,
    envelope: {
      kind: value.envelope.kind,
      identity: value.envelope.identity,
      contentHash: value.envelope.contentHash,
      schemaVersion: value.envelope.schemaVersion,
    },
    payload: value.payload,
  });
}

/**
 * Parse canonical bytes back into a validated normalized value. Round-trip:
 * `deserialize(serialize(v))` equals `v` up to object identity, and
 * re-serializes to identical bytes.
 */
export function deserialize(bytes) {
  assert(typeof bytes === "string", "deserialize expects a string of canonical bytes");
  let parsed;
  try {
    parsed = JSON.parse(bytes);
  } catch (err) {
    throw new TypeError(`canonical bytes are not valid JSON: ${err.message}`);
  }
  // Reconstruct via the same factory so the content-hash is re-derived and the
  // value is validated, rather than trusting the bytes blindly.
  const value = makeNormalized(parsed.edge, {
    kind: parsed.envelope && parsed.envelope.kind,
    identity: parsed.envelope && parsed.envelope.identity,
    payload: parsed.payload,
    schemaVersion: parsed.envelope && parsed.envelope.schemaVersion,
  });
  // The stored hash must agree with the re-derived one; if not, the bytes were
  // tampered with or non-canonical.
  assert(value.envelope.contentHash === (parsed.envelope && parsed.envelope.contentHash),
    "deserialized payload does not match the stored content-hash");
  return value;
}

/**
 * The SOURCE content-hash of an input-edge description — promoted to a first-class, NAMED field of
 * the normalized envelope (T-HARD-07 / docs/04a §envelope `content-hash`, docs/04 §file transport).
 *
 * docs/04a is explicit that the envelope's content-hash is "THE SINGLE VALUE that powers
 * determinism gates, prompt-prefix cache validity, and the upload-once/reference-many file
 * optimization — all keyed off 'did the bytes change?'". For an INPUT description the payload is a
 * byte-deterministic function of the source bytes (the adapter's determinism rule), so the envelope
 * content-hash IS the faithful "did the source change?" proxy. This accessor names that role
 * explicitly so the two consumers the audit asked to unify read ONE value, not two divergent ones:
 *   - the file-transport upload cache (src/adapters/file-transport.js) keys upload-once /
 *     reference-many off it — a changed source content-hash forces a re-upload (docs/04 file transport);
 *   - the tier-2 cache-hit diagnostic (src/core/cache-diagnostics.js, via the prompt-tiers renderer)
 *     attributes a tier-2 cache-hit drop to the INPUT ADAPTER off the SAME value.
 * A test asserts both consumers see the identical hash (T-HARD-07 acceptance).
 *
 * Restricted to the INPUT edge: "source content-hash" is meaningful for a description (it has a
 * source); an output result's content-hash is the artifact's hash, a different role. Calling this on
 * an output value is a wiring error (fail loud, validate-before-acting).
 *
 * @param {{edge:string, envelope:{contentHash:string}}} description  an input-edge normalized value
 * @returns {string} the self-describing source content-hash (e.g. "sha256:<hex>")
 */
export function sourceContentHash(description) {
  validateNormalized(description);
  assert(description.edge === EDGE.INPUT,
    `sourceContentHash is defined for an INPUT description (it hashes a source); got edge ${JSON.stringify(description.edge)}`);
  return description.envelope.contentHash;
}

/**
 * Payload equality up to the envelope's identity/content-hash — the comparison
 * the GENERICITY proof needs: two equivalent sources (or two output adapters
 * for one result-kind) must agree on the payload and the kind, even though
 * identity legitimately differs. Compared on canonical bytes so order/format
 * never produce a false negative.
 */
export function payloadsEqual(a, b) {
  validateNormalized(a);
  validateNormalized(b);
  if (a.edge !== b.edge) return false;
  if (a.envelope.kind !== b.envelope.kind) return false;
  return canonicalize(a.payload) === canonicalize(b.payload);
}
