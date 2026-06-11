// Skill core — the "verdex-form-builder" COMPOSE step: an INSTRUCTION recipe that guides an agent
// to assemble a WCAG-conformant Verdex Financial form bound to the Verdex --vx- token set.
//
// Sources: concept + first principles, zero files from any third-party skills-factory codebase
// (clean-room). See docs/p3-corner-cases.md (CC-25 RTL prose in SKILL.md).
//
// WHY THIS IS SYNCHRONOUS. Unlike verdex-create-component (async, CC-09), this compose needs no
// async assembly — it is a plain function. The executor `await`s either shape (await on a non-Promise
// resolves to the value), so a sync compose is a first-class citizen of the same pipeline.
//
// CC-25 — NON-LATIN PROSE IS PRESERVED. The instruction payload weaves the skill's Arabic title
// ("نموذج بناء") into the guidance VERBATIM. The engine reads the skill on its ASCII registry key
// (verdex-form-builder) while the human-facing prose stays non-Latin and untouched: this compose
// emits the Arabic string directly so a test can assert it survives the full pipeline byte-for-byte.
//
// CLEAN-ROOM. This file names no client value: every --vx- token literal arrives as DATA through the
// engine-resolved `references.tokenHub`. The skill carries only the GENERIC recipe.

/** The skill's human title in Arabic (RTL), woven into the guidance to prove CC-25 round-trips. */
export const ARABIC_TITLE = 'نموذج بناء';

/** The WCAG constraints the generated form-authoring guidance always encodes. */
const WCAG_CONSTRAINTS = Object.freeze([
  'Associate every field with a visible <label> (label-for / aria-labelledby).',
  'Preserve a logical focus order and a visible focus ring bound to a --vx- token.',
  'Identify errors in text, not colour alone (WCAG 1.4.1); reference the field by id.',
  'Meet contrast minimums in every theme, including the high-contrast (hc-*) themes.',
]);

/**
 * Collect the token names of one tier from the Verdex token document, sorted for a deterministic
 * listing. A tier is an object keyed by token name; each value is a per-theme record.
 *
 * @param {object|undefined} tier
 * @returns {string[]}
 */
function tierNames(tier) {
  if (!tier || typeof tier !== 'object' || Array.isArray(tier)) return [];
  return Object.keys(tier).sort();
}

/**
 * Compose the instruction payload for verdex-form-builder from the engine-resolved references.
 *
 * @param {object} args
 * @param {Record<string, { resolvedPath: string|null, data: unknown }>} [args.references]
 * @param {object|null} [args.request]  recognises `request.formName` to name the form.
 * @returns {{ instructions: string, context: object|null, request: object|null }}
 */
export function composeInstruction({ references, request = null } = {}) {
  const tokens = references?.tokenHub?.data ?? null;
  const formName =
    typeof request?.formName === 'string' && request.formName.length > 0 ? request.formName : 'Form';

  const component = tierNames(tokens?.component);
  const semantic = tierNames(tokens?.semantic);

  const lines = [];
  lines.push(`# ${ARABIC_TITLE} — author the Verdex "${formName}" form`);
  lines.push('');
  lines.push(
    'Bind only Verdex --vx- tokens (component -> semantic -> primitive). Use logical CSS ' +
      'properties so the form mirrors correctly under the ar-SA RTL locale, and honour every WCAG ' +
      'constraint below across all four themes.',
  );
  lines.push('');
  lines.push('## WCAG constraints');
  lines.push(WCAG_CONSTRAINTS.map((c) => `- ${c}`).join('\n'));
  lines.push('');
  lines.push(`## Field-surface tokens (component tier, ${component.length})`);
  lines.push(
    component.length ? component.map((t) => `- ${t}`).join('\n') : '- (none defined in the active token set)',
  );
  lines.push('');
  lines.push(`## Semantic tokens (${semantic.length})`);
  lines.push(
    semantic.length ? semantic.map((t) => `- ${t}`).join('\n') : '- (none defined in the active token set)',
  );

  return {
    instructions: lines.join('\n'),
    context: {
      title: ARABIC_TITLE,
      tokenPath: references?.tokenHub?.resolvedPath ?? null,
      wcag: WCAG_CONSTRAINTS,
    },
    request,
  };
}
