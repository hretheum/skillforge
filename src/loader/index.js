// Public surface of the loader spine.
export {
  loadClientConfig,
  mergeParentChild,
  deferAllProfileEvaluator,
  assertDataOnly,
} from './config-loader.js';
export { createAdapterRegistry, defaultAdapterRegistry, EDGES } from './adapter-registry.js';
export { LoaderError, isLoaderError, GATES } from './errors.js';
// Skill↔adapter result-kind typing (T-MVP-10) — the start-up wiring check. It lives in
// src/registry (single source of truth, shared with registry-lint) and is surfaced here so a
// loader-side caller validates the pairing before acting. The full activation predicate
// (T-MVP-11) folds assertSkillAdapterTyping into loadClientConfig's validate-before-acting
// chain so a mistyped pairing fails at start-up, not as a malformed artifact.
export {
  defaultAdapterKinds,
  assertSkillAdapterTyping,
  checkSkillAdapterTyping,
  typingFactsFromEntry,
} from '../registry/index.js';
// The full activation predicate (T-MVP-11) — the six-conjunct AND that decides whether a
// recognized skill may run for a (client, project): client-has-skill ∧ registry-enabled ∧
// adapters-valid/typed ∧ scope-permits ∧ profile-permits. It consumes the loaded client
// context (loadClientConfig), the registry, the kinds catalog, and the profile-evaluator —
// orchestration only, deny-first, naming the first failing gate.
export { activate, canActivate, ACTIVATION_GATES } from './activation.js';
