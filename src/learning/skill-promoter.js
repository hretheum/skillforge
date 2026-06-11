// The promotion gate — how an instinct earns a SKILL_CANDIDATE.md in learned/ for operator review
//.
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room).
//
// WHY THIS EXISTS. A confident pattern is still untrusted CODE the moment it becomes a skill
// manifest: a learned candidate enters the same config surface a third-party skill would, so it
// must pass the SAME pre-adoption gate (supply-chain-scan.js §scanSkillManifest) before it lands.
// This module is that gate plus the writer: it refuses to promote anything whose manifest text
// does not scan clean, and on a pass it writes a SKILL_CANDIDATE.md into learned/ — a CANDIDATE,
// never an active skill. Promotion is to the operator's review queue, not to production; the
// origin: 'learned' frontmatter marks it as machine-mined for that review.
//
// OPERATOR-GATED. learned/ is a staging area. Writing here grants nothing — an operator reads the
// candidate, its evidence, and the scan result, and decides. The scan-clean precondition is
// fail-closed: a dirty or unreadable scan blocks the write (matching supply-chain-scan's posture).
//
// INJECTABLE I/O. fs + mkdir are injectable so the loop is unit-testable without touching disk
// (the end-to-end test drives a clean promotion through an in-memory fs).

import { promises as nodeFs } from "node:fs";
import path from "node:path";

/** The staging directory for machine-mined skill candidates awaiting operator review. */
export const LEARNED_DIR = "learned";

/**
 * Render the SKILL_CANDIDATE.md body for a promoted pattern. Frontmatter carries the provenance
 * (origin: 'learned'), the confidence score, and the evidence (the session timestamps that mined
 * the pattern); the body describes the pattern in human-readable form for the reviewing operator.
 */
function renderCandidate(pattern, score) {
  const evidenceTimestamps = Array.isArray(pattern.evidence)
    ? pattern.evidence
        .map((obs) => (obs && typeof obs.timestamp === "string" ? obs.timestamp : ""))
        .filter((ts) => ts.length > 0)
    : [];
  const evidenceLines = evidenceTimestamps.map((ts) => `  - ${ts}`).join("\n");
  const skillName = typeof pattern.skillName === "string" ? pattern.skillName : "(unknown)";
  const toolName = pattern.patternKey?.split(":").slice(1).join(":") || "(unknown)";

  return `---
name: ${pattern.patternKey}
origin: learned
confidence: ${score}
evidence:
${evidenceLines}
---

# Learned skill candidate: ${pattern.patternKey}

This candidate was mined by the continuous-learning loop from the audit trail. The skill
\`${skillName}\` repeatedly resolved a pattern using the tool \`${toolName}\` (observed ${score}×
across ${evidenceTimestamps.length} session timestamp(s)).

**Status:** awaiting operator review. This is a CANDIDATE, not an active skill. Promotion to
production requires an operator to read this candidate, its evidence, and the supply-chain scan
result, then accept it.
`;
}

/**
 * Promote a confident pattern to a SKILL_CANDIDATE.md in learned/ — but only if its manifest text
 * scans clean. The supply-chain scan is the precondition: a learned candidate is untrusted code
 * entering the config surface, so it must pass scanSkillManifest exactly as a third-party skill
 * would.
 *
 * @param {object} pattern  a mined+scored pattern { skillName, patternKey, frequency, evidence }
 * @param {{clean: boolean, findings?: Array<{type: string, detail: string}>}} scanResult
 *        the result of scanSkillManifest(candidateText) — only clean === true promotes
 * @param {object} [opts]
 * @param {object} [opts.fs]      injectable fs/promises (default: node:fs/promises)
 * @param {Function} [opts.mkdir] injectable mkdir (default: node:fs/promises.mkdir)
 * @param {string} [opts.dir]     target directory (default: LEARNED_DIR)
 * @returns {Promise<{promoted: boolean, path: string|null, reason: string}>}
 */
export async function promoteToLearned(pattern, scanResult, opts = {}) {
  const fs = opts.fs || nodeFs;
  const mkdir = opts.mkdir || fs.mkdir || nodeFs.mkdir;
  const dir = typeof opts.dir === "string" && opts.dir.length > 0 ? opts.dir : LEARNED_DIR;

  if (!pattern || typeof pattern !== "object" || typeof pattern.patternKey !== "string") {
    return { promoted: false, path: null, reason: "invalid pattern: missing patternKey" };
  }

  // Fail-closed: a missing or non-clean scan blocks promotion. A learned candidate is untrusted
  // code; it earns a place in learned/ only by passing the same pre-adoption gate as any skill.
  if (!scanResult || scanResult.clean !== true) {
    const findings = Array.isArray(scanResult?.findings)
      ? scanResult.findings.map((f) => f.detail).join("; ")
      : "no scan result";
    return {
      promoted: false,
      path: null,
      reason: "supply-chain scan failed: " + findings,
    };
  }

  const score = typeof pattern.frequency === "number" ? pattern.frequency : 0;
  const body = renderCandidate(pattern, score);
  // patternKey is `${skill}:${tool}`; ":" is unsafe in a filename, so flatten to a safe slug.
  const fileName = `${pattern.patternKey.replace(/[^a-zA-Z0-9._-]+/g, "_")}.md`;
  const target = path.join(dir, fileName);

  await mkdir(dir, { recursive: true });
  await fs.writeFile(target, body, "utf8");

  return {
    promoted: true,
    path: target,
    reason: `promoted '${pattern.patternKey}' to learned/ (confidence ${score})`,
  };
}
