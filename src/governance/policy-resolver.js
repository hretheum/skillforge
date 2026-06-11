// The policy resolver — docs/13-tool-governance.md §"decision algebra" + §"Layer 0 — the
// deployment-profile deny floor".
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room). See docs/13-tool-governance.md, docs/14-deployment-profiles.md.
//
// A small, data-driven, model-independent function
//
//     resolve(profile, skill, client, project, tool) -> allow | ask | deny
//
// that composes five layers DENY-FIRST via the decision lattice. It is the per-call tool
// authority (the PreToolUse hook of T-MVP-05 hosts it) and the sibling of the profile-
// evaluator (T-MVP-03), which it CONSUMES as Layer 0. The resolver runs without a model and
// can be replayed as a CI dry-run.
//
// DESIGN INVARIANTS (docs/13):
//   * Lattice:  deny > ask > allow,  with `defer` as the identity (a layer that says nothing
//     never tightens or loosens). Composition is the MEET `⊓` = "take the stricter".
//   * Order-independence: `⊓` is associative + commutative, so folding order is irrelevant.
//     The single asymmetry is Layer 0, evaluated as a PRE-FILTER (a residency floor that must
//     hold regardless of what the tool layers say, and must be cheap + first).
//   * Layer 4 (skill `requiredTools`) is a CLAMP/GATE, never a permission grant. Reconciling
//     docs/13 §Layer-4 with T-HARD-11 (the later hardening that wins where they tension):
//       - a tool the skill does NOT require -> `deny` (a skill may not use a tool it did not
//         declare — the clamp removes undeclared tools);
//       - a tool the skill DOES require    -> `defer` (it does not itself grant permission;
//         it lets org/client/project decide).
//     So requiring a tool NEVER loosens the upper layers (defer is the identity), and the
//     "affirmative allow" T-HARD-11 demands must come from an org/client/project rule — the
//     requiredTools clamp alone can only narrow toward deny.
//   * Default when every layer DEFERS: `deny`. Silence is denial (least privilege).
//   * T-HARD-11 (eligibility ≠ permission): scope decides whether a skill is ELIGIBLE in a
//     context; the resolver decides PERMISSION. A `["*"]`-scoped skill is eligible everywhere,
//     but a tool call still needs an affirmative allow from this chain — so a `["*"]`-scoped
//     skill that requires the tool but has NO org/client/project allow rule resolves to DENY
//     (skill clamp = defer, all upper layers defer -> all-defer default -> deny). The resolver
//     does not read scope; it gates permission only.
//   * THE ONE MATCHER (T-HARD-04): tool-pattern matching is imported from
//     ./tool-patterns.js — the same `subsumes` registry-lint uses. Never reimplemented here.

import { matches } from './tool-patterns.js';
import { profileEvaluator as defaultProfileEvaluator, isAllowed } from './profile-evaluator.js';

// --- the decision lattice ---------------------------------------------------------------

/** The four per-layer outcomes. `defer` is internal-only; the final output is never `defer`. */
export const DECISION = Object.freeze({
  DENY: 'deny',
  ASK: 'ask',
  ALLOW: 'allow',
  DEFER: 'defer',
});

// Strictness rank: higher = stricter. `defer` is the loosest (identity for the meet).
const RANK = Object.freeze({
  [DECISION.DEFER]: 0,
  [DECISION.ALLOW]: 1,
  [DECISION.ASK]: 2,
  [DECISION.DENY]: 3,
});

/**
 * The meet `⊓`: the stricter (higher-ranked) of two decisions. Associative + commutative, so
 * the fold order does not matter (docs/13). `defer ⊓ X = X` (identity); `deny ⊓ X = deny` (top).
 * @param {string} a @param {string} b @returns {string}
 */
export function meet(a, b) {
  return RANK[a] >= RANK[b] ? a : b;
}

/** Fold a list of decisions with the meet. Empty list = `defer` (the identity). */
function meetAll(decisions) {
  return decisions.reduce(meet, DECISION.DEFER);
}

// --- layer rule shape -------------------------------------------------------------------
//
// A LAYER is a list of { pattern, decision } rules over tool patterns. A layer's decision for
// a given tool is the MEET of every matching rule's decision (so a same-layer specific
// `Bash(rm -rf *) = deny` beats a broad `Bash(*) = allow`). A layer that matches nothing
// returns `defer`.

/**
 * Evaluate one layer (a rule list) for a concrete tool.
 * @param {Array<{pattern: string, decision: string}>} rules
 * @param {string} tool
 * @returns {string} a decision in DECISION
 */
function evalLayer(rules, tool) {
  if (!Array.isArray(rules) || rules.length === 0) return DECISION.DEFER;
  const fired = rules
    .filter((r) => r && typeof r.pattern === 'string' && matches(r.pattern, tool))
    .map((r) => normalizeDecision(r.decision));
  return meetAll(fired);
}

/** Coerce an arbitrary rule decision to a valid lattice value; unknown -> deny (fail-closed). */
function normalizeDecision(d) {
  if (d === DECISION.ALLOW || d === DECISION.ASK || d === DECISION.DENY || d === DECISION.DEFER) {
    return d;
  }
  return DECISION.DENY; // a malformed rule decision is treated as the strictest (deny-first)
}

// --- Layer 0: the deployment-profile deny floor -----------------------------------------
//
// Under the COMPLIANCE profile, every SERVER-SIDE tool is denied as a pre-filter (docs/13
// §Layer 0), before org/client/project/skill are consulted — and no lower layer can re-open
// it. The resolver maps a concrete tool to the profile FEATURE it would use (default: the
// `server-side-tools` umbrella for a known set of server-side tool patterns), then asks the
// profile-evaluator (T-MVP-03) whether that feature is legal under the active profile. The
// mapping is DATA (overridable), the verdict is the evaluator's — the resolver owns no
// profile table (SRP), exactly as the loader does not.
//
// Deny-first consumption: a feature the evaluator does not ALLOW (deny / malformed / throw,
// via isAllowed) yields a Layer-0 deny. A tool that maps to NO server-side feature defers at
// Layer 0 (the profile imposes no restriction on it) and flows into the ⊓ chain.

/**
 * Default classifier: which profile FEATURE (if any) a tool's execution requires. Returns a
 * feature handle understood by the profile-evaluator, or null if the tool needs no profile-
 * gated feature. The defaults cover the docs/13 server-side tool classes (code execution, web
 * search/fetch). Patterns use the shared matcher.
 */
const DEFAULT_SERVER_SIDE_TOOL_PATTERNS = Object.freeze([
  'code-execution',
  'CodeExecution',
  'web-search',
  'WebSearch',
  'web-fetch',
  'WebFetch',
  'mcp__web__*',
]);

function defaultToolFeature(tool) {
  for (const p of DEFAULT_SERVER_SIDE_TOOL_PATTERNS) {
    if (matches(p, tool)) return 'server-side-tools';
  }
  return null;
}

// --- the resolver -----------------------------------------------------------------------

/**
 * Build a policy resolver.
 *
 * @param {object} [deps]
 * @param {object} [deps.profileEvaluator] (profile, feature) -> verdict; defaults to the real one
 * @param {(tool: string) => (string|null)} [deps.toolFeature] map a tool to the profile feature
 *        it requires (null = none); defaults to the server-side-tools classifier
 * @returns {{ resolve: Function }}
 */
export function createPolicyResolver(deps = {}) {
  const profileEvaluator = deps.profileEvaluator ?? defaultProfileEvaluator;
  const toolFeature = deps.toolFeature ?? defaultToolFeature;

  /**
   * Resolve a proposed tool call.
   *
   * @param {object} req
   * @param {string|null} req.profile  the active deployment profile (e.g. "compliance")
   * @param {object} [req.layers]  the rule layers, each an array of {pattern, decision}:
   *        { org, client, project } — Layers 1/2/3. (Layer 4 is derived from requiredTools.)
   * @param {string[]} [req.requiredTools]  the skill's requiredTools (Layer 4 clamp)
   * @param {string} req.tool  the concrete tool name being called
   * @returns {'allow'|'ask'|'deny'} never `defer`
   */
  function resolve(req = {}) {
    const { profile = null, layers = {}, requiredTools = [], tool } = req;

    // A malformed request (no tool) cannot be proven safe -> deny (fail-closed).
    if (typeof tool !== 'string' || tool.trim() === '') return DECISION.DENY;

    // ---- Layer 0: profile deny floor (pre-filter) ----
    // Only server-side-ish tools consult the profile; everything else defers here.
    const feature = toolFeature(tool);
    if (feature !== null) {
      // isAllowed collapses deny / malformed verdict / throw -> false (deny-first).
      if (!isAllowed(profileEvaluator, profile, feature)) {
        return DECISION.DENY; // floor: nothing below can re-open it
      }
    }

    // ---- Layers 1–4: compose with the meet ----
    const org = evalLayer(layers.org, tool); // Layer 1
    const client = evalLayer(layers.client, tool); // Layer 2
    const project = evalLayer(layers.project, tool); // Layer 3

    // Layer 4 — requiredTools clamp/GATE (NOT a permission grant; docs/13 §Layer-4 reconciled
    // with T-HARD-11). A tool the skill requires -> `defer` (let upper layers decide; never
    // loosens). A tool the skill does NOT require -> `deny` (a skill may not use an undeclared
    // tool). The affirmative allow must therefore come from org/client/project — the clamp can
    // only narrow toward deny. An EMPTY requiredTools means the skill declared no tools, so it
    // may use none: every tool is undeclared -> deny.
    const required = Array.isArray(requiredTools) ? requiredTools : [];
    const skillRequiresTool = required.some((p) => typeof p === 'string' && matches(p, tool));
    const skill = skillRequiresTool ? DECISION.DEFER : DECISION.DENY;

    const folded = meetAll([org, client, project, skill]);

    // ---- default: every layer deferred -> deny (silence is denial; T-HARD-11) ----
    return folded === DECISION.DEFER ? DECISION.DENY : folded;
  }

  return { resolve };
}

/** A ready-to-use resolver backed by the real profile-evaluator + default classifier. */
export const policyResolver = createPolicyResolver();
