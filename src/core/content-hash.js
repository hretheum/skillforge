// content-hash: a stable digest of the canonical serialization of a payload.
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room). See docs/04a-normalized-form.md (the `content-hash` field).
//
// The hash is the cheap proxy for "did the bytes change?" that powers the
// determinism gate, prompt-prefix cache validity, and the upload-once /
// reference-many file optimization. It is meaningful ONLY because it is
// computed over the canonical serialization (canonical.js) — two
// byte-different-but-semantically-equal payloads would otherwise get two
// hashes and the cache/file-reuse logic would silently misfire.

import { createHash } from "node:crypto";
import { canonicalize } from "./canonical.js";

/**
 * The hash algorithm and the prefix the digest carries. The prefix names the
 * algorithm in-band so a stored hash stays self-describing if the algorithm
 * ever changes (a change of algorithm is a contract change, like the canonical
 * serialization itself).
 */
export const HASH_ALGORITHM = "sha256";
const HASH_PREFIX = `${HASH_ALGORITHM}:`;

/**
 * Compute the content-hash of a payload value.
 *
 * @param {unknown} payload - the JSON-shaped payload to hash (it is canonicalized
 *   first, so the hash is order- and format-independent).
 * @returns {string} a self-describing digest, e.g. "sha256:<hex>".
 */
export function contentHash(payload) {
  const bytes = canonicalize(payload);
  const digest = createHash(HASH_ALGORITHM).update(bytes, "utf8").digest("hex");
  return `${HASH_PREFIX}${digest}`;
}

/**
 * Whether a string is a well-formed content-hash this module would produce.
 */
export function isContentHash(value) {
  return (
    typeof value === "string" &&
    value.startsWith(HASH_PREFIX) &&
    /^[0-9a-f]{64}$/.test(value.slice(HASH_PREFIX.length))
  );
}
