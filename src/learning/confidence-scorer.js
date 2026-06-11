// The instinct gate — when does an observed pattern become an instinct candidate?
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room).
//
// WHY THIS EXISTS. Not every solved pattern deserves promotion. A pattern seen once is a
// coincidence; a pattern seen repeatedly is an instinct. The scorer is the threshold that
// separates the two. The MVP score is the pattern's frequency (how many times the skill solved
// this), and a pattern crosses into "confident" at CONFIDENCE_THRESHOLD. This is deliberately
// simple and explainable — the reason string makes every verdict auditable for the operator who
// reviews the promoted candidate.

/** A pattern seen at least this many times is an instinct candidate. */
export const CONFIDENCE_THRESHOLD = 3;

/**
 * Score a mined pattern. The MVP score is the observation frequency; a pattern is "confident" once
 * it reaches CONFIDENCE_THRESHOLD.
 *
 * @param {{patternKey?: string, frequency?: number}} pattern  a record from minePatterns
 * @returns {{score: number, confident: boolean, reason: string}}
 */
export function scorePattern(pattern) {
  const frequency =
    pattern && typeof pattern.frequency === "number" && Number.isFinite(pattern.frequency)
      ? pattern.frequency
      : 0;
  const key = pattern && typeof pattern.patternKey === "string" ? pattern.patternKey : "(unknown)";
  const score = frequency;
  const confident = score >= CONFIDENCE_THRESHOLD;
  const reason = confident
    ? `pattern '${key}' observed ${score}× ≥ threshold ${CONFIDENCE_THRESHOLD}: instinct candidate`
    : `pattern '${key}' observed ${score}× < threshold ${CONFIDENCE_THRESHOLD}: not yet confident`;
  return { score, confident, reason };
}

/**
 * Keep only the patterns that scored as confident.
 *
 * @param {ReadonlyArray<object>} patterns  records from minePatterns
 * @returns {Array<object>}
 */
export function filterConfident(patterns) {
  if (!Array.isArray(patterns)) return [];
  return patterns.filter((pattern) => scorePattern(pattern).confident);
}
