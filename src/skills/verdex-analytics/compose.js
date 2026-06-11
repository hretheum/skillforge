// Skill core — the "verdex-analytics" COMPOSE step: an ANALYSIS recipe that reads the Verdex --vx-
// token set and returns a read-only {report} envelope describing the available token tiers.
//
// Sources: concept + first principles, zero files from any third-party skills-factory codebase
// (clean-room). See docs/p3-corner-cases.md (CC-29 katakana title, CC-16 analysis-is-read-only).
//
// ANALYSIS KIND. The analysisDescriptor's compose contract requires an object with a `report` field
// (src/registry/kinds/analysis.js). Its stage set has no read/build/gate, so this compose reads the
// client resources via the references family and emits a descriptive report — never a file.
//
// CC-29 — NON-LATIN TITLE IS PRESERVED. The report carries the skill's katakana title
// ("アナリティクス") verbatim, proving the engine routes on the ASCII registry key while leaving the
// human-facing title untouched through the full pipeline.
//
// CLEAN-ROOM. This file names no client value: every --vx- token literal arrives as DATA through the
// engine-resolved `references.tokenHub`.

/** The skill's human title in Japanese katakana, carried into the report to prove CC-29 round-trips. */
export const KATAKANA_TITLE = 'アナリティクス';

/**
 * Collect the token names of one tier from the Verdex token document, sorted for determinism.
 *
 * @param {object|undefined} tier
 * @returns {string[]}
 */
function tierNames(tier) {
  if (!tier || typeof tier !== 'object' || Array.isArray(tier)) return [];
  return Object.keys(tier).sort();
}

/**
 * Compose the analysis report for verdex-analytics from the engine-resolved references.
 *
 * @param {object} args
 * @param {Record<string, { resolvedPath: string|null, data: unknown }>} [args.references]
 * @param {object|null} [args.request]
 * @returns {{ report: object }}
 */
export function composeAnalysis({ references, request = null } = {}) {
  const tokens = references?.tokenHub?.data ?? null;
  const primitive = tierNames(tokens?.primitive);
  const semantic = tierNames(tokens?.semantic);
  const component = tierNames(tokens?.component);

  return {
    report: {
      title: KATAKANA_TITLE,
      tokenPath: references?.tokenHub?.resolvedPath ?? null,
      tierCounts: {
        primitive: primitive.length,
        semantic: semantic.length,
        component: component.length,
      },
      tiers: { primitive, semantic, component },
      request,
    },
  };
}
