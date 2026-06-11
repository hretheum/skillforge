// The engine's adapter registry — the "driver catalog" of docs/04-adapters.md
// §"Registering and selecting an adapter".
//
// The registry records the adapters the engine knows, each under a stable name, kept per
// edge: `input` (world -> engine) and `output` (engine -> world). A client config never
// *defines* an adapter — it only *selects* one by name — so the loader's job is to confirm
// each selected name exists in this catalog before binding it onto a pipeline edge.
//
// At MVP the catalog holds names, not implementations: the concrete input/output adapters
// (T-MVP-06 / T-MVP-07) register themselves here as they land. Keeping the catalog
// injectable means the loader is testable in isolation and later tasks extend it as data
// rather than editing the loader. Result-kind typing of the wiring (source-kind/result-kind
// pairing) is a later gate (T-MVP-10) and deliberately not done here — this catalog answers
// only "does an adapter by this name exist on this edge".
//
// NAMESPACED + VERSIONED (T-P4-02). Each catalog entry now carries a per-adapter CONTRACT
// VERSION, matching the discipline the SKILL registry already has (docs/12 §"Field
// semantics", every skill carries a `version`). The namespacing is the edge itself: every
// adapter is addressed as `input.<name>` / `output.<name>` (the EDGES below), so the same
// short name may legitimately exist on both edges without collision, and the version is a
// property of the (edge, name) pair. A client config can PIN the adapter-contract version it
// was built against; `resolve()` (and registry-lint, docs/12 §registry-lint) check that the
// catalog still satisfies the pin under semver-compatible rules (docs/04a §versioning: a
// MAJOR bump is a breaking contract change). The version is OPTIONAL on the input side: an
// entry seeded as a bare string keeps DEFAULT_CONTRACT_VERSION, and a config WITHOUT a pin
// resolves against any catalog version — so this is backward-compatible by construction
// (existing clients that never mention a version keep working unchanged).
//
// GATE-PER-ADAPTER (T-P4-01). The catalog is also the registration point where docs/04
// §"how to add a new adapter" steps 5–6 are made enforceable: every entry declares the GATE
// that proves it (an input adapter -> a determinism golden; an output adapter -> a
// genericity-proof pairing). An entry MUST declare its gate, so adding an adapter to this
// catalog without naming its gate fails construction immediately, and the coverage tool
// (tools/adapter-gate-coverage.js, wired into the gate runner) further checks that the named
// gate ACTUALLY covers the adapter — the catalog cannot grow ungated.

/** The two adapter edges. Also the registry's two NAMESPACES (`input.*` / `output.*`). */
export const EDGES = Object.freeze({ INPUT: 'input', OUTPUT: 'output' });

/**
 * The default contract version stamped on an entry seeded without one (a bare name string).
 * Keeping a default means the legacy seed shape (`{ input: ['dtcg-tokens'] }`) still produces
 * a fully-versioned entry — the version axis is additive, never required of callers.
 */
export const DEFAULT_CONTRACT_VERSION = '1.0.0';

/** The gate KIND each edge's adapters must ship (T-P4-01 registration requirement). */
export const GATE_KINDS = Object.freeze({
  // An input adapter is proven by a checked-in determinism golden (Gate 1): the same source
  // bytes must serialize byte-identically. The entry names the golden fixture so the coverage
  // tool can confirm it exists.
  [EDGES.INPUT]: 'determinism-golden',
  // An output adapter is proven by a genericity-proof pairing (Gate 2): the same skill decision,
  // rendered through this adapter AND another, yields equivalent results in two forms. The entry
  // declares the pairing partner so the coverage tool can confirm the adapter is in the proof.
  [EDGES.OUTPUT]: 'genericity-pair',
});

const assertEdge = (edge) => {
  if (edge !== EDGES.INPUT && edge !== EDGES.OUTPUT) {
    throw new Error(`unknown adapter edge "${edge}" (expected "input" or "output")`);
  }
};

/**
 * Parse a "MAJOR.MINOR.PATCH" version into numeric parts. Loud on a malformed string so a
 * typo'd version in the catalog or a pin fails at construction/resolution, never silently.
 */
function parseVersion(v, where) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v));
  if (!m) throw new Error(`${where}: version "${v}" is not "MAJOR.MINOR.PATCH"`);
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/**
 * Is a catalog `available` version compatible with a config's `pin`? Semver-compatible (docs/04a
 * §versioning): a pin is satisfied when the MAJOR matches (no breaking contract change) AND the
 * available (minor, patch) is >= the pinned one (the catalog may have shipped additive fixes the
 * pin predates, but never a missing capability the pin needs). A bare pin of `null`/`undefined`
 * means "no pin" and is always satisfied — that is the backward-compatible path.
 */
export function versionSatisfies(available, pin) {
  if (pin == null) return true;
  const a = parseVersion(available, 'catalog');
  const p = parseVersion(pin, 'pin');
  if (a.major !== p.major) return false;
  if (a.minor !== p.minor) return a.minor > p.minor;
  return a.patch >= p.patch;
}

/**
 * Normalize one seed entry into the catalog's internal record. Accepts either a bare NAME
 * string (legacy seed shape — version + gate defaulted) or a rich object
 * `{ name, version?, gate? }`. The gate is REQUIRED for an entry that declares one explicitly;
 * a bare-string seed gets no gate (the built-in defaultAdapterRegistry seeds the real gates).
 */
function normalizeEntry(edge, seed) {
  if (typeof seed === 'string') {
    if (seed.length === 0) throw new Error('adapter name must be a non-empty string');
    return { name: seed, version: DEFAULT_CONTRACT_VERSION, gate: null };
  }
  if (seed == null || typeof seed !== 'object' || Array.isArray(seed)) {
    throw new Error(`adapter seed on edge "${edge}" must be a name string or { name, version, gate } object`);
  }
  const { name } = seed;
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('adapter name must be a non-empty string');
  }
  const version = seed.version ?? DEFAULT_CONTRACT_VERSION;
  parseVersion(version, `${edge}.${name}`); // validate shape eagerly
  let gate = null;
  if (seed.gate != null) {
    if (typeof seed.gate !== 'object' || Array.isArray(seed.gate) || typeof seed.gate.kind !== 'string') {
      throw new Error(`${edge}.${name}: gate must be { kind, ... } describing the adapter's proof`);
    }
    if (seed.gate.kind !== GATE_KINDS[edge]) {
      throw new Error(
        `${edge}.${name}: gate.kind "${seed.gate.kind}" does not match the "${edge}" edge requirement "${GATE_KINDS[edge]}"`,
      );
    }
    gate = { ...seed.gate };
  }
  return { name, version, gate };
}

/**
 * Build an adapter registry.
 *
 * @param {{ input?: Array<string|object>, output?: Array<string|object> }} [seed] adapter
 *   entries known at the edges; each is a bare NAME string (version/gate defaulted) or a rich
 *   `{ name, version?, gate? }` object (T-P4-02 namespacing + versioning, T-P4-01 gate).
 * @returns {{
 *   register: (edge: string, name: string, opts?: object) => void,
 *   has: (edge: string, name: string) => boolean,
 *   names: (edge: string) => string[],
 *   version: (edge: string, name: string) => (string|undefined),
 *   entry: (edge: string, name: string) => (object|undefined),
 *   entries: (edge: string) => object[],
 *   resolve: (edge: string, name: string, pin?: string) => object,
 * }}
 */
export function createAdapterRegistry(seed = {}) {
  // Per edge: Map<name, { name, version, gate }> — preserves the old "set of names" semantics
  // (has/names) while carrying the version + gate the new methods expose.
  const catalog = {
    [EDGES.INPUT]: new Map(),
    [EDGES.OUTPUT]: new Map(),
  };
  for (const edge of [EDGES.INPUT, EDGES.OUTPUT]) {
    for (const s of seed[edge] ?? []) {
      const rec = normalizeEntry(edge, s);
      catalog[edge].set(rec.name, rec);
    }
  }

  return {
    /**
     * Register (or re-register) an adapter on an edge. Backward-compatible: the legacy call
     * `register(edge, name)` still works (version + gate defaulted). Pass `{ version, gate }`
     * to record the contract version and the proving gate (T-P4-01/02).
     */
    register(edge, name, opts = {}) {
      assertEdge(edge);
      if (typeof name !== 'string' || name.length === 0) {
        throw new Error('adapter name must be a non-empty string');
      }
      const rec = normalizeEntry(edge, { name, ...opts });
      catalog[edge].set(rec.name, rec);
    },
    has(edge, name) {
      assertEdge(edge);
      return catalog[edge].has(name);
    },
    names(edge) {
      assertEdge(edge);
      return [...catalog[edge].keys()].sort();
    },
    /** The recorded contract version for an (edge, name), or undefined if unknown. */
    version(edge, name) {
      assertEdge(edge);
      return catalog[edge].get(name)?.version;
    },
    /** The full record `{ name, version, gate }` for an (edge, name), or undefined. */
    entry(edge, name) {
      assertEdge(edge);
      const rec = catalog[edge].get(name);
      return rec ? { ...rec } : undefined;
    },
    /** All records on an edge, name-sorted (stable order). */
    entries(edge) {
      assertEdge(edge);
      return this.names(edge).map((n) => ({ ...catalog[edge].get(n) }));
    },
    /**
     * Resolve a selected adapter against the catalog, enforcing existence AND (if given) the
     * config's version pin — the "validate before acting" rule (docs/06) extended to versions
     * (T-P4-02: "a config can pin an adapter-contract version"). Returns the record on success.
     * Throws a readable error if the name is unknown or the pin is not satisfied. A `null` pin
     * is the backward-compatible path (existing configs without a pin resolve unconditionally).
     *
     * @param {("input"|"output")} edge
     * @param {string} name  the adapter name the config selected.
     * @param {string} [pin] the adapter-contract version the config was built against.
     */
    resolve(edge, name, pin = null) {
      assertEdge(edge);
      const rec = catalog[edge].get(name);
      if (!rec) {
        throw new Error(
          `unknown ${edge} adapter "${name}" (known ${edge} adapters: ${this.names(edge).join(', ') || 'none'})`,
        );
      }
      if (pin != null && !versionSatisfies(rec.version, pin)) {
        throw new Error(
          `${edge} adapter "${name}" version ${rec.version} does not satisfy the config's pin "${pin}" ` +
            `(a MAJOR mismatch is a breaking contract change; re-pin or upgrade the adapter)`,
        );
      }
      return { ...rec };
    },
  };
}

/**
 * The default catalog for the MVP: the adapter names the first client selects, now stamped with
 * their contract VERSION and the GATE that proves each one (T-P4-01/02). The concrete adapters
 * behind these names arrive in T-MVP-06 (`dtcg-tokens`) and T-MVP-07 (`react`); declaring the
 * names here lets the loader resolve the first client's config now and is the seam those tasks
 * plug their implementations into.
 *
 * Every entry names its GATE so the catalog is self-describing about what proves it; the
 * coverage tool (tools/adapter-gate-coverage.js) checks those gates actually cover the adapter,
 * making "ship a gate with every adapter" a registration requirement that bites in CI.
 */
export function defaultAdapterRegistry() {
  return createAdapterRegistry({
    input: [
      // `dtcg-tokens` — the first client's DTCG reader, proven by its determinism golden.
      {
        name: 'dtcg-tokens',
        version: '1.0.0',
        gate: { kind: GATE_KINDS[EDGES.INPUT], golden: 'dtcg-golden-description.json' },
      },
      // `flat-tokens` is the second input adapter for the input-edge mirror (T-P2-04): it produces
      // the same `design-system` source-kind as `dtcg-tokens`, reading a different on-disk form. It
      // exists in the catalog so a config that selects it resolves; clients still wire `dtcg-tokens`
      // by default. Proven by the Glasshouse flat-tokens determinism golden.
      {
        name: 'flat-tokens',
        version: '1.0.0',
        gate: { kind: GATE_KINDS[EDGES.INPUT], golden: 'flat-glasshouse-description.json' },
      },
    ],
    output: [
      // `react` — the first client's React output, proven by the genericity pairing with
      // web-components (same skill decision, two forms, equivalent results).
      {
        name: 'react',
        version: '1.0.0',
        gate: { kind: GATE_KINDS[EDGES.OUTPUT], pairsWith: 'web-components' },
      },
      // `web-components` is the second output adapter for the genericity proof (Gate 2): it
      // accepts the same `frontend-component` result-kind as `react` and renders a different
      // form. It exists in the catalog so a config that selects it resolves; the create-component
      // skill still wires `react` by default.
      {
        name: 'web-components',
        version: '1.0.0',
        gate: { kind: GATE_KINDS[EDGES.OUTPUT], pairsWith: 'react' },
      },
    ],
  });
}
