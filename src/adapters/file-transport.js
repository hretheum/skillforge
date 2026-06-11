// file-transport — the adapter-local "upload-once, reference-many" cache, keyed by the source
// content-hash (T-HARD-07 / docs/04-adapters.md §"Adapters and file transport", API-04).
//
// Sources: concept + first principles, zero files from any third-party skills-factory codebase
// (clean-room).
//
// WHAT THIS IS (and is NOT). docs/04 says the file-transport optimization — upload a source file
// once, get a backend handle, reference it across many calls, and RE-UPLOAD only when the source
// changed — is ADAPTER-LOCAL and lives BEHIND the contract: the core never sees a raw blob or a
// backend file handle. This module is that adapter-side bookkeeping, expressed generically. It is
// VENDOR-BLIND: it does not call any backend's Files API; the caller supplies an `upload` function
// that performs the real (vendor-specific) upload. This module only decides WHEN an upload is
// needed and caches the resulting handle.
//
// THE KEY IS THE SOURCE CONTENT-HASH (the T-HARD-07 unification). docs/04a names the envelope
// content-hash as THE SINGLE value that powers determinism, prompt-prefix cache validity, AND this
// file optimization — "all keyed off 'did the bytes change?'". So this cache keys off exactly
// `sourceContentHash(description)` (src/core/normalized-form.js) — the SAME first-class envelope
// value the tier-2 cache-hit diagnostic reads. One value, two consumers: a changed source produces
// a new content-hash → a cache miss here (re-upload) AND a tier-2 fingerprint change in the
// diagnostic. The acceptance test proves both consumers see the identical hash.
//
// SECRET-FREE / CONTENT-FREE. The cache stores a content-hash key and an opaque backend handle —
// never the source bytes and never the client name (the identity rule, docs/10). The handle is
// whatever the backend returns (e.g. a file_id); this module treats it as an opaque token.

import { sourceContentHash } from "../core/index.js";

/**
 * Create an upload cache for one client's loaded runtime state (docs/04: "cache the handle in the
 * client's loaded runtime state, keyed by a content hash so a changed source re-uploads"). The
 * cache is per-instance so it lives and dies with the client's runtime, carrying no global state.
 *
 * @returns {{
 *   ensureUploaded: (description: object, upload: (key: string) => any) => { handle: any, reused: boolean, key: string },
 *   keyFor: (description: object) => string,
 *   has: (description: object) => boolean,
 *   size: () => number,
 * }}
 */
export function createUploadCache() {
  // key (source content-hash) -> opaque backend handle. A Map keeps insertion-independent lookup
  // and never serializes (so it cannot leak into telemetry/logs).
  const handles = new Map();

  /** The cache key for a description = its source content-hash (the single shared value). */
  function keyFor(description) {
    return sourceContentHash(description);
  }

  /** Whether this source's bytes have already been uploaded (same content-hash seen before). */
  function has(description) {
    return handles.has(keyFor(description));
  }

  /**
   * Upload-once, reference-many. Returns the cached handle if this source content-hash was already
   * uploaded (reference-many, no re-send); otherwise calls `upload(key)` to perform the real
   * (vendor-specific) upload, caches the handle under the content-hash, and returns it. A CHANGED
   * source has a different content-hash → cache miss → re-upload, which is the whole point.
   *
   * @param {object} description  an input-edge normalized description (carries the source content-hash)
   * @param {(key: string) => any} upload  performs the real upload, returns an opaque backend handle
   * @returns {{ handle: any, reused: boolean, key: string }}
   */
  function ensureUploaded(description, upload) {
    if (typeof upload !== "function") {
      throw new TypeError("ensureUploaded requires an `upload(key)` function (the vendor-specific upload)");
    }
    const key = keyFor(description); // validates the description + restricts to the input edge
    if (handles.has(key)) {
      return { handle: handles.get(key), reused: true, key };
    }
    const handle = upload(key);
    handles.set(key, handle);
    return { handle, reused: false, key };
  }

  return Object.freeze({ ensureUploaded, keyFor, has, size: () => handles.size });
}
