// Compose step for the brand-discovery instruction skill.
//
// Fresh start (state.session is null or brandState reference is absent): appends
// BOOTSTRAP.md and returns context:{ statePath } so the skill knows where to
// write the initialized state after the setup interview.
// Resume: passes the parsed state.json as context so the skill can orient itself
// and read the current module file before asking any questions.
//
// Clean-room: this file names no client. All client-specific data arrives through
// `references.brandState` — a reference the loader resolves from the active
// client's config.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));

/**
 * Compose the instruction payload for brand-discovery.
 *
 * @param {object} args
 * @param {Record<string, { ref: string, resolvedPath: string|null, local: boolean, data: unknown }>} args.references
 *        The engine-resolved references map for the active client.
 * @param {object|null} [args.request]  Caller-supplied request context (optional).
 *        Recognizes `request.participant` for multi-founder mode and `request.phase`.
 * @returns {{ instructions: string, context: object|null, request: object|null }}
 *          Fresh start: context carries only `statePath`; instructions include BOOTSTRAP.md.
 *          Resume: context carries full state, participant, and phase.
 */
export function composeInstruction({ references, request = null } = {}) {
  const instructions = readFileSync(
    resolve(__dir, '../../../packages/ecc-bundle/skills/brand-discovery/SKILL.md'),
    'utf8',
  );
  const ref = references?.brandState;
  const state = ref?.data ?? null;
  // Fresh start: reference absent, file unreadable, or session sentinel is null.
  const isFreshStart = !state || state.session == null;
  if (isFreshStart) {
    const bootstrap = readFileSync(
      resolve(__dir, '../../../packages/ecc-bundle/skills/brand-discovery/BOOTSTRAP.md'),
      'utf8',
    );
    return {
      instructions: `${instructions}\n\n${bootstrap}`,
      context: { statePath: ref?.resolvedPath ?? null },
      request,
    };
  }
  return {
    instructions,
    context: {
      state,
      participant: request?.participant ?? null,
      phase: request?.phase ?? 'discovery',
    },
    request,
  };
}
