// Public surface of the core's normalized form. The two adapter edges
// (src/adapters/input, src/adapters/output) import only from here.
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room). See docs/04a-normalized-form.md.

export { canonicalize } from "./canonical.js";
export { contentHash, isContentHash, HASH_ALGORITHM } from "./content-hash.js";
export {
  SCHEMA_VERSION,
  EDGE,
  makeNormalized,
  makeDescription,
  makeResult,
  validateNormalized,
  serialize,
  deserialize,
  payloadsEqual,
  sourceContentHash,
} from "./normalized-form.js";
export { renderPromptTiers, TIER_ORDER } from "./prompt-tiers.js";
export {
  TELEMETRY_ATTR,
  OTEL_RESOURCE_ATTRIBUTES_ENV,
  sessionResourceAttributes,
  resourceAttributesString,
  resourceAttributesEnv,
} from "./telemetry.js";
export {
  CACHE_OWNER,
  CACHE_DIAG_ATTR,
  cacheDiagnosticAttributes,
  attributeCacheDrop,
} from "./cache-diagnostics.js";
export {
  resultsEquivalent,
  diagnoseEquivalence,
  assertEquivalent,
  EQUIVALENCE_MISMATCH,
} from "./equivalence.js";
