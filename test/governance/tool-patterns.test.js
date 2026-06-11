// Tests for THE ONE MATCHER (T-HARD-04) — docs/13-tool-governance.md §"Tool-pattern
// matching and subsumption" (GOV-05).
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room). See docs/13-tool-governance.md, docs/12-skill-manifest-and-registry.md.
//
// Two guarantees the T-HARD-04 acceptance asks for:
//   1. SUBSUMPTION LAWS — the matcher implements the `literal ⊂ prefix-* ⊂ *` algebra exactly:
//      a partial order (reflexive, antisymmetric, transitive) with the documented broadening
//      edges and — load-bearing for "no broadening" — the sibling-namespace cases that must NOT
//      match (the `*` cut after the literal prefix text, e.g. `mcp__tracker__*` ⊉ `mcp__trackerX`).
//   2. RESOLVER ↔ LINT AGREEMENT — the resolver's per-call pattern path and registry-lint's
//      allow-list/override path reach the SAME verdict on every shared pattern case, BECAUSE they
//      consume one matcher. Proven two ways: (a) function identity — both modules re-export the
//      exact same `subsumes`; (b) behavioral — a shared corpus run through both consumers' public
//      surfaces yields identical answers, with non-vacuity (the corpus contains both hits + misses).

import { test } from 'node:test';
import assert from 'node:assert/strict';

// The matcher's home (engine src) — the single copy.
import { subsumes, matches } from '../../src/governance/tool-patterns.js';
// Re-export from the governance index (the resolver's import surface).
import { subsumes as subsumesViaGovIndex } from '../../src/governance/index.js';
// Re-export from registry-lint (the CI linter's surface).
import { subsumes as subsumesViaLint } from '../../tools/registry-lint.js';
// The resolver — its pattern path must agree with the matcher on which rules fire.
import { createPolicyResolver, DECISION, PROFILES } from '../../src/governance/index.js';

// =====================================================================================
// 1. Subsumption laws — the `literal ⊂ prefix-* ⊂ *` partial order (GOV-05)
// =====================================================================================

// `subsumes(b, a)` answers "does b subsume a?" i.e. `a ⊑ b` (every tool matching a matches b).

test('the documented order: literal ⊑ prefix-* ⊑ * (and strictly so)', () => {
  // mcp__tracker__create ⊑ mcp__tracker__* ⊑ *
  assert.equal(subsumes('mcp__tracker__*', 'mcp__tracker__create'), true, 'literal ⊑ prefix-*');
  assert.equal(subsumes('*', 'mcp__tracker__*'), true, 'prefix-* ⊑ *');
  assert.equal(subsumes('*', 'mcp__tracker__create'), true, 'literal ⊑ * (transitive)');
  // strictness: the broader never subsumes-down to the narrower
  assert.equal(subsumes('mcp__tracker__create', 'mcp__tracker__*'), false, 'literal cannot subsume a prefix-*');
  assert.equal(subsumes('mcp__tracker__*', '*'), false, 'prefix-* cannot subsume *');
  assert.equal(subsumes('Read', '*'), false, 'literal cannot subsume *');
});

test('reflexivity: every pattern subsumes itself (A ⊑ A)', () => {
  for (const p of ['*', 'mcp__tracker__*', 'mcp__*', 'Read', 'mcp__tracker__create']) {
    assert.equal(subsumes(p, p), true, `${p} ⊑ ${p}`);
  }
});

test('antisymmetry: distinct patterns are never mutually subsuming (A⊑B & B⊑A ⇒ A=B)', () => {
  const pats = ['*', 'mcp__*', 'mcp__tracker__*', 'mcp__tracker__create', 'Read', 'Write'];
  for (const a of pats) {
    for (const b of pats) {
      if (a === b) continue;
      assert.ok(!(subsumes(a, b) && subsumes(b, a)), `${a} and ${b} must not be mutually subsuming`);
    }
  }
});

test('transitivity: A⊑B and B⊑C ⇒ A⊑C', () => {
  // a small lattice slice: literal < two nested prefixes < *
  const pats = ['mcp__tracker__create', 'mcp__tracker__*', 'mcp__*', '*'];
  for (const a of pats) {
    for (const b of pats) {
      for (const c of pats) {
        if (subsumes(b, a) && subsumes(c, b)) {
          assert.equal(subsumes(c, a), true, `${a}⊑${b}⊑${c} ⇒ ${a}⊑${c}`);
        }
      }
    }
  }
});

test('nested prefixes subsume correctly (mcp__* ⊒ mcp__tracker__* ⊒ literal)', () => {
  assert.equal(subsumes('mcp__*', 'mcp__tracker__*'), true);
  assert.equal(subsumes('mcp__*', 'mcp__tracker__create'), true);
  assert.equal(subsumes('mcp__tracker__*', 'mcp__*'), false, 'the narrower prefix cannot subsume the wider one');
});

test('NO BROADENING across sibling namespaces — the `*` cuts after the literal prefix TEXT', () => {
  // The prefix of `mcp__tracker__*` is the literal string `mcp__tracker__`. A name that merely
  // starts with `mcp__tracker` but diverges before the boundary is a DIFFERENT tool and MUST NOT
  // match — otherwise a `tracker` allow would silently cover `tracker2`/`trackerX` (broadening).
  assert.equal(subsumes('mcp__tracker__*', 'mcp__tracker2__x'), false);
  assert.equal(subsumes('mcp__tracker__*', 'mcp__track__delete'), false);
  assert.equal(matches('mcp__tracker__*', 'mcp__trackerX'), false, 'no `__` boundary → not under the prefix');
  // and the exact-boundary children DO match
  assert.equal(matches('mcp__tracker__*', 'mcp__tracker__create'), true);
  assert.equal(matches('mcp__tracker__*', 'mcp__tracker__'), true, 'empty suffix is still under the prefix');
});

test('a literal pattern matches only its identical tool (no fuzzy prefix on literals)', () => {
  assert.equal(matches('Read', 'Read'), true);
  assert.equal(matches('Read', 'ReadFile'), false, 'literal Read does not prefix-match ReadFile');
  assert.equal(matches('Read', 'Write'), false);
});

test('`*` matches/subsumes everything (the top of the order)', () => {
  for (const t of ['Read', 'mcp__tracker__create', 'anything-at-all', 'mcp__x__y__z']) {
    assert.equal(matches('*', t), true, `* should match ${t}`);
  }
  assert.equal(subsumes('*', '*'), true);
});

test('matches(pattern, tool) == subsumes(pattern, tool) — matches is the named-for-intent alias', () => {
  const probes = [
    ['*', 'Read'],
    ['mcp__tracker__*', 'mcp__tracker__create'],
    ['mcp__tracker__*', 'mcp__trackerX'],
    ['Read', 'Read'],
    ['Read', 'Write'],
  ];
  for (const [p, t] of probes) {
    assert.equal(matches(p, t), subsumes(p, t), `${p} vs ${t}`);
  }
});

// =====================================================================================
// 2a. Function IDENTITY — resolver and lint import the SAME matcher (cannot drift)
// =====================================================================================

test('THE ONE MATCHER: resolver-surface, lint-surface, and home all export the SAME function', () => {
  // Object identity (===) proves there is one copy, re-exported — not two implementations that
  // merely happen to agree today. A future divergent reimplementation would break this.
  assert.equal(subsumesViaGovIndex, subsumes, 'governance index re-exports the home subsumes');
  assert.equal(subsumesViaLint, subsumes, 'registry-lint re-exports the home subsumes');
  assert.equal(subsumesViaGovIndex, subsumesViaLint, 'resolver-side and lint-side are one function');
});

// =====================================================================================
// 2b. BEHAVIORAL AGREEMENT — resolver pattern path == lint pattern path on a shared corpus
// =====================================================================================

// A shared corpus of (rulePattern, concreteTool) cases spanning literal/prefix-*/* and the
// sibling-namespace non-matches. Used to drive BOTH consumers' public surfaces.
const CORPUS = [
  // [ rulePattern, concreteTool, shouldFire ]
  ['*', 'Read', true],
  ['*', 'mcp__tracker__create', true],
  ['mcp__tracker__*', 'mcp__tracker__create', true],
  ['mcp__tracker__*', 'mcp__tracker__read', true],
  ['mcp__tracker__*', 'mcp__tracker2__x', false], // sibling namespace — must NOT fire
  ['mcp__tracker__*', 'mcp__trackerX', false], // no boundary — must NOT fire
  ['mcp__tracker__*', 'mcp__other__x', false],
  ['mcp__*', 'mcp__tracker__create', true],
  ['Read', 'Read', true],
  ['Read', 'Write', false],
  ['Read', 'ReadFile', false],
];

// Non-vacuity: the corpus exercises BOTH outcomes (otherwise an all-true matcher would pass).
test('the agreement corpus is non-vacuous (contains both firing and non-firing cases)', () => {
  assert.ok(CORPUS.some(([, , fire]) => fire === true), 'corpus has firing cases');
  assert.ok(CORPUS.some(([, , fire]) => fire === false), 'corpus has non-firing cases');
});

// The resolver's pattern path: with a single org rule `{pattern, decision: allow}` and the skill
// declaring `*` (so the Layer-4 gate defers), the resolver returns ALLOW iff the org pattern FIRES
// for the tool, else DENY (all-defer default). So resolver-fires == (verdict === allow). The
// CONVENIENCE profile keeps Layer 0 out of the way (no residency floor).
const resolver = createPolicyResolver();
function resolverFires(pattern, tool) {
  const d = resolver.resolve({
    profile: PROFILES.CONVENIENCE,
    tool,
    requiredTools: ['*'], // declare all → the skill gate defers; isolates the org pattern path
    layers: { org: [{ pattern, decision: 'allow' }] },
  });
  if (d === DECISION.ALLOW) return true;
  if (d === DECISION.DENY) return false;
  throw new Error(`unexpected resolver decision ${d} for (${pattern}, ${tool})`);
}

// The lint's pattern path: a requiredTool `tool` is WITHIN an allow-list of one pattern iff that
// pattern subsumes the tool — the exact same matcher question, from registry-lint's surface.
function lintFires(pattern, tool) {
  return subsumesViaLint(pattern, tool);
}

test('resolver pattern path and registry-lint pattern path AGREE on every corpus case', () => {
  for (const [pattern, tool, shouldFire] of CORPUS) {
    const rf = resolverFires(pattern, tool);
    const lf = lintFires(pattern, tool);
    // both consumers agree with each other...
    assert.equal(rf, lf, `disagreement on (${pattern}, ${tool}): resolver=${rf} lint=${lf}`);
    // ...and both agree with the documented expectation (anchors the agreement to the right answer)
    assert.equal(rf, shouldFire, `resolver wrong on (${pattern}, ${tool})`);
    assert.equal(lf, shouldFire, `lint wrong on (${pattern}, ${tool})`);
  }
});

test('agreement extends to override-tighten subsumption (lint) vs resolver firing', () => {
  // registry-lint's tighten-only check asks `subsumes(base, override)`; the resolver asks
  // `subsumes(rule, call)`. Both are the same matcher, so an override pattern that the lint deems
  // "within base" is exactly one the resolver would let the base rule cover. Spot-check the
  // load-bearing direction: a narrower override is within a broader base; the reverse is not.
  assert.equal(subsumesViaLint('mcp__tracker__*', 'mcp__tracker__create'), true, 'narrower override ⊑ base');
  assert.equal(subsumesViaLint('mcp__tracker__create', 'mcp__tracker__*'), false, 'broader override ⊄ base');
});
