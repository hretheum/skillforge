// Compose step for the competitive-platform-analysis instruction skill.
//
// Instruction skills produce a rendered prompt (SKILL.md + injected client context),
// not a file artifact. There are no adapters: the skill reads the client's
// competitive-context reference from the loader-resolved references map (already
// PARSED by the engine's resolveRefs edge — `references.competitiveContext.data`)
// and merges it with the static skill instructions.
//
// Clean-room: this file names no client. All client-specific data arrives through
// `references.competitiveContext` — a reference the loader resolves from the active
// client's config. The SKILL.md lives in packages/ecc-bundle/skills/ — the canonical
// location after migration to the @skillforge-core/ecc-bundle npm package.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));

/**
 * Compose the instruction payload for competitive-platform-analysis.
 *
 * @param {object} args
 * @param {Record<string, { ref: string, resolvedPath: string|null, local: boolean, data: unknown }>} args.references
 *        The engine-resolved references map for the active client — each entry's `data` is the
 *        already-parsed reference content (the filesystem read + JSON parse happened behind the
 *        engine's failure classifier, NOT here).
 * @param {object|null} [args.request]  Caller-supplied request context (optional).
 * @returns {{ instructions: string, context: object|null, request: object|null }}
 *          When no competitive context is resolved, `context` is null and the instructions carry
 *          the Brand Discovery interview (fresh-start mode).
 */
export function composeInstruction({ references, request = null } = {}) {
  // Read the SKILL.md at call time (not module load) so importing this file never fails in
  // environments where skills/ is absent (e.g. a test sandbox that copies only src/).
  const instructions = readFileSync(
    resolve(__dir, '../../../packages/ecc-bundle/skills/competitive-platform-analysis/SKILL.md'),
    'utf8',
  );
  const ref = references?.competitiveContext;
  if (!ref || ref.data == null) {
    // No competitive context resolved (reference absent, or the client has not yet registered a
    // competitive-context.json) → fresh-start interview mode. Append the Brand Discovery interview
    // and signal downstream with context:null that the context is to be COLLECTED, not read. A
    // reference that existed but is malformed fails earlier in resolveRefs, so it never lands here.
    const interview = readFileSync(
      resolve(__dir, '../../../packages/ecc-bundle/skills/competitive-platform-analysis/INTERVIEW.md'),
      'utf8',
    );
    return { instructions: `${instructions}\n\n${interview}`, context: null, request };
  }
  return { instructions, context: ref.data, request };
}
