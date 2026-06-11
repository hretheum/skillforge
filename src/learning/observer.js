// The background observer — the Stop-hook pattern (ECC v1): mine solved patterns from a session's
// observation stream.
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room).
//
// WHY THIS EXISTS. A learning loop needs a place where the per-session observation stream
// accumulates and is then drained at a session boundary (the Stop hook). The observer is that
// buffer: it ingests audit entries as they arrive (observe), exposes a read-only snapshot
// (observations), and is drained-and-reset at the Stop hook (flush). minePatterns is the pure
// grouping step that turns a flat observation list into per-skill solved-pattern records with a
// frequency — the input the confidence scorer ranks.
//
// MEMBRANE. The observer holds OBSERVATIONS (secret-free projections of audit entries), never raw
// tool inputs or session content. It adds no new fields; it only buffers and groups what
// observation-schema already projected secret-free.

import { extractObservations } from "./observation-schema.js";

/**
 * Create a background observer over a session's audit stream.
 *
 * @param {object} [opts]  reserved for future tuning (kept for a stable signature)
 * @returns {{ observe: (entry: object) => void, flush: () => Array<object>, observations: () => ReadonlyArray<object> }}
 */
export function createObserver(opts = {}) {
  void opts;
  let buffer = [];

  return {
    /** Ingest one audit entry; learning-relevant observations are appended to the buffer. */
    observe(entry) {
      const extracted = extractObservations([entry]);
      for (const obs of extracted) buffer.push(obs);
    },

    /** Drain the buffer: return everything accumulated and reset (the Stop hook fires this). */
    flush() {
      const drained = buffer;
      buffer = [];
      return drained;
    },

    /** A read-only snapshot of the current buffer (does not drain). */
    observations() {
      return buffer.slice();
    },
  };
}

/**
 * A stable key for a skill's solved pattern. The MVP key is the (skill, tool) pair — the unit of a
 * "this skill repeatedly solved this with this tool" pattern. Stable across sessions so the
 * frequency the scorer reads accumulates against the same key.
 *
 * @param {string} skillName
 * @param {string} toolName
 * @returns {string}
 */
function patternKeyFor(skillName, toolName) {
  return `${skillName}:${toolName}`;
}

/**
 * Group observations into per-skill solved-pattern records. Each distinct (skillName, toolName)
 * pair becomes one pattern with its observation frequency and the evidence that produced it.
 *
 * @param {ReadonlyArray<object>} observations  observations from extractObservations / the observer
 * @returns {Array<{skillName: string, patternKey: string, frequency: number, evidence: Array<object>}>}
 */
export function minePatterns(observations) {
  if (!Array.isArray(observations)) return [];
  const byKey = new Map();
  for (const obs of observations) {
    if (!obs || typeof obs !== "object") continue;
    const skillName = typeof obs.skillName === "string" ? obs.skillName : "";
    const toolName = typeof obs.toolName === "string" ? obs.toolName : "";
    if (skillName.length === 0 || toolName.length === 0) continue;
    const patternKey = patternKeyFor(skillName, toolName);
    let record = byKey.get(patternKey);
    if (!record) {
      record = { skillName, patternKey, frequency: 0, evidence: [] };
      byKey.set(patternKey, record);
    }
    record.frequency += 1;
    record.evidence.push(obs);
  }
  return [...byKey.values()];
}
