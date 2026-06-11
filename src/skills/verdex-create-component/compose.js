// Skill core — the "verdex-create-component" COMPOSE step: an INSTRUCTION recipe that guides an
// agent to author a Verdex Financial component bound to the Verdex --vx- 3-tier token set.
//
// Sources: concept + first principles, zero files from any third-party skills-factory codebase
// (clean-room). See docs/p3-client-concept.md (Verdex) and docs/p3-corner-cases.md (CC-09).
//
// WHY ASYNC (CC-09). This compose is genuinely `async`: a regulated client assembles its token
// guidance from a resolved reference and may need to normalise it without blocking the engine. The
// executor now `await`s the compose step, so the returned Promise resolves to the instruction
// payload before validateOutput/emit ever see it — CC-09 is the corner case this skill proves
// closed. A synchronous compose still works (await on a non-Promise resolves to the value); this one
// is async by construction so the async path is exercised end-to-end.
//
// CLEAN-ROOM. This file names no client value: every --vx- token literal arrives as DATA through
// the engine-resolved `references.tokenHub`. The skill carries only the GENERIC recipe (how to
// describe a Verdex-conformant component) and the constraint vocabulary; the material is the
// client's.

/** The source-kind the Verdex token set is described as (mirrors the artifact family's design-system). */
export const SOURCE_KIND = 'design-system';

/** The four Verdex themes, in canonical order (semantic/component tiers re-bind per theme). */
const THEMES = ['light', 'dark', 'hc-light', 'hc-dark'];

/**
 * Collect the token names of one tier from the Verdex token document. A tier is an object keyed by
 * token name; each value is a per-theme record. Returns the names sorted for a deterministic listing
 * (no fixed-width assumption — names may exceed 40 chars).
 *
 * @param {object|undefined} tier  one of the document's tiers (primitive/semantic/component)
 * @returns {string[]} the token names in this tier, sorted
 */
function tierNames(tier) {
  if (!tier || typeof tier !== 'object' || Array.isArray(tier)) return [];
  return Object.keys(tier).sort();
}

/**
 * Report, per theme, which semantic tokens are intentionally `null` in that theme (a legal
 * "omit this property" state, CC-05). Deterministic ordering by theme then token name.
 *
 * @param {object|undefined} semantic  the semantic tier
 * @returns {Array<{ theme: string, token: string }>}
 */
function nullBindings(semantic) {
  const out = [];
  if (!semantic || typeof semantic !== 'object') return out;
  for (const theme of THEMES) {
    for (const token of Object.keys(semantic).sort()) {
      const perTheme = semantic[token];
      if (perTheme && typeof perTheme === 'object' && perTheme[theme] === null) {
        out.push({ theme, token });
      }
    }
  }
  return out;
}

/**
 * Compose the instruction payload for verdex-create-component from the engine-resolved references.
 * The Verdex token set arrives as `references.tokenHub.data` (the loader resolves + parses it);
 * compose names no token literal of its own.
 *
 * @param {object} args
 * @param {Record<string, { ref: string, resolvedPath: string|null, local: boolean, data: unknown }>} [args.references]
 *        The engine-resolved references map for the active (verdex) client.
 * @param {object|null} [args.request]  Caller-supplied request context (optional); recognises
 *        `request.componentName` to name the component in the guidance.
 * @returns {Promise<{ instructions: string, context: object|null, request: object|null }>}
 */
export async function composeInstruction({ references, request = null } = {}) {
  // Genuinely async: yield once so the async path is exercised even though the read below is local.
  // A real Verdex deployment might await a legal-content normaliser here (see §7 of the concept doc).
  await Promise.resolve();

  const tokens = references?.tokenHub?.data ?? null;
  const componentName =
    typeof request?.componentName === 'string' && request.componentName.length > 0
      ? request.componentName
      : 'Component';

  const primitive = tierNames(tokens?.primitive);
  const semantic = tierNames(tokens?.semantic);
  const component = tierNames(tokens?.component);
  const nulls = nullBindings(tokens?.semantic);

  const lines = [];
  lines.push(`# Author the Verdex "${componentName}" component`);
  lines.push('');
  lines.push(
    'Bind only Verdex --vx- tokens, resolving each through the tier chain ' +
      '(component -> semantic -> primitive). Resolve for the active theme; treat a null binding ' +
      'as "omit this property". Use logical CSS properties for RTL safety.',
  );
  lines.push('');
  lines.push(`## Component tokens (${component.length})`);
  lines.push(component.length ? component.map((t) => `- ${t}`).join('\n') : '- (none defined in the active token set)');
  lines.push('');
  lines.push(`## Semantic tokens (${semantic.length})`);
  lines.push(semantic.length ? semantic.map((t) => `- ${t}`).join('\n') : '- (none defined in the active token set)');
  lines.push('');
  lines.push(`## Primitive tokens (${primitive.length})`);
  lines.push(primitive.length ? primitive.map((t) => `- ${t}`).join('\n') : '- (none defined in the active token set)');
  lines.push('');
  lines.push('## Themes that omit a property (null binding)');
  lines.push(
    nulls.length
      ? nulls.map((n) => `- theme "${n.theme}": omit "${n.token}"`).join('\n')
      : '- (no null bindings in the active token set)',
  );

  return {
    instructions: lines.join('\n'),
    context: {
      tokenPath: references?.tokenHub?.resolvedPath ?? null,
      themes: THEMES,
      tierCounts: { primitive: primitive.length, semantic: semantic.length, component: component.length },
    },
    request,
  };
}
