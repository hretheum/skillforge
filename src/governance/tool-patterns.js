// Tool-pattern subsumption — docs/13-tool-governance.md §"Tool-pattern matching and
// subsumption" (GOV-05).
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room). See docs/13-tool-governance.md.
//
// THE ONE MATCHER (T-HARD-04). Both the policy resolver (src/governance/policy-resolver.js)
// and registry-lint (tools/registry-lint.js) MUST reason about tool patterns with the SAME
// subsumption logic — otherwise the resolver and the CI broaden-check could disagree on a
// pattern, the classic source of authorization bugs the audit flagged. So the matcher lives
// here in engine src as the single copy; registry-lint re-exports it, the resolver imports it.
// This also keeps the dependency direction sane (engine src does not import from a CI script).
//
// The subsumption order (docs/13):
//
//     literal  ⊂  prefix-*  ⊂  *
//
// A pattern A is "subsumed by" B (written A ⊑ B) iff every concrete tool that matches A also
// matches B — i.e. B is broader-or-equal. `subsumes(b, a)` answers "does b subsume a?" (a ⊑ b).

/**
 * Does pattern `b` subsume pattern `a` (a ⊑ b)?
 *
 * @param {string} b the (candidate broader) pattern
 * @param {string} a the (candidate narrower) pattern
 * @returns {boolean} true iff every tool matching `a` also matches `b`
 */
export function subsumes(b, a) {
  if (b === '*') return true; // * subsumes everything
  if (b.endsWith('*')) {
    const prefix = b.slice(0, -1);
    if (a === '*') return false; // * is broader than any prefix-*
    if (a.endsWith('*')) return a.slice(0, -1).startsWith(prefix); // narrower-or-equal prefix
    return a.startsWith(prefix); // literal under the prefix
  }
  // b is a literal: only an identical literal is ⊑ it
  return a === b;
}

/**
 * Does a concrete tool call `tool` match a rule `pattern`? A call matches iff the pattern
 * subsumes the (literal) call. This is `subsumes(pattern, tool)` with the intent named for
 * resolver readability ("which layer rules fire for this call").
 *
 * @param {string} pattern a rule pattern (literal, prefix-*, or *)
 * @param {string} tool a concrete tool name (treated as a literal)
 * @returns {boolean}
 */
export function matches(pattern, tool) {
  return subsumes(pattern, tool);
}
