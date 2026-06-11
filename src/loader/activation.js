// Activation — the full six-conjunct activation predicate (docs/06 §"Activation — when a
// skill comes into play (the full predicate)", docs/05 §"When a skill actually activates").
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room).
//
// THE PREDICATE. A skill activates only when EVERY one of six conjuncts holds (an AND, not an
// OR — any single failing conjunct stops activation):
//
//   activates ⇔ recognition ∧ client-has-skill ∧ registry-enabled
//               ∧ adapters-valid (result-kind paired) ∧ scope-permits ∧ profile-permits
//
//   1. recognition       — the request matched the skill's name+description (agent-judged) or
//                          an explicit command. This is what BRINGS the request to the loader;
//                          it is NOT a loader-evaluated gate (docs/06 L144-150), so activate()
//                          takes the recognized skillName as input and starts at conjunct 2.
//   2. client-has-skill  — the active client's config adopted this skill (ctx.skills includes it).
//   3. registry-enabled  — the skill's registry entry is enabled:true.
//   4. kind-contract     — the skill declares a known skillKind whose descriptor's contract holds:
//      (typed)             an artifact-family kind type-checks the adapter pairing, a references-
//                          family kind asserts no adapters are wired (delegated to
//                          validateKindContract — the SAME primitive the engine-side registry-lint
//                          gate uses, so "valid wiring" is defined once).
//   5. scope-permits     — the registry scope's (clients, projects) admit this (client, project).
//   6. profile-permits   — the deployment profile does not forbid a feature the skill requires
//                          (delegated to the profile-evaluator — the SAME component the loader's
//                          chain and the tool resolver's Layer 0 use; call, don't contain).
//
// EVALUATION ORDER & DENY-FIRST. The conjuncts are checked in the chain order
// client-has-skill → registry-enabled → adapters-valid → scope-permits → profile-permits,
// failing LOUD and EARLY on the first that does not hold (validate before acting). Because it
// is an AND the order does not change WHETHER a skill activates, only WHICH gate the operator
// sees first — and that gate is named in the LoaderError.

import { GATES, LoaderError } from "./errors.js";
import { defaultAdapterKinds } from "../registry/index.js";
import { validateKindContract, defaultSkillKinds } from "../registry/index.js";

// Activation gate names. The canonical home is the shared GATES enum in errors.js (the loader
// spine); the activation-specific links (CLIENT_HAS_SKILL, REGISTRY_ENABLED, TYPING, SCOPE)
// were added there as part of the T-MVP-11 seam, and PROFILE already existed. This alias just
// names the SUBSET activation uses, so the conjunct code reads `ACTIVATION_GATES.SCOPE` while
// every value still comes from the one enum (no duplicate definition).
export const ACTIVATION_GATES = Object.freeze({
  CLIENT_HAS_SKILL: GATES.CLIENT_HAS_SKILL,
  REGISTRY_ENABLED: GATES.REGISTRY_ENABLED,
  TYPING: GATES.TYPING,
  SCOPE: GATES.SCOPE,
  PROFILE: GATES.PROFILE,
});

/**
 * Does a scope axis admit a value? `"*"` (or an absent/empty axis) means "any".
 * @param {string[]|undefined} axis  the registry scope axis (e.g. scope.clients).
 * @param {string|null|undefined} value  the (client) or (project) to test.
 */
function scopeAdmits(axis, value) {
  if (!Array.isArray(axis) || axis.length === 0) return true; // unspecified = any
  if (axis.includes("*")) return true;
  if (value == null) return false; // a narrowed scope needs a concrete value to match
  return axis.includes(value);
}

/**
 * Evaluate the full activation predicate for one recognized skill in one client context.
 *
 * Conjunct 1 (recognition) is assumed satisfied by the caller (it is what produced
 * `skillName`); this function evaluates conjuncts 2–6 and throws a LoaderError naming the
 * first failing gate, or returns an activation record when all hold.
 *
 * @param {object} args
 * @param {string} args.skillName  the recognized skill's registry key.
 * @param {object} args.clientContext  the loaded client context (from loadClientConfig):
 *        needs `identifier` and `skills: string[]` (the adopted skills); `profile` optional.
 * @param {object} args.registry  the parsed skillforge.registry.json.
 * @param {string|null} [args.project]  the active project (for scope); null = none.
 * @param {object} [args.kinds]  the adapter-kinds catalog; defaults to defaultAdapterKinds().
 * @param {{evaluate:(profile:string|null,feature:string)=>{decision:string,reason?:string}}} [args.profileEvaluator]
 *        the profile-evaluator (conjunct 6); defaults to defer-all (allow). The real evaluator
 *        is injected by the caller (the loader already owns one).
 * @param {Iterable<string>} [args.requiredFeatures]  features the skill needs, checked against
 *        the profile-evaluator for conjunct 6.
 * @returns {{ skill: string, client: string, project: string|null, entry: object }}
 *        an activation record (all six conjuncts hold).
 * @throws {LoaderError} naming the first failing conjunct's gate.
 */
export function activate({
  skillName,
  clientContext,
  registry,
  project = null,
  kinds = defaultAdapterKinds(),
  skillKinds = defaultSkillKinds(),
  profileEvaluator = deferAllProfileEvaluator,
  requiredFeatures = [],
}) {
  if (typeof skillName !== "string" || skillName === "") {
    throw new LoaderError(
      ACTIVATION_GATES.CLIENT_HAS_SKILL,
      "activate() requires a recognized skillName (conjunct 1, recognition, is the caller's input)",
      { field: "skillName" },
    );
  }
  if (!clientContext || typeof clientContext !== "object") {
    throw new LoaderError(
      ACTIVATION_GATES.CLIENT_HAS_SKILL,
      "activate() requires a loaded clientContext",
      { field: "clientContext" },
    );
  }
  const client = clientContext.identifier ?? null;

  // ---- conjunct 2: client-has-skill ----------------------------------------------------
  const adopted = Array.isArray(clientContext.skills) ? clientContext.skills : [];
  if (!adopted.includes(skillName)) {
    throw new LoaderError(
      ACTIVATION_GATES.CLIENT_HAS_SKILL,
      `client "${client ?? "?"}" has not adopted skill "${skillName}" (its config does not select it)`,
      { field: "skills", name: skillName },
    );
  }

  // ---- conjunct 3: registry-enabled ----------------------------------------------------
  const entry = registry?.skills?.[skillName];
  if (!entry || typeof entry !== "object") {
    throw new LoaderError(
      ACTIVATION_GATES.REGISTRY_ENABLED,
      `skill "${skillName}" has no registry entry (cannot activate an unregistered skill)`,
      { name: skillName },
    );
  }
  if (entry.enabled !== true) {
    throw new LoaderError(
      ACTIVATION_GATES.REGISTRY_ENABLED,
      `skill "${skillName}" is disabled in the registry (enabled:${JSON.stringify(entry.enabled)}); it never activates`,
      { name: skillName },
    );
  }

  // ---- conjunct 4: adapters-valid (kind contract) --------------------------------------
  // Resolve the skill's declared kind to its descriptor, then delegate to validateKindContract
  // — the SAME primitive the registry-lint gate uses (single definition of "valid wiring").
  // For an artifact-family kind it type-checks the adapter pairing; for a references-family kind
  // it asserts no adapters are wired. A missing/unknown skillKind, or any contract violation,
  // stops activation with a uniform, gate-named failure (validate before acting, fail loud).
  if (typeof entry.skillKind !== "string" || entry.skillKind === "") {
    throw new LoaderError(
      ACTIVATION_GATES.TYPING,
      `skill "${skillName}" declares no skillKind (known: ${skillKinds.kinds().join(", ")})`,
      { name: skillName, field: "skillKind" },
    );
  }
  if (!skillKinds.has(entry.skillKind)) {
    throw new LoaderError(
      ACTIVATION_GATES.TYPING,
      `skill "${skillName}" declares unknown skillKind "${entry.skillKind}" (known: ${skillKinds.kinds().join(", ")})`,
      { name: skillName, field: "skillKind" },
    );
  }
  const descriptor = skillKinds.get(entry.skillKind);
  const kindViolations = validateKindContract({ entry, descriptor, kinds });
  if (kindViolations.length > 0) {
    throw new LoaderError(
      ACTIVATION_GATES.TYPING,
      `skill "${skillName}" violates its "${entry.skillKind}" kind contract:\n  - ${kindViolations.join("\n  - ")}`,
      { name: skillName, violations: kindViolations },
    );
  }

  // ---- conjunct 5: scope-permits -------------------------------------------------------
  const scope = entry.scope ?? {};
  if (!scopeAdmits(scope.clients, client)) {
    throw new LoaderError(
      ACTIVATION_GATES.SCOPE,
      `skill "${skillName}" is out of scope for client "${client ?? "?"}" (scope.clients=${JSON.stringify(scope.clients)})`,
      { name: skillName, field: "scope.clients" },
    );
  }
  if (!scopeAdmits(scope.projects, project)) {
    throw new LoaderError(
      ACTIVATION_GATES.SCOPE,
      `skill "${skillName}" is out of scope for project "${project ?? "?"}" (scope.projects=${JSON.stringify(scope.projects)})`,
      { name: skillName, field: "scope.projects" },
    );
  }

  // ---- conjunct 6: profile-permits -----------------------------------------------------
  // Call the profile-evaluator (call, not contain) for each feature the skill requires. A
  // deny, a malformed verdict, or a throwing evaluator all stop activation (deny-first /
  // fail-closed) — the same discipline the loader applies at its profile link.
  const profile = clientContext.profile ?? null;
  for (const feature of requiredFeatures) {
    let verdict;
    try {
      verdict = profileEvaluator.evaluate(profile, feature);
    } catch (cause) {
      throw new LoaderError(
        ACTIVATION_GATES.PROFILE,
        `the profile-evaluator threw while checking feature "${feature}" for skill "${skillName}" under the "${profile ?? "unspecified"}" profile; treating as denied (fail-closed)`,
        { name: skillName, field: "profile", cause },
      );
    }
    if (!verdict || typeof verdict !== "object" || typeof verdict.decision !== "string") {
      throw new LoaderError(
        ACTIVATION_GATES.PROFILE,
        `the profile-evaluator returned a malformed verdict for feature "${feature}" (skill "${skillName}"); treating as denied (fail-closed)`,
        { name: skillName, field: "profile" },
      );
    }
    if (verdict.decision !== "allow") {
      throw new LoaderError(
        ACTIVATION_GATES.PROFILE,
        `skill "${skillName}" requires feature "${feature}", forbidden under the "${profile ?? "unspecified"}" profile` +
          (verdict.reason ? `: ${verdict.reason}` : ""),
        { name: skillName, field: "profile" },
      );
    }
  }

  // All six conjuncts hold.
  return { skill: skillName, client, project, entry };
}

/**
 * A predicate form of {@link activate}: returns true/false instead of throwing. Useful for
 * callers that want to test activatability without handling an exception (e.g. listing which
 * of a client's adopted skills are currently activatable).
 *
 * @returns {boolean} true iff all six conjuncts hold.
 */
export function canActivate(args) {
  try {
    activate(args);
    return true;
  } catch (e) {
    if (e instanceof LoaderError) return false;
    throw e; // a non-activation error (programmer error) is not a quiet "no"
  }
}

/**
 * The default profile-evaluator seam: defers (allow) for every (profile, feature). Mirrors the
 * loader's deferAllProfileEvaluator so activation behaves identically until the real evaluator
 * is injected. The real, table-driven evaluator (T-MVP-03) is passed in by the caller.
 */
export const deferAllProfileEvaluator = Object.freeze({
  evaluate: () => ({ decision: "allow" }),
});
