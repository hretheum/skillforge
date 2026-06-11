// Compose step for the benchmark-methodology instruction skill.
//
// See src/skills/competitive-platform-analysis/compose.js for the pattern.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));

/**
 * Compose the instruction payload for benchmark-methodology.
 *
 * @param {object} args
 * @param {Record<string, { ref: string, resolvedPath: string|null, local: boolean, data: unknown }>} args.references
 *        The engine-resolved references map — each entry's `data` is already-parsed content.
 * @param {object|null} [args.request]
 * @returns {{ instructions: string, context: object, request: object|null }}
 */
export function composeInstruction({ references, request = null } = {}) {
  const instructions = readFileSync(
    resolve(__dir, '../../../packages/ecc-bundle/skills/benchmark-methodology/SKILL.md'),
    'utf8',
  );
  const ref = references?.competitiveContext;
  if (!ref || ref.data == null) {
    throw new Error(
      'benchmark-methodology: client config is missing a "competitiveContext" reference',
    );
  }
  return { instructions, context: ref.data, request };
}
