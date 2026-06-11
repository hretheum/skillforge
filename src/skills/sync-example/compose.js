// Skill core — the "sync-example" COMPOSE step: a minimal BIDIRECTIONAL sync recipe that proves the
// `sync` skill kind is live end-to-end (descriptor → registry → executor gate + audit tap).
//
// Sources: concept + first principles, zero files from any third-party skills-factory codebase (clean-room).
//
// WHAT IT DOES. A bidirectional sync writes BOTH sides — here, one Write per direction. Compose
// composes the non-empty `intents` array the sync descriptor's validateOutput requires and the
// executor's gate fans out: each intent is a {tool, toolInput} the PreToolUse hook checks (and the
// generic audit tap records) before anything is applied. The intent shape mirrors the artifact /
// transformation kinds ({tool:'Write', toolInput:{file_path, content}}) so the same gate governs it.
//
// The request is DATA (a client handle + the two side identifiers — never a client identity baked
// into code); the description is the client's normalized data delivered by the input adapter.

import { SOURCE_KIND } from '../create-component/compose.js';

export const RESULT_KIND = 'frontend-component';
export { SOURCE_KIND };

/**
 * Compose the bidirectional sync intents from a sync request + a normalized description.
 *
 * @param {object} args
 * @param {object} args.request  { client, leftPath?, rightPath? } — DATA, names no client identity.
 * @param {object} [args.description]  the normalized design-system description from the input adapter.
 * @returns {{ intents: Array<{tool:string, toolInput:object}> }} the writes for BOTH sides.
 */
export function composeSync({ request, description } = {}) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new Error('sync-example request must be an object { client, leftPath?, rightPath? }');
  }
  const client = typeof request.client === 'string' && request.client.length > 0 ? request.client : 'client';
  const leftPath = typeof request.leftPath === 'string' ? request.leftPath : `${client}/sync-left.json`;
  const rightPath = typeof request.rightPath === 'string' ? request.rightPath : `${client}/sync-right.json`;

  // A real sync would diff the two sides; the proof writes a deterministic marker to each, carrying
  // the normalized source-kind so the artifact is traceable to the description it was synced from.
  const payload = JSON.stringify({ syncedFrom: description?.envelope?.kind ?? null, client });

  return {
    intents: [
      { tool: 'Write', toolInput: { file_path: leftPath, content: payload } },
      { tool: 'Write', toolInput: { file_path: rightPath, content: payload } },
    ],
  };
}
