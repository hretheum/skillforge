// Loader error model — fail LOUD and EARLY, naming the specific failing gate.
//
// The loader's contract (docs/06-loader-and-activation.md) is "validate before acting":
// it checks the whole chain (clients_dir -> client -> config -> adapters -> references
// -> profile) before the core assembles anything, and on the first failing link it stops
// with a readable message that says *what* and *where* is wrong — never silently, never
// guessing. Each failure is a typed error whose `gate` names the link that failed, so an
// operator sees which gate stopped them, not a generic crash.

/**
 * The chain links, in evaluation order. The order is the same one the client-context
 * chain is built in; failing on the first link that does not hold is the "loud and early"
 * discipline. Exported so callers (and tests) can reason about ordering by name, not by
 * scanning strings.
 */
export const GATES = Object.freeze({
  CLIENTS_DIR: 'clients-dir',
  CLIENT: 'client',
  CONFIG: 'config',
  ADAPTERS: 'adapters',
  REFERENCES: 'references',
  PROFILE: 'profile',
  // Activation-predicate gates (T-MVP-11, docs/06 §Activation). The activation orchestrator
  // (src/loader/activation.js) evaluates the six AND-conjuncts deny-first and stops on the
  // first that fails, naming its gate. Recognition (conjunct 1) is NOT a gate here — per
  // docs/06 it is what brings the request to the loader, evaluated upstream, not by the loader.
  CLIENT_HAS_SKILL: 'client-has-skill', // conjunct 2 — the client adopted this skill
  REGISTRY_ENABLED: 'registry-enabled', // conjunct 3 — registry entry is enabled:true
  TYPING: 'typing', // conjunct 4 — skill<->adapter result-kind/source-kind pairing
  SCOPE: 'scope', // conjunct 5 — (client, project) scope permits the skill
  // (conjunct 6 — profile-permits — reuses the existing PROFILE gate above.)
  // Deployment-inventory gate (CC-36, docs/13 §"requiredTools"). Not an activation conjunct: it
  // checks the active skill's requiredTools against the tools the deployment actually exposes, a
  // per-deployment constraint evaluated once after activation, before the skill's side effects run.
  TOOL_INVENTORY: 'tool-inventory',
});

/**
 * A loader failure. Carries the failing `gate` (one of GATES) and, where useful, the
 * `field`/`name`/`path` the message points at. `cause` chains an underlying error
 * (e.g. a filesystem error behind an unresolvable reference) without losing it.
 */
export class LoaderError extends Error {
  /**
   * @param {string} gate one of GATES
   * @param {string} message human-readable: what is wrong and where
   * @param {{ field?: string, name?: string, path?: string, cause?: unknown }} [detail]
   */
  constructor(gate, message, detail = {}) {
    super(message, detail.cause !== undefined ? { cause: detail.cause } : undefined);
    this.name = 'LoaderError';
    this.gate = gate;
    if (detail.field !== undefined) this.field = detail.field;
    if (detail.name !== undefined) this.subject = detail.name;
    if (detail.path !== undefined) this.path = detail.path;
  }
}

export const isLoaderError = (e) => e instanceof LoaderError;
