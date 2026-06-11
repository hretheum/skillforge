// Run-path edge wrappers — apply the runtime-failure contract (API-01) at the two adapter
// edges the run path crosses, so run.js stays orchestration-only.
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room). Realizes docs/04-adapters.md §"Adapter runtime-failure contract"
// (the run-path application of src/adapters/failure.js) + docs/06 "never start with half its
// context".
//
// WHY A SEPARATE SEAM. run.js orchestrates; it owns no policy and no failure interpretation.
// The runtime-failure contract is exactly such a policy (what is fatal, what is recoverable,
// what an empty/partial read means). Keeping it here lets run.js change in only the two spots
// where it crosses an edge — call readInput()/buildResult() instead of input.read()/
// output.makeResult() — and inherit the contract without embedding it.
//
// THE GUARANTEE these wrappers add over a bare adapter call:
//   - INPUT: a thrown/timed-out/malformed read becomes a typed AdapterFailure (classified); a
//     successful-but-EMPTY read becomes a defined permanent-fatal failure (no empty-context
//     assembly); a partial read is rejected as fatal (no partial-context run). Per the hard
//     rule, EVERY input failure here is fatal — it aborts the run, it never degrades it.
//   - OUTPUT: a thrown makeResult/render becomes a typed AdapterFailure. The actual side-effect
//     write stays behind the PreToolUse gate in run.js; commitArtifact() (in failure.js) is the
//     transactional helper the caller uses when it persists the gated bytes.
//
// Generic by construction: this file names no client and no concrete adapter — it operates on
// the adapter callables resolved by name in src/adapters/index.js.

import { readFileSync } from "node:fs";
import {
  callUnderContract,
  isEmptyDescription,
  emptySourceFailure,
} from "./failure.js";

/**
 * Read the client's design system through the input adapter UNDER the failure contract.
 *
 * @param {object} args
 * @param {{ read: Function }} args.adapter   the resolved input adapter (getInputAdapter result)
 * @param {string} [args.adapterName]         the adapter name (for failure reasons; not a secret)
 * @param {object} args.readArgs              the args passed to adapter.read (references, etc.)
 * @param {string|null} [args.rotationHint]   the secret REFERENCE to name on an auth failure
 *        (a reference the deployment chose to expose — never a value).
 * @returns {{edge: string, envelope: object, payload: object}} a non-empty normalized description.
 * @throws {AdapterFailure} fatal on any read failure, on a malformed source, or on an empty source.
 */
export function readInput({ adapter, adapterName, readArgs, rotationHint = null } = {}) {
  // Any throw (malformed JSON, missing reference, transport error) → a classified, FATAL input
  // failure. Input failures are always fatal under the hard rule (no degraded assembly), so we
  // force fatal=true regardless of the underlying class.
  const description = callUnderContract(() => adapter.read(readArgs), {
    edge: "input",
    adapter: adapterName,
    rotationHint,
    fatal: true,
  });

  // A read that SUCCEEDED but yielded nothing usable is its own defined outcome — refuse the
  // empty-context assembly rather than emitting a confidently-wrong artifact from no facts.
  if (isEmptyDescription(description)) {
    throw emptySourceFailure({ adapter: adapterName });
  }
  return description;
}

/**
 * Resolve the loader-resolved references map into PARSED data UNDER the failure contract — the
 * instruction family's edge (it has no input adapter, but its references are still a runtime edge:
 * a file that resolved at load time can be missing or malformed at call time). For each reference
 * that carries a resolvedPath, read + JSON-parse the file behind the classifier; a missing/
 * unreadable file or malformed JSON becomes a typed, FATAL AdapterFailure (input edge, permanent),
 * the same defined outcome readInput() produces — never a raw fs/JSON error escaping to compose.
 * A reference with no resolvedPath (e.g. an unresolved remote ref the skill does not use) is passed
 * through with `data: null`; the compose step raises its own typed failure if it NEEDS that ref.
 *
 * The returned map preserves every original entry field ({ref, resolvedPath, local}) and ADDS a
 * `data` field, so compose reads `references.<name>.data` instead of touching the filesystem.
 *
 * @param {Record<string, { ref: string, resolvedPath: string|null, local: boolean }>} references
 * @returns {Record<string, { ref: string, resolvedPath: string|null, local: boolean, data: unknown }>}
 * @throws {AdapterFailure} fatal on a missing/unreadable reference file or malformed JSON.
 */
export function resolveRefs(references = {}) {
  const resolved = {};
  for (const [name, entry] of Object.entries(references ?? {})) {
    const path = entry?.resolvedPath ?? null;
    if (!path) {
      // No resolvable local file — leave the data null; only a skill that NEEDS this ref fails,
      // and it fails in compose with a typed "missing reference" failure (not here, blindly).
      resolved[name] = { ...entry, data: null };
      continue;
    }
    const data = callUnderContract(() => JSON.parse(readFileSync(path, "utf8")), {
      edge: "input",
      adapter: `reference:${name}`,
      fatal: true,
    });
    resolved[name] = { ...entry, data };
  }
  return resolved;
}

/**
 * Build the normalized RESULT through the output adapter UNDER the failure contract. This is the
 * pure (no-side-effect) half — makeResult + render produce in-memory bytes; the gated Write is
 * the side effect, performed by the caller after the PreToolUse gate (and, when persisting,
 * via commitArtifact for the transactional guarantee).
 *
 * @param {object} args
 * @param {{ makeResult: Function, render: Function }} args.adapter  resolved output adapter
 * @param {string} [args.adapterName]
 * @param {object} args.spec        the composed component spec
 * @param {string} args.identity    the result identity (NOT the client name)
 * @returns {{ result: object, artifact: object }} the normalized result + the rendered artifact.
 * @throws {AdapterFailure} fatal on any makeResult/render failure.
 */
export function buildResult({ adapter, adapterName, spec, identity } = {}) {
  // makeResult + render are pure functions of the spec, but a malformed spec (a compose defect)
  // or an adapter bug still throws — classify it as a fatal output failure rather than letting
  // a raw error escape the contract. (No side effect happens here; the write is gated upstream.)
  return callUnderContract(
    () => {
      const result = adapter.makeResult(spec, identity);
      const artifact = adapter.render(result);
      return { result, artifact };
    },
    { edge: "output", adapter: adapterName, fatal: true },
  );
}
