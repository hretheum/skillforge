// adapter — the shared cross-harness emit contract. Every harness flavour (Claude,
// Codex, and any future target) is a SWAPPABLE EDGE over a generic interior: the open core
// stays authoritative, and a harness adapter only PROJECTS it onto one runtime's surfaces.
//
// Sources: concept + first principles + the public Agent Skills / Claude Code docs cited in
// claude-flavour.js. Zero files from any third-party skills-factory codebase (clean-room).
//
// WHY A CONTRACT. The first harness (Claude) baked its shape into one module. To add a second
// target without forking the export layer, we name the MINIMAL surface every harness adapter
// must implement, then let emit() dispatch on it as DATA. The contract is the same swappable-
// edge / generic-interior shape the rest of the spec uses (the input/output adapter dispatch):
// a registered name → a function table, validated before use.
//
// THE MINIMAL SURFACE. A harness adapter is a plain object (this codebase is functional — no
// classes) with exactly these fields:
//
//   - profile  {string}            the emit-profile name this adapter answers to (its key in
//                                  the dispatch table; what a caller passes as `profile`).
//   - apply    {function}          ({ skillText, registryEntry, name }) → { skillMd, companions,
//                                  additions }. Projects the open core onto the harness: returns
//                                  the augmented SKILL.md, the companion artifacts (separate
//                                  harness-native files), and the additive frontmatter lines.
//   - strip    {function}          (skillMd) → skillMd. The inverse of `apply`'s frontmatter
//                                  additions: removing them must recover the open core
//                                  byte-for-byte (the portability proof). A no-op-safe identity
//                                  on text that carries no additions.
//
// THE INVARIANT EVERY ADAPTER PROMISES. Additive and reversible: apply() only INSERTS additive
// frontmatter + emits companions, never edits/removes an open-core field or the body; and
// strip(apply(x).skillMd) === x byte-for-byte. This is what keeps a skill authored to the open
// core portable across harnesses — each adapter ADDS capability for its runtime, none is required.
//
// Generic by construction: this file names no client and no harness. It defines the SHAPE; the
// concrete adapters (claude-flavour.js, codex-flavour.js) supply the behavior.

/**
 * The documented adapter interface: the required field names and their kinds. A plain object
 * (no classes) so it is itself DATA — usable in messages, docs, and the validator below.
 * @type {Readonly<{fields: ReadonlyArray<{name:string,kind:string,description:string}>}>}
 */
export const ADAPTER_INTERFACE = Object.freeze({
  fields: Object.freeze([
    Object.freeze({
      name: "profile",
      kind: "string",
      description: "the emit-profile name this adapter answers to (its dispatch key)",
    }),
    Object.freeze({
      name: "apply",
      kind: "function",
      description:
        "({ skillText, registryEntry, name }) → { skillMd, companions, additions } — projects the open core onto the harness (additive only)",
    }),
    Object.freeze({
      name: "strip",
      kind: "function",
      description:
        "(skillMd) → skillMd — the inverse of apply's additions; recovers the open core byte-for-byte",
    }),
  ]),
});

/** The required field names, derived from the interface (single source of truth). */
export const ADAPTER_REQUIRED_FIELDS = Object.freeze(
  ADAPTER_INTERFACE.fields.map((f) => f.name),
);

/**
 * Validate that an object conforms to the harness-adapter interface — the minimal surface every
 * emit profile must implement. Checks presence and kind of each required field; returns a
 * structured verdict so the caller can fail loud with a precise reason (validate before acting).
 *
 * @param {unknown} obj  the candidate adapter.
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateAdapter(obj) {
  if (obj == null || typeof obj !== "object") {
    return { valid: false, reason: "adapter must be a non-null object" };
  }
  for (const field of ADAPTER_INTERFACE.fields) {
    const value = obj[field.name];
    if (value === undefined) {
      return { valid: false, reason: `adapter is missing required field "${field.name}"` };
    }
    if (typeof value !== field.kind) {
      return {
        valid: false,
        reason: `adapter field "${field.name}" must be a ${field.kind} (got ${typeof value})`,
      };
    }
  }
  if (obj.profile.length === 0) {
    return { valid: false, reason: 'adapter field "profile" must be a non-empty string' };
  }
  return { valid: true };
}

/**
 * Assert an object conforms to the adapter interface, throwing loudly otherwise. Convenience for
 * the dispatch layer, which must never register a malformed adapter.
 *
 * @param {unknown} obj
 * @param {string} [label]  a label for the error message (e.g. the module name).
 * @returns {object} the validated adapter (narrowed).
 * @throws {TypeError} when the object does not conform.
 */
export function assertAdapter(obj, label = "adapter") {
  const verdict = validateAdapter(obj);
  if (!verdict.valid) {
    throw new TypeError(`${label} does not conform to the harness-adapter interface: ${verdict.reason}`);
  }
  return obj;
}
