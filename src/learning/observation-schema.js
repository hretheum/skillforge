// The observation substrate — what audit-trail events feed the learner.
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room). Realizes docs/13-tool-governance.md §"PostToolUse → telemetry /
// audit" read in reverse: the SAME secret-free audit entries that prove "no out-of-scope tool
// ran" are also the only trustworthy record of what DID run successfully — the raw material a
// continuous-learning loop mines for repeated, solved patterns.
//
// WHY THIS EXISTS. SFG skills are static; they never improve from usage. The audit trail
// (audit-trail.js) already records, secret-free, every (skill, tool, decision, scope) fact at the
// gate. That stream is the observation substrate: a pattern a skill solves over and over is
// visible here without any new instrumentation. This module is the narrow projection of an
// AuditEntry onto the fields the learner needs — and the filter that keeps only learning-relevant
// events (a successfully-allowed tool use under a named skill).
//
// SECRET-FREE BY CONSTRUCTION. We only ever read fields the audit trail already guarantees are
// secret-free (resource NAMES + the decision + the scope handles). We add nothing the trail did
// not already scan, so the projection inherits the trail's secret-free property.

/** The observation event classes the learner distinguishes. */
export const OBSERVATION_EVENT = Object.freeze({
  TOOL_USE: "tool_use",
  SKILL_RESOLUTION: "skill_resolution",
  GOVERNANCE_DECISION: "governance_decision",
  ERROR: "error",
});

/**
 * A frozen descriptor of the observation shape — for documentation and shallow validation. An
 * observation is the secret-free projection of one audit entry onto the learner's interest.
 */
export const OBSERVATION_SCHEMA = Object.freeze({
  event: "one of OBSERVATION_EVENT",
  skillName: "the skill that ran (a name) | null",
  toolName: "the tool that was called (a name) | null",
  decision: "the resolver verdict (allow|ask|deny) | null",
  timestamp: "the ISO timestamp of the audit entry",
});

/**
 * Classify one audit entry into an observation event. Only an ALLOW under a named skill+tool is a
 * learning signal (a pattern that was actually solved). ASK/DENY are governance decisions; an
 * entry without a usable skill is not attributable to a skill and is dropped upstream.
 *
 * @param {object} entry  an AuditEntry from audit-trail.js
 * @returns {string|null} an OBSERVATION_EVENT, or null if the entry is not learning-relevant
 */
function classify(entry) {
  if (!entry || typeof entry !== "object") return null;
  if (entry.decision === "ask" || entry.decision === "deny") {
    return OBSERVATION_EVENT.GOVERNANCE_DECISION;
  }
  if (entry.decision === "allow") return OBSERVATION_EVENT.TOOL_USE;
  return null;
}

/**
 * Project an array of audit entries onto the learner's observation stream, keeping only the events
 * relevant for learning: successful (allowed) tool uses attributable to a named skill. Governance
 * decisions (ask/deny) and entries lacking a usable skill/tool name are filtered out — the learner
 * promotes from what WORKED, never from what was blocked.
 *
 * @param {ReadonlyArray<object>} auditEntries  entries from AuditTrail.entries()
 * @returns {Array<{event: string, skillName: string, toolName: string, decision: string, timestamp: string}>}
 */
export function extractObservations(auditEntries) {
  if (!Array.isArray(auditEntries)) return [];
  const observations = [];
  for (const entry of auditEntries) {
    const event = classify(entry);
    if (event !== OBSERVATION_EVENT.TOOL_USE) continue;
    const skillName = typeof entry.skill === "string" ? entry.skill : "";
    const toolName = typeof entry.tool === "string" ? entry.tool : "";
    if (skillName.length === 0 || toolName.length === 0) continue;
    observations.push({
      event,
      skillName,
      toolName,
      decision: entry.decision,
      timestamp: typeof entry.at === "string" ? entry.at : "",
    });
  }
  return observations;
}
