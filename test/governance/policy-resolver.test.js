// Tests for the policy resolver (T-MVP-04).
//
// Covers the docs/13 decision algebra's worked cases (the meet lattice, ask-stickiness,
// deny-first, order-independence), the Layer-0 profile deny floor (consuming the T-MVP-03
// evaluator), the requiredTools clamp, the all-defer -> deny default, the T-HARD-11
// eligibility≠permission posture (["*"]-scoped skill with no project rule -> DENY), and that
// the resolver uses THE ONE shared matcher (T-HARD-04).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createPolicyResolver,
  policyResolver,
  meet,
  DECISION,
  PROFILES,
  subsumes,
} from '../../src/governance/index.js';

// Default requiredTools = ['*'] so the skill clamp DEFERS for every tool — this isolates the
// org/client/project layer behavior in the algebra tests. The clamp/gate and T-HARD-11 cases
// set requiredTools explicitly to exercise the gate. (Per the corrected Layer-4 semantics, an
// undeclared tool is denied by the skill gate; '*' declares all, so the gate defers.)
const R = (over = {}) => ({
  profile: PROFILES.CONVENIENCE,
  layers: {},
  requiredTools: ['*'],
  tool: 'Read',
  ...over,
});

// =====================================================================================
// The meet lattice (docs/13 §"Composition operator ⊓")
// =====================================================================================

test('meet is the stricter of two decisions; defer is identity, deny is top', () => {
  const { DENY, ASK, ALLOW, DEFER } = DECISION;
  // identity
  assert.equal(meet(DEFER, ALLOW), ALLOW);
  assert.equal(meet(DEFER, DEFER), DEFER);
  // top
  assert.equal(meet(DENY, ALLOW), DENY);
  assert.equal(meet(DENY, ASK), DENY);
  // ask is stickier than allow
  assert.equal(meet(ASK, ALLOW), ASK);
  assert.equal(meet(ALLOW, ALLOW), ALLOW);
});

test('meet is commutative (order-independent)', () => {
  const vals = Object.values(DECISION);
  for (const a of vals) for (const b of vals) {
    assert.equal(meet(a, b), meet(b, a), `${a},${b}`);
  }
});

// =====================================================================================
// Worked algebra cases from docs/13
// =====================================================================================

test('(org=ask, project=allow) -> ask (ask is sticky; a lower layer cannot downgrade it)', () => {
  const d = policyResolver.resolve(
    R({
      layers: {
        org: [{ pattern: 'Read', decision: 'ask' }],
        project: [{ pattern: 'Read', decision: 'allow' }],
      },
    }),
  );
  assert.equal(d, DECISION.ASK);
});

test('(allow, deny) -> deny and (ask, deny) -> deny (deny-first)', () => {
  assert.equal(
    policyResolver.resolve(
      R({ layers: { org: [{ pattern: 'Read', decision: 'allow' }], client: [{ pattern: 'Read', decision: 'deny' }] } }),
    ),
    DECISION.DENY,
  );
  assert.equal(
    policyResolver.resolve(
      R({ layers: { org: [{ pattern: 'Read', decision: 'ask' }], client: [{ pattern: 'Read', decision: 'deny' }] } }),
    ),
    DECISION.DENY,
  );
});

test('within one layer, a specific deny beats a broad allow (meet of all matching patterns)', () => {
  // A same-layer broad allow (`mcp__fs__*`) and a specific deny (`mcp__fs__delete`) both match
  // the call; the layer's decision is the meet (stricter) -> deny.
  const d = policyResolver.resolve(
    R({
      tool: 'mcp__fs__delete',
      requiredTools: ['mcp__fs__*'],
      layers: {
        org: [
          { pattern: 'mcp__fs__*', decision: 'allow' },
          { pattern: 'mcp__fs__delete', decision: 'deny' },
        ],
      },
    }),
  );
  assert.equal(d, DECISION.DENY);
});

// =====================================================================================
// requiredTools clamp (Layer 4) — never broadens
// =====================================================================================

test('requiring a tool does NOT loosen an upper-layer ask', () => {
  const d = policyResolver.resolve(
    R({
      requiredTools: ['Read'],
      layers: { org: [{ pattern: 'Read', decision: 'ask' }] },
    }),
  );
  assert.equal(d, DECISION.ASK, 'allow ⊓ ask = ask; the skill cannot raise to allow');
});

test('a tool the skill does NOT declare is DENIED even if an upper layer allows it (gate)', () => {
  // org allows Read, but the skill only declared Write -> the skill gate denies the undeclared
  // tool. A skill may not use a tool it did not declare.
  const d = policyResolver.resolve(
    R({ tool: 'Read', requiredTools: ['Write'], layers: { org: [{ pattern: 'Read', decision: 'allow' }] } }),
  );
  assert.equal(d, DECISION.DENY);
});

test('requiredTools alone (no upper allow) resolves to DENY (the clamp is not a grant)', () => {
  // skill declares the tool (gate defers), but no org/client/project allow -> all-defer -> deny.
  const d = policyResolver.resolve(R({ requiredTools: ['Read'], layers: {} }));
  assert.equal(d, DECISION.DENY);
});

test('declared tool + an org allow -> ALLOW (affirmative allow comes from a layer rule)', () => {
  const d = policyResolver.resolve(
    R({ requiredTools: ['Read'], layers: { org: [{ pattern: 'Read', decision: 'allow' }] } }),
  );
  assert.equal(d, DECISION.ALLOW);
});

// =====================================================================================
// All-defer default -> deny (silence is denial)
// =====================================================================================

test('every layer defers (no rule matches) -> DENY', () => {
  const d = policyResolver.resolve(R({ tool: 'SomethingNobodyMentioned', layers: {}, requiredTools: [] }));
  assert.equal(d, DECISION.DENY);
});

test('a malformed request (no tool) -> DENY (fail-closed)', () => {
  assert.equal(policyResolver.resolve(R({ tool: undefined })), DECISION.DENY);
  assert.equal(policyResolver.resolve(R({ tool: '' })), DECISION.DENY);
});

// =====================================================================================
// T-HARD-11 — eligibility ≠ permission
// =====================================================================================

test('T-HARD-11: a ["*"]-scoped skill that DECLARES the tool but has NO layer allow -> DENY', () => {
  // The resolver does not read scope (scope = eligibility). The skill is eligible everywhere
  // ("*"-scoped) AND declares the tool (gate defers) — yet with NO org/client/project allow
  // rule, the all-defer default DENIES. Eligibility ≠ permission; permission needs an
  // affirmative allow from a layer rule, which is absent here.
  const d = policyResolver.resolve(
    R({ tool: 'mcp__tracker__create', requiredTools: ['mcp__tracker__*'], layers: {} }),
  );
  assert.equal(d, DECISION.DENY);

  // Granting it requires an affirmative project (or org/client) allow:
  const allowed = policyResolver.resolve(
    R({
      tool: 'mcp__tracker__create',
      requiredTools: ['mcp__tracker__*'],
      layers: { project: [{ pattern: 'mcp__tracker__*', decision: 'allow' }] },
    }),
  );
  assert.equal(allowed, DECISION.ALLOW);
});

test('T-HARD-11/GOV-03: scope is NOT a resolver input — "*"=eligible-everywhere does not grant permission', () => {
  // The GOV-03 disambiguator made concrete: scope (the eligibility/firing question, docs/12) is
  // SEPARATE from permission (the per-call question, this resolver). The resolver signature carries
  // NO scope field — passing a maximally-broad scope cannot change the outcome, because the resolver
  // never reads it. A ["*"]-scoped skill with no layer allow is DENIED exactly like an unscoped one.
  const broadlyEligible = policyResolver.resolve(
    // a caller that (incorrectly) hopes scope grants reach — the extra key is simply ignored
    R({ tool: 'mcp__tracker__create', requiredTools: ['mcp__tracker__*'], layers: {}, scope: { clients: ['*'], projects: ['*'] } }),
  );
  assert.equal(broadlyEligible, DECISION.DENY, '"*" scope = not excluded by inventory, NOT permitted to act');

  // And the contrast in one place: identical request, the ONLY change is an affirmative project
  // rule — that, not scope, is what flips deny -> allow. Permission comes from a layer rule.
  const withProjectRule = policyResolver.resolve(
    R({
      tool: 'mcp__tracker__create',
      requiredTools: ['mcp__tracker__*'],
      layers: { project: [{ pattern: 'mcp__tracker__*', decision: 'allow' }] },
      scope: { clients: ['*'], projects: ['*'] },
    }),
  );
  assert.equal(withProjectRule, DECISION.ALLOW);
});

test('T-HARD-11: a NARROWLY-scoped skill is still PERMITTED when a layer rule allows (eligibility ⊉ permission, both directions)', () => {
  // The dual of the headline case: scope does not WITHHOLD permission either. A skill the inventory
  // scoped narrowly (e.g. one project) is, once eligible/firing here, governed purely by the
  // resolver — an affirmative org allow permits the call. Scope and permission are orthogonal axes.
  const d = policyResolver.resolve(
    R({
      tool: 'Read',
      requiredTools: ['Read'],
      layers: { org: [{ pattern: 'Read', decision: 'allow' }] },
      scope: { clients: ['acme'], projects: ['checkout'] },
    }),
  );
  assert.equal(d, DECISION.ALLOW);
});

// =====================================================================================
// Layer 0 — the deployment-profile deny floor (consumes the T-MVP-03 evaluator)
// =====================================================================================

test('Layer 0: a server-side tool under COMPLIANCE is denied as a pre-filter (nothing re-opens it)', () => {
  const d = policyResolver.resolve({
    profile: PROFILES.COMPLIANCE,
    tool: 'WebFetch',
    requiredTools: ['WebFetch'], // even a clamp-allow cannot re-open the floor
    layers: { org: [{ pattern: 'WebFetch', decision: 'allow' }], project: [{ pattern: '*', decision: 'allow' }] },
  });
  assert.equal(d, DECISION.DENY);
});

test('Layer 0: the same server-side tool under CONVENIENCE is not floored (flows into ⊓)', () => {
  const d = policyResolver.resolve({
    profile: PROFILES.CONVENIENCE,
    tool: 'WebFetch',
    requiredTools: ['WebFetch'],
    layers: { org: [{ pattern: 'WebFetch', decision: 'allow' }] },
  });
  assert.equal(d, DECISION.ALLOW);
});

test('Layer 0: a non-server-side tool defers at Layer 0 under both profiles', () => {
  for (const profile of [PROFILES.COMPLIANCE, PROFILES.CONVENIENCE]) {
    const d = policyResolver.resolve({
      profile,
      tool: 'Read',
      requiredTools: ['Read'],
      layers: { org: [{ pattern: 'Read', decision: 'allow' }] },
    });
    assert.equal(d, DECISION.ALLOW, `Read should be allowed under ${profile}`);
  }
});

test('Layer 0 is deny-first: a THROWING profile-evaluator floors a server-side tool to deny', () => {
  const thrower = { evaluate() { throw new Error('defect'); } };
  const resolver = createPolicyResolver({ profileEvaluator: thrower });
  const d = resolver.resolve({
    profile: PROFILES.COMPLIANCE,
    tool: 'WebSearch',
    requiredTools: ['WebSearch'],
    layers: { org: [{ pattern: '*', decision: 'allow' }] },
  });
  assert.equal(d, DECISION.DENY);
});

// =====================================================================================
// Shared matcher (T-HARD-04) — resolver uses subsumes/matches, the SAME as registry-lint
// =====================================================================================

test('the resolver matches prefix-* patterns exactly as the shared subsumes() does', () => {
  // subsumes is the matcher; a prefix rule must fire for a literal under it.
  assert.equal(subsumes('mcp__tracker__*', 'mcp__tracker__create'), true);
  const d = policyResolver.resolve(
    R({ tool: 'mcp__tracker__create', layers: { org: [{ pattern: 'mcp__tracker__*', decision: 'allow' }] } }),
  );
  assert.equal(d, DECISION.ALLOW);
  // and a non-matching prefix does not fire -> all-defer -> deny
  const d2 = policyResolver.resolve(
    R({ tool: 'mcp__other__x', layers: { org: [{ pattern: 'mcp__tracker__*', decision: 'allow' }] } }),
  );
  assert.equal(d2, DECISION.DENY);
});

test('a malformed rule decision is treated as deny (fail-closed)', () => {
  const d = policyResolver.resolve(
    R({ tool: 'Read', layers: { org: [{ pattern: 'Read', decision: 'maybe' }] } }),
  );
  assert.equal(d, DECISION.DENY);
});

// =====================================================================================
// Custom tool->feature classifier (Layer-0 mapping is data, overridable)
// =====================================================================================

test('a custom toolFeature classifier can floor an additional tool under compliance', () => {
  const resolver = createPolicyResolver({
    toolFeature: (tool) => (tool === 'CustomUpload' ? 'files-api' : null),
  });
  const d = resolver.resolve({
    profile: PROFILES.COMPLIANCE,
    tool: 'CustomUpload',
    requiredTools: ['CustomUpload'],
    layers: { org: [{ pattern: '*', decision: 'allow' }] },
  });
  assert.equal(d, DECISION.DENY, 'files-api forbidden under compliance -> floored');
});
