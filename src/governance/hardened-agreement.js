// Hardened-tier ↔ base-layer agreement (T-HARD-06, closes GOV-04) — docs/13-tool-governance.md
// §"OD-2 — base layer is open; managed settings are the optional hardened tier".
//
// Sources: concept + first principles, zero files from any third-party skills-factory codebase
// (clean-room). See docs/13 §hardened tier + §"decision algebra".
//
// WHY THIS EXISTS (GOV-04). docs/13 OD-2 defines TWO enforcement seams: the BASE layer (the open
// policy resolver in the PreToolUse hook — the source of truth) and the optional HARDENED tier
// (Claude managed-permission settings, a PROJECTION from the registry via src/emit/claude-
// flavour.js). In the hardened tier both decide the same call. The audit (AUD-ARCH, GOV-04)
// flagged that nothing stated what happens when the projection DRIFTS from the resolver — e.g. a
// registry edit that re-emits a managed `allow` for a tool the resolver now denies. Claude's
// "deny at any level wins" resolves a deny collision safely, but a stale/looser managed `allow`
// could pre-empt or contradict the resolver.
//
// THE INVARIANT (GOV-04 recommendation, made executable here):
//
//   The managed settings are a DERIVED PROJECTION that must be DENY-EQUIVALENT-OR-STRICTER than
//   the resolver — never LOOSER. The resolver is the single source of truth; the projection is a
//   verified shadow. Concretely, for every tool:
//
//       strictness(managed decision)  >=  strictness(resolver decision)
//
//   i.e. the managed rule may be the SAME or STRICTER, never looser (deny > ask > allow). The two
//   failure shapes this forbids:
//     - managed ALLOWS (or ASKS) a tool the resolver DENIES   — managed looser than a deny;
//     - managed ALLOWS a tool the resolver only ASKS          — managed looser than an ask.
//   A managed DENY is always safe (it can only be equal-or-stricter). A tool the managed settings
//   do not mention at all is governed solely by the resolver — no divergence to check.
//
// This is a CI check, a SIBLING of registry-lint (docs/13 §CI gates): it reads the emitted
// managed artifact + the governance context and proves the projection cannot allow anything the
// resolver denies. Pure + model-independent, so it runs in engine CI over engine data with no
// client data in the loop (clean-room boundary held — the check takes the projection and the
// resolver layers as DATA).

import { createPolicyResolver, DECISION } from "./policy-resolver.js";
import { matches } from "./tool-patterns.js";
import { contentHash } from "../core/content-hash.js";

// Strictness rank mirrors the resolver lattice (deny > ask > allow). `defer` cannot be a managed
// nor a final resolver decision, so it is not ranked here.
const STRICTNESS = Object.freeze({
  [DECISION.ALLOW]: 1,
  [DECISION.ASK]: 2,
  [DECISION.DENY]: 3,
});

/** A Claude managed `permissions.allow/ask` entry that names a SKILL, not a tool (skill-firing). */
const SKILL_RULE_RE = /^Skill\(/;

/**
 * Extract the TOOL patterns a managed permission list grants. The list mixes `Skill(<name>)`
 * entries (skill-firing rules, not tool calls — out of scope for the tool resolver) with tool
 * patterns (the projected requiredTools). We keep only the tool patterns.
 *
 * @param {string[]} list  a managed permissions.allow / .ask / .deny array
 * @returns {string[]} the tool patterns (Skill(...) entries removed)
 */
function toolPatterns(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((p) => typeof p === "string" && p.length > 0 && !SKILL_RULE_RE.test(p));
}

/**
 * The set of concrete tools to probe. A pattern like `mcp__tracker__*` is not a single tool, so we
 * cannot enumerate every concrete call; instead we probe a REPRESENTATIVE tool for each pattern —
 * for a literal, the literal itself; for a `prefix-*`, a synthetic member under the prefix; for
 * `*`, a synthetic arbitrary tool. The agreement invariant is about whether the managed rule could
 * permit a tool the resolver denies, and the representative member is the witness: if the resolver
 * denies the representative, the broad managed allow is looser for at least that member.
 *
 * We also include EVERY explicit literal appearing anywhere (managed lists + the resolver layers),
 * so a specific resolver deny under a broad managed allow is caught at the exact tool, not only the
 * synthetic representative.
 *
 * @param {object} ctx  { managedAllow, managedAsk, managedDeny, layers, requiredTools }
 * @returns {string[]} a deterministic, de-duplicated probe set
 */
function probeTools({ patterns, layers, requiredTools }) {
  const probes = new Set();

  const addRepresentative = (pattern) => {
    if (pattern === "*") {
      probes.add("__sf_probe_any__");
    } else if (pattern.endsWith("*")) {
      probes.add(pattern.slice(0, -1) + "__sf_probe_member__");
    } else {
      probes.add(pattern); // a literal probes itself
    }
  };

  for (const p of patterns) addRepresentative(p);
  for (const t of requiredTools ?? []) if (typeof t === "string") addRepresentative(t);

  // Every literal in the resolver layers — so a layer-local specific deny is probed exactly.
  for (const layerName of ["org", "client", "project"]) {
    for (const rule of layers?.[layerName] ?? []) {
      if (rule && typeof rule.pattern === "string") addRepresentative(rule.pattern);
    }
  }

  return [...probes].sort();
}

/** The strictest managed decision for one tool across the allow/ask/deny lists (deny-first). */
function managedDecisionForTool(tool, { managedAllow, managedAsk, managedDeny }) {
  // deny-first: if any managed deny pattern matches, the managed decision is deny.
  if (managedDeny.some((p) => matches(p, tool))) return DECISION.DENY;
  if (managedAsk.some((p) => matches(p, tool))) return DECISION.ASK;
  if (managedAllow.some((p) => matches(p, tool))) return DECISION.ALLOW;
  return null; // the managed settings say nothing about this tool
}

/**
 * Check that a managed-settings projection is deny-equivalent-or-stricter than the resolver for a
 * given governance context. Returns a list of violation strings (empty = the projection agrees).
 *
 * @param {object} args
 * @param {object} args.managedSettings  the emitted artifact's parsed JSON ({ permissions: { allow, ask, deny } }).
 * @param {object} [args.layers]  the resolver layers { org, client, project } (rule lists) — the
 *        SAME governance data the resolver runs on. Defaults to {} (no layer rules).
 * @param {string[]} [args.requiredTools]  the skill's requiredTools (Layer-4 clamp input). Defaults
 *        to the managed allow's tool patterns (the projection's own source), so the check is
 *        self-consistent when no explicit list is supplied.
 * @param {string|null} [args.profile]  the active deployment profile (Layer-0 floor). Default null.
 * @param {object} [args.resolver]  an injectable resolver (defaults to the real policy resolver).
 * @returns {string[]} violations (empty = PASS)
 */
export function checkHardenedAgreement({
  managedSettings,
  layers = {},
  requiredTools,
  profile = null,
  resolver = createPolicyResolver(),
} = {}) {
  const violations = [];

  const perms = managedSettings?.permissions;
  if (!perms || typeof perms !== "object") {
    return ["managed settings missing a `permissions` object"];
  }
  const managedAllow = toolPatterns(perms.allow);
  const managedAsk = toolPatterns(perms.ask);
  const managedDeny = toolPatterns(perms.deny);

  // The resolver runs on the skill's declared requiredTools (Layer 4). When the caller does not
  // pass them, derive them from the managed allow's tool patterns — that IS what the projection
  // was built from, so the resolver sees the same declared-tool set the managed allow projects.
  const declared = Array.isArray(requiredTools) ? requiredTools : managedAllow.slice();

  const probes = probeTools({
    patterns: [...managedAllow, ...managedAsk, ...managedDeny],
    layers,
    requiredTools: declared,
  });

  for (const tool of probes) {
    const managed = managedDecisionForTool(tool, { managedAllow, managedAsk, managedDeny });
    if (managed === null) continue; // managed says nothing → governed by the resolver alone, no drift

    const resolved = resolver.resolve({ profile, layers, requiredTools: declared, tool });

    // The invariant: managed must be AT LEAST as strict as the resolver. A managed rule looser
    // than the resolver's decision is the GOV-04 drift (a stale/over-broad managed allow that
    // could pre-empt or contradict the source-of-truth resolver).
    if (STRICTNESS[managed] < STRICTNESS[resolved]) {
      violations.push(
        `hardened-tier drift on tool "${tool}": managed=${managed} is LOOSER than resolver=${resolved} ` +
          `(managed settings must be deny-equivalent-or-stricter than the resolver, never looser)`,
      );
    }
  }

  return violations;
}

/**
 * Convenience: check the agreement for a skill emitted under the Claude flavour. Locates the
 * `managed/<name>.settings.json` companion in an emit result and runs checkHardenedAgreement.
 *
 * @param {object} args
 * @param {{ companions: Array<{path:string,content:string}> }} args.emitResult  an emit() result.
 * @param {string} args.name  the skill name (to find managed/<name>.settings.json).
 * @param {object} [args.layers] @param {string[]} [args.requiredTools] @param {string|null} [args.profile]
 * @param {object} [args.resolver]
 * @returns {string[]} violations (empty = PASS)
 */
export function checkEmittedHardenedAgreement({ emitResult, name, layers, requiredTools, profile, resolver }) {
  const companion = (emitResult?.companions ?? []).find((c) => c.path === `managed/${name}.settings.json`);
  if (!companion) {
    return [`no managed/${name}.settings.json companion in the emit result (Claude flavour not applied?)`];
  }
  let managedSettings;
  try {
    managedSettings = JSON.parse(companion.content);
  } catch (e) {
    return [`managed/${name}.settings.json is not valid JSON: ${e.message}`];
  }
  return checkHardenedAgreement({ managedSettings, layers, requiredTools, profile, resolver });
}

// Sources: concept + first principles, zero files from any third-party skills-factory codebase
// (clean-room).: a hardened-tier skill must (a) carry an explicit agreement marker before
// it may run in that tier, and (b) prove its source bytes match the hash declared in the adapter.
// Both checks are TOTAL fail-closed evaluators — they return a verdict object and never throw, so a
// malformed adapter or missing field can only BLOCK, never crash the gate or fall through to allow.

/**
 * AC1 — gate the hardened tier on an explicit agreement marker. A hardened-tier skill must opt in
 * by declaring `hardenedAgreement: true` on its adapter/manifest; absence (null adapter, missing
 * field, or `false`) blocks. Total: never throws.
 *
 * @param {object|null|undefined} adapter  the skill adapter/manifest.
 * @returns {{ok: true} | {ok: false, reason: 'missing-agreement-marker'}}
 */
export function checkAgreementMarker(adapter) {
  if (adapter?.hardenedAgreement === true) return { ok: true };
  return { ok: false, reason: "missing-agreement-marker" };
}

/**
 * AC2+AC3 — verify a hardened-tier skill's source bytes against the hash the adapter declares. The
 * source is canonicalized + hashed by the same content-hash the audit trail uses, then compared to
 * the expected hash; a mismatch blocks (the source the registry vouched for is not what we are about
 * to run). Total fail-closed: null/non-string source or expected hash returns a block verdict, and
 * the function never throws.
 *
 * @param {string} source  the skill manifest/source text.
 * @param {string} expectedHash  the hash declared by the adapter.
 * @param {object} [opts]  reserved for future options.
 * @returns {{ok: true, reason: 'hash-match', hash: string}
 *   | {ok: false, reason: 'invalid-source'}
 *   | {ok: false, reason: 'invalid-expected-hash'}
 *   | {ok: false, reason: 'hash-mismatch', computed: string, expected: string}}
 */
export function verifySourceHash(source, expectedHash, opts = {}) {
  if (typeof source !== "string") return { ok: false, reason: "invalid-source" };
  if (typeof expectedHash !== "string") return { ok: false, reason: "invalid-expected-hash" };
  const computed = contentHash(source);
  if (computed !== expectedHash) {
    return { ok: false, reason: "hash-mismatch", computed, expected: expectedHash };
  }
  return { ok: true, reason: "hash-match", hash: computed };
}
