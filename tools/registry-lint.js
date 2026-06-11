#!/usr/bin/env node
// registry-lint — internal-consistency linter for skillforge.registry.json.
//
// Sources: docs/12-skill-manifest-and-registry.md §registry + §registry-lint and
// docs/13-tool-governance.md §"Tool-pattern matching and subsumption". The design
// is original to this project. Zero files from any third-party skills-factory
// codebase (clean-room).
//
// T-HARD-10(b) — the engine/deployment split.
//
//   This gate runs ENGINE-side and checks only the registry's INTERNAL
//   consistency, with ZERO client data in the loop (clean-room boundary held):
//
//     1. schema — every entry is well-formed (required fields, types);
//     2. inventory drift — registry name <-> skills/<name>/SKILL.md, both ways;
//     3. adapter existence — every requiredAdapters name exists in the engine's
//        own adapter catalog (src/loader/adapter-registry.js — single source of
//        truth shared with the loader);
//     4. tool-allowlist — every requiredTools pattern is subsumed by some
//        org-allowed pattern (doc 13 subsumption: literal < prefix-* < *);
//     5. tighten-only merge SHAPE — the override-broadening rule is implemented
//        and exported (validateOverrideTightens) for the deployment-side check;
//        engine CI does not read clients_dir, so it validates the rule's shape,
//        not any client's actual override.
//     6. skill↔adapter result-kind typing (T-MVP-10) — the skill's emitted
//        result-kind is accepted by its wired output adapter(s) and its consumed
//        source-kind is produced by its wired input adapter(s), checked on the
//        `kind` TAGS alone (docs/04 §"Skill↔adapter typing"). A mistyped pairing
//        fails HERE at start-up, not as a malformed artifact at the end. The same
//        primitive runs in the loader (T-MVP-11) so "valid wiring" has one
//        definition.
//
//   Two checks the spec lists for registry-lint are DEPLOYMENT-SIDE, not here,
//   because they require client configs the engine repo must never hold:
//
//     - requiredSecrets resolvability (a reference no client config can resolve);
//     - a per-client override that broadens the base.
//
//   These run in the loader/deployment environment that legitimately has
//   clients_dir; this file documents the boundary and ships the reusable merge
//   predicate that environment calls. See docs/12 §registry-lint and the
//   T-HARD-10(b) note.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultAdapterRegistry, EDGES } from "../src/loader/adapter-registry.js";
// Gate-per-adapter REGISTRATION rule (T-P4-01): every adapter in the engine catalog must ship
// its proof. The pure checker lives in its own tool (also runnable standalone); registry-lint
// folds it in so the catalog-consistency gate enforces it without adding a 7th gate family.
import { checkGateCoverage } from "./adapter-gate-coverage.js";
import { PROOF_ADAPTERS } from "./genericity-proof.js";
// THE ONE MATCHER (T-HARD-04): subsumption lives in engine src so the resolver and this
// linter share a single copy. Re-exported below to preserve registry-lint's public surface.
import { subsumes } from "../src/governance/tool-patterns.js";
// Skill↔adapter result-kind typing (T-MVP-10). The typing primitive lives in engine src so
// the loader (T-MVP-11) and this linter share ONE definition of "valid wiring"; the kinds
// catalog derives from the adapters' own exported `kind` constants (single source of truth).
import { defaultAdapterKinds } from "../src/registry/adapter-kinds.js";
import { checkSkillAdapterTyping, typingFactsFromEntry } from "../src/registry/typing.js";
// Skill-kind declaration rule (LINT-SKILLKIND-REQUIRED): every skill entry must name a
// skillKind the engine's skill-kinds catalog knows, so the load-bearing kind dispatch
// (activation conjunct 4, compose, governance) is never implicit. Same single-source pattern
// as the adapter-kinds catalog above.
import { defaultSkillKinds } from "../src/registry/skill-kinds.js";
// Compose-ref resolvability rule (LINT-COMPOSE-REQUIRED): every skill entry must carry a `compose`
// ref that the engine's compose-registry can resolve to an actual callable. The binding is DATA
// (Phase D), so a typo'd / missing ref must fail at start-up, not as a missing recipe at run time.
import { resolveComposeRef } from "../src/skills/compose-registry.js";
// LINT-ECC-DUPLICATE: a skill name must exist in exactly one source. The global store
// (~/.skillforge/skills/) and the local registry are two such sources; a name in both is a hard
// error. STORE_PATH and discoverSkills come from the store module so the scan uses one definition.
import { STORE_PATH } from "../src/store/index.js";
import { discoverSkills } from "../src/store/discovery.js";

const REGISTRY_PATH = "skillforge.registry.json";
const ALLOWLIST_PATH = "skillforge.tool-allowlist.json";
const SKILLS_DIR = "skills";

// ---------------------------------------------------------------------------
// Tool-pattern subsumption (doc 13 §"Tool-pattern matching and subsumption").
//   literal  ⊂  prefix-*  ⊂  *
// The matcher itself lives in src/governance/tool-patterns.js (THE ONE MATCHER,
// T-HARD-04) and is imported above; re-exported here so registry-lint's public
// surface (and its tests) are unchanged.
// ---------------------------------------------------------------------------

export { subsumes };

/** Is tool pattern `pattern` within the org allow-list (⊑ some allowed pattern)? */
function withinAllowlist(pattern, allowed) {
  return allowed.some((p) => subsumes(p, pattern));
}

// ---------------------------------------------------------------------------
// Tighten-only merge SHAPE (doc 12 OD-1) — exported for the deployment-side
// resolvability/override check; engine CI validates the rule, not client data.
// ---------------------------------------------------------------------------

/**
 * Validate that a per-client override only TIGHTENS the base registry entry —
 * never broadens it (doc 12 §OD-1 "an override may tighten but never broaden").
 * Returns a list of violation strings (empty = the override is tighten-only).
 *
 * Rules enforced (deny-first in spirit):
 *   - cannot enable a skill the base disabled (false -> true is a broaden);
 *   - cannot add a tool the base did not list;
 *   - cannot widen scope (clients/projects) beyond the base set, where "*" in
 *     the base means "any" and an override list narrows it;
 *   - cannot relax a requiredTools pattern to something broader than the base.
 *
 * This is data-only and model-independent so the deployment loader can call it
 * over real client overrides without re-implementing the merge semantics.
 */
export function validateOverrideTightens(base, override, skillName = "<skill>") {
  const v = [];
  if (override == null || typeof override !== "object") return v;

  if (override.enabled === true && base.enabled === false) {
    v.push(`${skillName}: override enables a skill the base disabled (broaden)`);
  }

  if (Array.isArray(override.requiredTools)) {
    const baseTools = Array.isArray(base.requiredTools) ? base.requiredTools : [];
    for (const t of override.requiredTools) {
      // Each override tool must be ⊑ some base tool (narrow or equal), else broaden.
      if (!baseTools.some((bt) => subsumes(bt, t))) {
        v.push(`${skillName}: override adds/broadens tool "${t}" not covered by the base`);
      }
    }
  }

  if (override.scope && typeof override.scope === "object") {
    for (const axis of ["clients", "projects"]) {
      const baseAxis = base.scope?.[axis] ?? ["*"];
      const ovAxis = override.scope[axis];
      if (!Array.isArray(ovAxis)) continue;
      const baseAny = baseAxis.includes("*");
      if (baseAny) continue; // base allows any; any narrowing is fine
      for (const item of ovAxis) {
        if (item === "*" || !baseAxis.includes(item)) {
          v.push(`${skillName}: override widens scope.${axis} to "${item}" beyond the base`);
        }
      }
    }
  }

  return v;
}

// ---------------------------------------------------------------------------
// Adapter references (T-P4-02): a requiredAdapters entry is a bare NAME string or a
// `{ name, version }` object that PINS the adapter-contract version. These helpers read one ref
// and reduce a whole entry to name-only (for the kind-typing primitive, which types by name).
// ---------------------------------------------------------------------------

/** Read one requiredAdapters ref into `{ adapterName, pin }`; `adapterName` is null if malformed. */
function readAdapterRef(ref) {
  if (typeof ref === "string") return { adapterName: ref, pin: null };
  if (ref && typeof ref === "object" && !Array.isArray(ref) && typeof ref.name === "string") {
    const pin = typeof ref.version === "string" ? ref.version : null;
    return { adapterName: ref.name, pin };
  }
  return { adapterName: null, pin: null };
}

/** A shallow copy of a skill entry with requiredAdapters reduced to plain name arrays. */
function adapterRefsToNames(entry) {
  const ra = entry?.requiredAdapters;
  if (!ra || typeof ra !== "object") return entry;
  const names = (arr) => (Array.isArray(arr) ? arr.map((r) => readAdapterRef(r).adapterName).filter((n) => n != null) : arr);
  return { ...entry, requiredAdapters: { ...ra, input: names(ra.input), output: names(ra.output) } };
}

// ---------------------------------------------------------------------------
// Schema validation for one registry entry.
// ---------------------------------------------------------------------------

const VALID_EFFORT = new Set(["low", "medium", "high"]);

function validateEntrySchema(name, entry, errors) {
  const where = `skills."${name}"`;
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    errors.push(`${where}: entry must be an object`);
    return;
  }
  if (typeof entry.version !== "string" || entry.version === "") {
    errors.push(`${where}.version must be a non-empty string`);
  }
  if (typeof entry.enabled !== "boolean") {
    errors.push(`${where}.enabled must be a boolean`);
  }
  if (entry.owner !== undefined && typeof entry.owner !== "string") {
    errors.push(`${where}.owner must be a string`);
  }
  if (!Array.isArray(entry.requiredTools) || !entry.requiredTools.every((t) => typeof t === "string")) {
    errors.push(`${where}.requiredTools must be an array of strings`);
  }
  if (
    typeof entry.requiredAdapters !== "object" ||
    entry.requiredAdapters === null ||
    Array.isArray(entry.requiredAdapters) ||
    !Array.isArray(entry.requiredAdapters.input) ||
    !Array.isArray(entry.requiredAdapters.output)
  ) {
    errors.push(`${where}.requiredAdapters must be { input: string[], output: string[] }`);
  }
  if (entry.requiredSecrets !== undefined && !Array.isArray(entry.requiredSecrets)) {
    errors.push(`${where}.requiredSecrets must be an array of secret references`);
  }
  if (entry.sourceKind !== undefined && typeof entry.sourceKind !== "string") {
    errors.push(`${where}.sourceKind must be a string (the source-kind the skill consumes)`);
  }
  if (entry.resultKind !== undefined && typeof entry.resultKind !== "string") {
    errors.push(`${where}.resultKind must be a string (the result-kind the skill emits)`);
  }
  if (
    typeof entry.scope !== "object" ||
    entry.scope === null ||
    !Array.isArray(entry.scope.clients) ||
    !Array.isArray(entry.scope.projects)
  ) {
    errors.push(`${where}.scope must be { clients: string[], projects: string[] }`);
  }
  if (entry.effort !== undefined && !VALID_EFFORT.has(entry.effort)) {
    errors.push(`${where}.effort must be one of low|medium|high`);
  }
}

// ---------------------------------------------------------------------------
// LINT-GOVERNANCE-SIDEEFFECTS — the descriptor-level invariant tying a kind's
// governance class to its declared side effects. A 'write'/'bidirectional' kind
// MUST be able to emit side effects (so the gate has something to govern); a
// 'none' kind MUST emit none (so a read-only kind can never fabricate a tool
// call). This is checked behaviorally (call sideEffects with a mock `parts`),
// not by source inspection, so it holds for any descriptor shape.
// ---------------------------------------------------------------------------

// A `parts` bag rich enough for the two fan-out shapes we ship (plan / intents).
// A descriptor whose sideEffects returns non-empty for THIS input is "able to
// emit"; one that returns empty here is treated as the `() => []` read-only shape.
const MOCK_PARTS_WITH_EFFECTS = Object.freeze({
  composed: { plan: [{ x: 1 }], intents: [{ x: 1 }] },
  clientContext: {},
  artifact: {},
});

const WRITE_GOVERNANCE = new Set(["write", "bidirectional"]);

/**
 * Check the governance↔sideEffects invariant for every descriptor in a skill-kinds
 * catalog. Returns a list of violation strings (empty = all descriptors consistent).
 */
export function checkGovernanceSideEffects(skillKinds) {
  const violations = [];
  for (const kind of skillKinds.kinds()) {
    const descriptor = skillKinds.get(kind);
    if (typeof descriptor.sideEffects !== "function") {
      violations.push(`kind "${kind}": sideEffects must be a function`);
      continue;
    }
    let emitted = [];
    try {
      emitted = descriptor.sideEffects(MOCK_PARTS_WITH_EFFECTS) ?? [];
    } catch (e) {
      violations.push(`kind "${kind}": sideEffects threw on mock parts — ${e.message}`);
      continue;
    }
    const canEmit = Array.isArray(emitted) && emitted.length > 0;
    if (WRITE_GOVERNANCE.has(descriptor.governance)) {
      if (!canEmit) {
        violations.push(
          `kind "${kind}": governance "${descriptor.governance}" requires sideEffects that can emit a non-empty intent list, but it returned empty`,
        );
      }
    } else if (descriptor.governance === "none") {
      if (canEmit) {
        violations.push(
          `kind "${kind}": governance "none" requires sideEffects to be () => [], but it emitted ${emitted.length} intent(s)`,
        );
      }
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// LINT-ECC-DUPLICATE — a skill name must exist in exactly ONE source.
// The local registry and the global store (~/.skillforge/skills/) are two such
// sources; the same name in both is ambiguous (which definition wins?), so it is
// a hard error: the skill must be removed from one source. Pure over inputs —
// the store directory is scanned by the caller (CLI helper) and passed in, so the
// function stays unit-testable without touching the FS.
// ---------------------------------------------------------------------------

/**
 * LINT-ECC-DUPLICATE: a skill name must exist in exactly one source.
 * If the same name appears in both the local registry and the global store,
 * it is a hard error — the skill must be removed from one source.
 *
 * @param {{ registry: object, globalStoreDirs: string[] }} ctx
 * @returns {string[]} violations
 */
export function checkGlobalStoreDuplicates({ registry, globalStoreDirs = [] }) {
  const violations = [];
  const skills = registry && typeof registry.skills === "object" && !Array.isArray(registry.skills) ? registry.skills : {};
  for (const name of globalStoreDirs) {
    if (name in skills) {
      violations.push(
        `LINT-ECC-DUPLICATE: skill "${name}" exists in both local registry and global store (~/.skillforge/skills/); remove it from one source`,
      );
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// The lint (pure over inputs, so it is unit-testable without touching the FS).
// ---------------------------------------------------------------------------

/**
 * Lint a registry object against the engine's adapter catalog, the org
 * allow-list, the engine's adapter-kinds catalog, and the set of skill directory
 * names found on disk.
 *
 * @param {object} args
 * @param {object} args.registry  the parsed skillforge.registry.json.
 * @param {object} args.allowlist  the parsed org tool allow-list.
 * @param {object} args.adapterRegistry  the engine's adapter-name catalog (existence).
 * @param {string[]} args.skillDirs  skill directory names found on disk.
 * @param {object} [args.kinds]  the engine's adapter-kinds catalog (result-kind typing);
 *        defaults to defaultAdapterKinds() so the CLI and tests share one source of truth.
 * @param {object} [args.skillKinds]  the engine's skill-kinds catalog (LINT-SKILLKIND-REQUIRED);
 *        defaults to defaultSkillKinds() so the CLI and tests share one source of truth.
 * @param {(ref:unknown)=>(Function|null)} [args.resolveCompose]  resolves a `compose` ref to its
 *        callable (LINT-COMPOSE-REQUIRED); defaults to the engine's compose-registry resolver.
 * @param {string[]} [args.proofAdapters]  the output adapters the genericity proof pairs
 *        (T-P4-01 gate coverage); defaults to PROOF_ADAPTERS.
 * @param {(file:string)=>boolean} [args.goldenExists]  does an input golden fixture exist?
 *        (T-P4-01 gate coverage); defaults to the on-disk check in adapter-gate-coverage.js.
 * @returns {string[]} error messages (empty = PASS).
 */
// ---------------------------------------------------------------------------
// T-HARD-10(b) — the lint runs as TWO separate, focused passes that the entry
// point composes (AC2: "structural validation and policy/governance validation
// run as separate checks"):
//
//   • validateStructure — WELL-FORMEDNESS: schema/types/required fields, the
//     registry↔SKILL.md inventory drift, the declared skillKind + compose ref,
//     and the adapter EXISTENCE / version-pin / kind-typing WIRING. "Is this a
//     well-formed, internally-coherent registry?" — answerable with no notion of
//     what is *allowed*.
//   • validatePolicy — GOVERNANCE: the tool-allowlist subsumption, requiredSecrets
//     reference shape, the gate-per-adapter REGISTRATION rule, and the kind
//     governance↔sideEffects invariant. "Given a well-formed registry, does it
//     stay inside the org's governance envelope?"
//
// Each pass is independently callable + independently tested. lintRegistry runs
// them in sequence and concatenates; the SET of findings for any input is
// unchanged from the single-pass form (the passes only GROUP the same checks),
// and the tests assert membership (`.some(...)`), not order, so behaviour holds.
// A non-object / non-skills registry is a STRUCTURAL fatal: structure returns it
// and policy is skipped (there is nothing well-formed to govern).
// ---------------------------------------------------------------------------

/**
 * @typedef {object} RegistryLintCtx
 * @property {object} registry
 * @property {object} allowlist
 * @property {object} adapterRegistry
 * @property {string[]} skillDirs
 * @property {object} [kinds]
 * @property {object} [skillKinds]
 * @property {(ref:unknown)=>(Function|null)} [resolveCompose]
 * @property {string[]} [proofAdapters]
 * @property {(file:string)=>boolean} [goldenExists]
 */

/**
 * STRUCTURAL pass — schema/types/required-fields, inventory drift, declared
 * skillKind + compose ref, and adapter existence/pin/kind-typing wiring. Returns
 * error strings (empty = structurally well-formed). On a fatally malformed
 * registry it returns the fatal alone (no per-skill checks are meaningful).
 *
 * @param {RegistryLintCtx} ctx
 * @returns {string[]}
 */
export function validateStructure({
  registry,
  adapterRegistry,
  skillDirs,
  kinds = defaultAdapterKinds(),
  skillKinds = defaultSkillKinds(),
  resolveCompose = resolveComposeRef,
  globalStoreDirs = listGlobalSkillDirs(),
}) {
  const errors = [];

  if (typeof registry !== "object" || registry === null) {
    return ["registry must be a JSON object"];
  }
  if (registry.schemaVersion !== "1") {
    errors.push(`schemaVersion must be "1" (got ${JSON.stringify(registry.schemaVersion)})`);
  }
  if (typeof registry.skills !== "object" || registry.skills === null || Array.isArray(registry.skills)) {
    errors.push("registry.skills must be an object keyed by skill name");
    return errors;
  }

  const registryNames = Object.keys(registry.skills);
  const dirSet = new Set(skillDirs);

  // (LINT-NAME-REQUIRED, CC-23) a skill name is the engine's routing key AND the on-disk directory
  // (skills/<name>/SKILL.md); an empty key is neither addressable nor a valid path. Caught here with
  // a clean message BEFORE inventory drift / schema would report it via the ugly "skills//SKILL.md"
  // path. The empty entry is skipped by the drift + per-skill checks below so the failure is one
  // clear line, not a confusing cascade.
  if (Object.prototype.hasOwnProperty.call(registry.skills, "")) {
    errors.push("LINT-NAME-REQUIRED: skill name must be a non-empty string (the registry has an entry keyed by \"\")");
  }
  const realNames = registryNames.filter((name) => name !== "");

  // (2) inventory drift — registry -> SKILL.md
  for (const name of realNames) {
    if (!dirSet.has(name)) {
      errors.push(`inventory drift: registry skill "${name}" has no skills/${name}/SKILL.md`);
    }
  }
  // (2) inventory drift — SKILL.md -> registry
  for (const dir of skillDirs) {
    if (!(dir in registry.skills)) {
      errors.push(`inventory drift: skills/${dir}/SKILL.md is absent from the registry`);
    }
  }

  // LINT-ECC-DUPLICATE — a skill name must exist in exactly one source.
  for (const v of checkGlobalStoreDuplicates({ registry, globalStoreDirs })) {
    errors.push(v);
  }

  for (const name of realNames) {
    const entry = registry.skills[name];

    // (1) schema
    validateEntrySchema(name, entry, errors);
    if (typeof entry !== "object" || entry === null) continue;

    // (LINT-SKILLKIND-REQUIRED) every entry must declare a skillKind the engine knows. Missing
    // or unknown = FAIL — the kind drives activation conjunct 4, compose and governance, so an
    // implicit/typo'd kind would silently mis-route. Explicit beats implicit; fail loud here.
    if (typeof entry.skillKind !== "string" || entry.skillKind === "") {
      errors.push(`skills."${name}": skillKind must be declared (one of: ${skillKinds.kinds().join(", ")})`);
    } else if (!skillKinds.has(entry.skillKind)) {
      errors.push(
        `skills."${name}": unknown skillKind "${entry.skillKind}" (known: ${skillKinds.kinds().join(", ")})`,
      );
    }

    // (LINT-COMPOSE-REQUIRED) every entry must carry a `compose` ref the engine can resolve to an
    // actual callable. The skill→recipe binding is DATA (Phase D); a missing or unresolvable ref
    // would surface as a missing recipe at run time, so fail loud here at start-up instead.
    if (typeof entry.compose !== "string" || entry.compose === "") {
      errors.push(`skills."${name}": compose ref must be declared ("<dir>/compose.js#<export>")`);
    } else if (typeof resolveCompose(entry.compose) !== "function") {
      errors.push(
        `skills."${name}": compose ref "${entry.compose}" does not resolve to a known compose function`,
      );
    }

    // (3) adapter existence + version-pin compatibility (against the engine's own catalog).
    // A requiredAdapters entry may be a bare name string OR a `{ name, version }` object that
    // PINS the adapter-contract version the skill was built against (T-P4-02). resolve() checks
    // existence AND the pin (semver-compatible) in one step; a bare name (no pin) resolves
    // unconditionally, so this is backward-compatible with the string-only shape.
    if (entry.requiredAdapters && typeof entry.requiredAdapters === "object") {
      for (const edge of [EDGES.INPUT, EDGES.OUTPUT]) {
        for (const ref of entry.requiredAdapters[edge] ?? []) {
          const { adapterName, pin } = readAdapterRef(ref);
          if (adapterName == null) {
            errors.push(`skills."${name}": ${edge} adapter ref must be a name or { name, version }`);
            continue;
          }
          try {
            adapterRegistry.resolve(edge, adapterName, pin);
          } catch (e) {
            // resolve() carries a readable "unknown ..." or "... does not satisfy the pin ..."
            // message; surface it under the skill so the failure points at the wiring.
            errors.push(`skills."${name}": ${e.message}`);
          }
        }
      }
    }

    // (6) skill↔adapter result-kind typing — emitted result-kind accepted by the wired
    // output adapter(s); consumed source-kind produced by the wired input adapter(s). On the
    // tags alone (no payload parsed). Shares the loader's primitive so "valid wiring" is
    // defined once (T-MVP-10 / T-MVP-11). The typing primitive types by NAME, so a pinned
    // `{ name, version }` requiredAdapters ref is reduced to its name first — the version axis
    // (T-P4-02) is orthogonal to the kind axis and is checked in (3) above.
    const facts = typingFactsFromEntry(adapterRefsToNames(entry));
    for (const violation of checkSkillAdapterTyping({ skillName: name, kinds, ...facts })) {
      errors.push(`skills."${name}": ${violation.replace(`${name}: `, "")}`);
    }
  }

  return errors;
}

/**
 * POLICY / GOVERNANCE pass — the tool-allowlist subsumption, requiredSecrets
 * reference shape, the gate-per-adapter REGISTRATION rule, and the kind
 * governance↔sideEffects invariant. Assumes a structurally well-formed registry
 * (lintRegistry runs validateStructure first and skips this on a fatal); it
 * defensively ignores a non-object registry/skills so it is safe to call alone.
 *
 * @param {RegistryLintCtx} ctx
 * @returns {string[]}
 */
export function validatePolicy({
  registry,
  allowlist,
  adapterRegistry,
  skillKinds = defaultSkillKinds(),
  proofAdapters = PROOF_ADAPTERS,
  goldenExists,
}) {
  const errors = [];

  const allowed = Array.isArray(allowlist?.allowed) ? allowlist.allowed : [];
  if (allowed.length === 0) {
    errors.push("org tool allow-list is empty or missing — every requiredTools entry would fail");
  }

  const skills =
    registry && typeof registry.skills === "object" && !Array.isArray(registry.skills) ? registry.skills : {};

  for (const name of Object.keys(skills)) {
    const entry = skills[name];
    if (typeof entry !== "object" || entry === null) continue;

    // (4) tool-allowlist
    for (const tool of entry.requiredTools ?? []) {
      if (typeof tool === "string" && !withinAllowlist(tool, allowed)) {
        errors.push(
          `LINT-TOOL-ALLOWLIST: skill "${name}" declares requiredTool "${tool}", which is not subsumed by any org-allowed pattern (expected ⊑ one of: ${allowed.join(", ")})`,
        );
      }
    }

    // (T-HARD-10(b)) requiredSecrets resolvability is DEPLOYMENT-SIDE — not
    // checked here. We only assert the shape (array of reference strings); a
    // reference that no client config can resolve is caught by the loader in
    // the environment that has clients_dir.
    for (const ref of entry.requiredSecrets ?? []) {
      if (typeof ref !== "string") {
        errors.push(
          `LINT-SECRET-REF-SHAPE: skill "${name}" has a requiredSecrets entry of type ${typeof ref}; every entry must be a secret-reference string (a name the deployment resolves, never an inline value), got ${JSON.stringify(ref)}`,
        );
      }
    }
  }

  // (7) gate-per-adapter REGISTRATION rule (T-P4-01) — a REGISTRY-LEVEL check (it is about the
  // engine's adapter catalog, not any one skill): every adapter the engine knows must ship its
  // proof (input -> a determinism golden; output -> a genericity-proof pairing). Adding an
  // adapter to the catalog without its gate fails the lint, so the catalog cannot grow ungated.
  for (const v of checkGateCoverage({ adapterRegistry, proofAdapters, goldenExists })) {
    errors.push(`adapter-gate: ${v}`);
  }

  // (LINT-GOVERNANCE-SIDEEFFECTS) a REGISTRY-LEVEL check over the engine's skill-kinds catalog:
  // a write/bidirectional kind must be able to emit side effects (the gate needs something to
  // govern), and a 'none' kind must emit none (a read-only kind can never fabricate a tool call).
  for (const v of checkGovernanceSideEffects(skillKinds)) {
    errors.push(`governance-sideeffects: ${v}`);
  }

  return errors;
}

/**
 * Lint a registry by composing the two focused passes (structure, then policy).
 * A fatally-malformed registry is a structural fatal — policy is skipped because
 * there is nothing well-formed to govern. The returned findings are the union of
 * both passes; their set for any input is identical to the pre-split single pass.
 *
 * @param {RegistryLintCtx} ctx
 * @returns {string[]} error messages (empty = PASS).
 */
export function lintRegistry(ctx) {
  const structural = validateStructure(ctx);
  // A fatal malformed-registry result short-circuits: the single fatal string means there is no
  // well-formed registry for the policy pass to govern, so do not run (and do not double-report).
  const FATAL = new Set(["registry must be a JSON object", "registry.skills must be an object keyed by skill name"]);
  if (structural.some((e) => FATAL.has(e))) return structural;
  return [...structural, ...validatePolicy(ctx)];
}

// ---------------------------------------------------------------------------
// CLI entry point: read the files and run the lint.
// ---------------------------------------------------------------------------

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function listSkillDirs() {
  let entries;
  try {
    entries = readdirSync(SKILLS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  const dirs = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const skillFile = join(SKILLS_DIR, e.name, "SKILL.md");
    try {
      if (statSync(skillFile).isFile()) dirs.push(e.name);
    } catch {
      // A directory without a SKILL.md is reported as drift below only if it is
      // in the registry; an empty dir on its own is not a skill, so skip it.
    }
  }
  return dirs;
}

// Mirrors listSkillDirs() but scans the global store (~/.skillforge/skills/) instead of local
// skills/. Returns the skill names installed in the store; a missing store yields an empty list.
function listGlobalSkillDirs() {
  return discoverSkills(STORE_PATH).map((s) => s.name);
}

function main() {
  let registry;
  let allowlist;
  try {
    registry = readJson(REGISTRY_PATH);
  } catch (e) {
    console.error(`registry-lint: cannot read ${REGISTRY_PATH} — ${e.message}`);
    process.exit(1);
  }
  try {
    allowlist = readJson(ALLOWLIST_PATH);
  } catch (e) {
    console.error(`registry-lint: cannot read ${ALLOWLIST_PATH} — ${e.message}`);
    process.exit(1);
  }

  const errors = lintRegistry({
    registry,
    allowlist,
    adapterRegistry: defaultAdapterRegistry(),
    skillDirs: listSkillDirs(),
  });

  if (errors.length > 0) {
    console.error(`registry-lint: FAIL — ${errors.length} problem(s):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  const count = Object.keys(registry.skills).length;
  console.log(`registry-lint: PASS — ${count} skill(s) consistent`);
}

// Only run the CLI when invoked directly, so tests can import the pure helpers.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
