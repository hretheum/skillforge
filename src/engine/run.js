// runSkill — the public orchestrator over the GenericExecutor (docs/05 §"The life cycle of a
// single invocation"). ONE entry point for BOTH skill families: it reads the skill's KIND from
// the registry, picks the kind's descriptor + the skill's compose step, wires the engine's real
// layer surface into the executor's injected `deps`, and wraps the run with the generation-grain
// skill_result emission (OBS-04).
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room).
//
// WHY THIS IS THE SOLE ENTRY POINT. The run path once grew two near-duplicate top-level
// functions — run() (artifact) and runInstruction() (instruction) — each hand-wiring the same
// layers in a slightly different order. runSkill replaces that fork with ONE descriptor-driven
// path: the kind decides which stages run (the descriptor's `stages`), so a third kind is a
// descriptor + a compose entry, never a third top-level function. Phase E removed the old
// run()/runInstruction() shims (src/run.js); callers invoke runSkill directly.
//
// THE COMPOSE LOOKUP IS DATA-DRIVEN (Phase D /). The skill→compose dispatch lives in the
// registry: each skill entry carries a `compose` ref, and the compose-registry resolves it to the
// actual function. runSkill no longer imports any recipe by name nor holds a table; adding a skill
// is a registry entry + its compose.js, not an edit here.
//
// ORCHESTRATION ONLY. runSkill names NO concrete skill — the skill→recipe binding lives in the
// registry data, resolved through the compose-registry; this file owns no policy, no typing, no
// rendering. The executor owns the stage order; the layers own their contracts; this file binds them.

import { loadClientConfig, activate } from "../loader/index.js";
import { getInputAdapter, getOutputAdapter } from "../adapters/index.js";
import { readInput, buildResult, resolveRefs } from "../adapters/run-edges.js";
import { createPreToolUseHook, AuditTrail, validateRequiredToolsInventory } from "../governance/index.js";
import { fromSuccess, fromFailure, emitSkillResult } from "../governance/skill-result.js";
import { redactValue } from "../governance/secret-scan.js";
import { renderPromptTiers, sessionResourceAttributes, cacheDiagnosticAttributes } from "../core/index.js";
import { defaultSkillKinds } from "../registry/index.js";
import { LoaderError, GATES } from "../loader/errors.js";
import { execute } from "./executor.js";
import { composeRegistry } from "../skills/compose-registry.js";

// CC-19: a missing skillKind is no longer silently defaulted. registry-lint already REJECTS an
// entry with no skillKind (LINT-SKILLKIND-REQUIRED, "skillKind must be declared"); the runtime
// previously diverged by defaulting to "artifact" — so a registry that bypassed lint would run a
// kindless skill as a WRITE-class artifact, the riskier direction for a regulated client. The
// runtime now rejects the same way lint does, closing the lint↔runtime divergence.

/**
 * Run one recognized skill end-to-end, for either family, through the GenericExecutor.
 *
 * @param {object} args
 * @param {string} args.clientsDir   where client configs live (loader input).
 * @param {string} args.client       the client identifier to select (DATA).
 * @param {string} args.skillName    the recognized skill's registry key (conjunct-1 recognition
 *        is the caller's input).
 * @param {object} [args.request]    the request DATA (artifact: the component request;
 *        instruction: optional caller context).
 * @param {string|null} [args.project]  the active project (scope).
 * @param {object} args.registry     the parsed skillforge.registry.json.
 * @param {object} [args.profileEvaluator]  injected profile-evaluator (conjunct 6 + Layer 0).
 * @param {object} [args.preToolUseHook]    injected PreToolUse hook; defaults to a fresh one.
 * @param {object} [args.policyLayers]      the deployment's tool-policy layers (forwarded to the gate).
 * @param {Iterable<string>} [args.requiredFeatures]  features the run uses (profile check).
 * @param {object} [args.skillKinds]  the SkillKind catalog; defaults to defaultSkillKinds().
 * @param {(skillName: string, entry: object) => Function} [args.resolveCompose]  resolves a skill
 *        to its compose step from its registry entry's `compose` ref; defaults to the data-driven
 *        compose-registry's get(). Injectable so tests pass fakes without touching real recipes.
 * @param {(event: object) => void} [args.skillResultSink]  injected generation-grain telemetry
 *        sink (PASS/FAIL); optional + best-effort.
 * @param {(attrs: object) => void} [args.telemetrySink]  injected per-session/cache telemetry
 *        sink; optional + best-effort.
 * @param {object} [args.auditTrail]  injected audit trail the executor's gate tap records each
 *        gated intent to; defaults to a fresh in-process AuditTrail.
 * @param {(entry: object) => void} [args.auditSink]  durable transport for the default trail's
 *        recorded entries; optional + best-effort (ignored when args.auditTrail is supplied).
 * @returns {Promise<object>} the kind's envelope (artifact or instruction shape).
 * @throws on a failed activation conjunct, a compose/contract violation, a denied gate, or an
 *   adapter failure — fail loud (and still emit a FAIL skill_result before re-throwing).
 */
export async function runSkill(args = {}) {
  const { skillName, client = null, project = null, skillResultSink } = args;
  try {
    const out = await runSkillCore(args);
    emitSkillResult(fromSuccess({ skill: skillName, client, project }), skillResultSink);
    return out;
  } catch (err) {
    emitSkillResult(fromFailure(err, { skill: skillName, client, project }), skillResultSink);
    throw err;
  }
}

/** The run body — picks the kind's descriptor + compose, wires the real layer surface into the
 *  executor's deps, and delegates. runSkill wraps it with the skill_result emission. Async because
 *  the executor awaits the compose step (CC-09). */
async function runSkillCore({
  clientsDir,
  client,
  skillName,
  request = null,
  project = null,
  registry,
  profileEvaluator,
  preToolUseHook,
  policyLayers = {},
  requiredFeatures = [],
  skillKinds = defaultSkillKinds(),
  resolveCompose = composeRegistry.get,
  telemetrySink,
  auditTrail,
  auditSink,
  toolInventory,
} = {}) {
  // --- pick the kind from the registry (static config — no activation needed to know the kind) -
  // An unregistered skill cannot run — and since adoption presupposes registration, this is an
  // activation-domain failure. Throw a gate-named LoaderError (CLIENT_HAS_SKILL) so legacy callers
  // that inspect `.gate` get the canonical activation gate, while the message keeps "no registry
  // entry" for callers that match on it. (This is the deny-first link before a kind can be picked.)
  const entry = registry?.skills?.[skillName];
  if (!entry || typeof entry !== "object") {
    throw new LoaderError(
      GATES.CLIENT_HAS_SKILL,
      `skill "${skillName}" has no registry entry (cannot run an unregistered skill)`,
      { name: skillName },
    );
  }
  // CC-19: reject a missing skillKind instead of silently defaulting to "artifact". A kindless entry
  // is a registry error that lint already rejects (LINT-SKILLKIND-REQUIRED); the runtime must not
  // diverge by running it as a write-class artifact. Fail loud with the same wording the lint uses.
  if (typeof entry.skillKind !== "string" || entry.skillKind.length === 0) {
    throw new LoaderError(
      GATES.CLIENT_HAS_SKILL,
      `skill "${skillName}" has no skillKind declared (skillKind must be declared; cannot default a kindless skill to a write-class artifact)`,
      { name: skillName },
    );
  }
  const kind = entry.skillKind;
  const descriptor = skillKinds.get(kind); // throws with the known-kinds list on an unknown kind

  // --- CC-36: requiredTools vs deployment inventory (startup-time, before any side effect) -----
  // The PreToolUse gate DENIES a per-call tool the skill never declared; it cannot catch the
  // reverse — a tool the skill DECLARES but the deployment never exposes (the call simply never
  // arrives). When the caller supplies the deployment's actual tool inventory, fail loud here so a
  // skill wired for tools its surface lacks is rejected before it runs, not silently under-served.
  if (Array.isArray(toolInventory) && toolInventory.length > 0) {
    const requiredTools = entry.requiredTools ?? [];
    const { valid, missing } = validateRequiredToolsInventory(requiredTools, toolInventory);
    if (!valid) {
      throw new LoaderError(
        GATES.TOOL_INVENTORY,
        `skill "${skillName}" requires tools the deployment does not expose: [${missing.join(", ")}]`,
        { name: skillName },
      );
    }
  }

  // --- resolve the skill's compose step off the registry's `compose` ref (Phase D) ------------
  // The skill→recipe binding now lives in the registry as DATA; the compose-registry resolves the
  // ref to the actual function. An unresolvable skill throws (fail loud — never a silent recipe).
  const compose = resolveCompose(skillName, entry);

  // --- wire the engine's real layer surface into the executor's injected deps -------------------
  // Each is the same callable the existing run path uses; the executor owns only the ORDER.
  const deps = {
    loadClientConfig: (a) => loadClientConfig({ ...a, profileEvaluator, requiredFeatures }),
    activate,
    getInputAdapter,
    readInput,
    resolveRefs,
    getOutputAdapter,
    buildResult,
    preToolUseHook: preToolUseHook ?? createPreToolUseHook(),
    emitTelemetry: defaultEmitTelemetry,
    // The audit trail the executor's generic gate tap records to. Injectable so a deployment can
    // pass a trail with its own durable sink; defaulted to a fresh in-process trail (with an
    // optional sink) so the bidirectional/multi-write blast radius is attributable out of the box.
    auditTrail: auditTrail ?? new AuditTrail({ sink: auditSink }),
  };

  return await execute({
    descriptor,
    request,
    skillName,
    client,
    project,
    compose,
    deps,
    loadArgs: { clientsDir, profileEvaluator, requiredFeatures },
    registry,
    policyLayers,
    telemetrySink,
  });
}

/**
 * The default telemetry emitter the orchestrator hands the executor. Best-effort and
 * secret-free, mirroring src/run.js's emitTelemetry: a missing sink no-ops; a throwing sink is
 * swallowed; only the skill + client handle and the two opaque cache fingerprints ride along.
 *
 * @param {(attrs: object) => void} [sink]
 * @param {{ skillName: string, client: string|null, promptTiers: object|null }} ctx
 */
export function defaultEmitTelemetry(sink, { skillName, client, promptTiers }) {
  if (typeof sink !== "function") return;
  try {
    const session = client
      ? sessionResourceAttributes({ skill: skillName, client })
      : { "skillforge.skill": skillName };
    const rendered = renderPromptTiers(promptTiers);
    const cacheDiag = cacheDiagnosticAttributes({
      tier1PrefixHash: rendered.tier1PrefixHash,
      tier2ContentHash: rendered.tier2ContentHash,
    });
    // Redact on the wire (AC: scan + REDACT on outbound). The attributes are built secret-free by
    // construction (sessionResourceAttributes refuses a credential-shaped handle), but the outbound
    // redaction pass strips any credential-shaped span as a last guarantee before the sink sees it.
    sink(redactValue({ resourceAttributes: session, cacheDiagnostics: cacheDiag }));
  } catch {
    // best-effort: telemetry never fails a generation.
  }
}
