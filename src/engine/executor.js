// The GenericExecutor — one descriptor-driven stage pipeline that BOTH skill families run
// through (docs/05 §"The life cycle of a single invocation", architecture §2.3 the stage
// pipeline).
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room).
//
// ONE PIPELINE, TWO KINDS. The artifact family (a file is written, governed) and the
// instruction family (a prompt is composed, no side effect) are not two run paths — they are
// the SAME ordered pipeline with a DIFFERENT subset of stages enabled. The descriptor
// (src/registry/kinds/*) declares which stages a kind runs; the executor walks the FIXED stage
// order and runs only the stages in `descriptor.stages`. So adding a third kind is a descriptor
// + a stage handler, never a new top-level run function (which is how the run path once grew two
// near-duplicate functions — run() and runInstruction(), removed in Phase E).
//
// THE FIXED STAGE ORDER (the order docs/05 traces; deny-first, validate-before-acting):
//
//   load → activate → read → resolveRefs → compose → build → gate → emit → telemetry
//
//   load        — load the client config (loader chain).
//   activate    — the six-conjunct activation predicate (deny-first; a failing conjunct throws).
//   read        — read the client DS through the INPUT adapter (artifact family only).
//   resolveRefs — expose the loader-resolved references map to compose (instruction family only).
//   compose     — the skill core: the generic recipe meets this client's material. The compose
//                 FUNCTION is supplied by the caller (ctx.compose), never imported by name here,
//                 so the executor names no concrete skill.
//   build       — build the normalized RESULT + render the artifact (output adapter; artifact only).
//   gate        — the PreToolUse tool gate on the descriptor's side effects (artifact only).
//   emit        — assemble the kind's envelope (descriptor.envelope) — the executor's return.
//   telemetry   — best-effort, opt-in observability emission (never fails the run).
//
// ORCHESTRATION ONLY — NO RE-IMPLEMENTATION. Every stage delegates to a layer the engine
// already owns, passed in through `deps` (loader, adapters, run-edges, governance, core). The
// executor owns no policy, no typing, no rendering, no failure interpretation — it owns the
// ORDER and the descriptor-gated SUBSET, nothing else. `deps` is injected so the pipeline is
// unit-testable with fakes (and so this module imports no concrete client/skill).

/** The canonical stage order. The executor walks THIS list; a kind runs the intersection of it
 *  with `descriptor.stages`. Order is FIXED (deny-first); a kind can omit a stage, never reorder. */
export const STAGE_ORDER = Object.freeze([
  "load",
  "activate",
  "read",
  "resolveRefs",
  "compose",
  "build",
  "gate",
  "emit",
  "telemetry",
]);

/**
 * Run one request through the descriptor-driven pipeline.
 *
 * @param {object} args
 * @param {object} args.descriptor  the SkillKind descriptor (from defaultSkillKinds().get(kind)):
 *        supplies `stages` (the enabled subset), `compose.validateOutput`, `governance`,
 *        `sideEffects(parts)`, and `envelope(parts)`.
 * @param {object} args.request     the request DATA (artifact: the component request; instruction:
 *        optional caller context). The executor never inspects it — it threads it to compose.
 * @param {string} args.skillName   the recognized skill (conjunct-1 recognition is the caller's input).
 * @param {string} args.client      the client identifier to select (DATA).
 * @param {string|null} [args.project]  the active project (scope).
 * @param {(parts: object) => object} args.compose  the skill core's compose step — SUPPLIED BY
 *        THE CALLER (the orchestrator's dispatch), never imported by name here. Receives
 *        `{ request, description, references }` and returns the kind's composed output (a spec for
 *        artifact, `{instructions,...}` for instruction); validated against descriptor.compose.
 * @param {object} args.deps        the injected layer surface — orchestration delegates, never
 *        re-implements. Required fields by enabled stage:
 *          load:        loadClientConfig({clientsDir, client, profileEvaluator, requiredFeatures})
 *          activate:    activate({skillName, clientContext, registry, project, profileEvaluator, requiredFeatures})
 *          read:        getInputAdapter(name) + readInput({adapter, adapterName, readArgs, rotationHint})
 *          build:       getOutputAdapter(name) + buildResult({adapter, adapterName, spec, identity})
 *          gate:        preToolUseHook (a {check(intent)} hook) — defaulted by the orchestrator
 *          telemetry:   emitTelemetry(sink, ctx) — best-effort
 * @param {object} args.loadArgs    the load-stage inputs threaded to deps.loadClientConfig
 *        ({clientsDir, profileEvaluator, requiredFeatures}); kept as a bag so the executor names
 *        no loader-specific field.
 * @param {object} args.registry    the parsed registry (activation + requiredTools).
 * @param {object} [args.policyLayers]  the deployment's tool-policy layers (forwarded to the gate).
 * @param {(attrs: object) => void} [args.telemetrySink]  opt-in, best-effort telemetry sink.
 * @returns {Promise<object>} the kind's envelope (descriptor.envelope(parts)).
 * @throws on a failed activation conjunct, an empty/malformed adapter read, a compose-output
 *   violation, or a denied tool gate — fail loud, before producing a partial result.
 *
 * ASYNC COMPOSE (CC-09). The compose step is `await`ed so a recipe that needs to assemble data
 * asynchronously (e.g. a fintech disclosure skill that awaits a legal-content normaliser) works
 * without its returned Promise leaking into validateOutput/build as an unresolved object. A plain
 * synchronous compose still works — `await` on a non-Promise resolves to the value. The executor is
 * therefore async; the run path awaits it.
 */
export async function execute({
  descriptor,
  request,
  skillName,
  client,
  project = null,
  compose,
  deps,
  loadArgs = {},
  registry,
  policyLayers = {},
  telemetrySink,
} = {}) {
  if (!descriptor || !(descriptor.stages instanceof Set)) {
    throw new Error("execute() requires a descriptor with a `stages` Set");
  }
  if (typeof compose !== "function") {
    throw new Error(`execute() requires a compose function for skill "${skillName}"`);
  }
  if (!deps || typeof deps !== "object") {
    throw new Error("execute() requires an injected `deps` layer surface");
  }

  const runs = (stage) => descriptor.stages.has(stage);

  // The accumulating pipeline state. Each stage reads what earlier stages produced and adds its
  // own product; descriptor.sideEffects/envelope read from this same bag (the "parts").
  const parts = {
    skillName,
    client,
    project,
    request,
    clientContext: null,
    activation: null,
    description: null,
    references: null,
    composed: null,
    spec: null,
    result: null,
    artifact: null,
    gate: null,
    promptTiers: null,
  };

  for (const stage of STAGE_ORDER) {
    if (!runs(stage)) continue;
    switch (stage) {
      case "load":
        parts.clientContext = deps.loadClientConfig({ ...loadArgs, client });
        break;

      case "activate":
        parts.activation = deps.activate({
          skillName,
          clientContext: parts.clientContext,
          registry,
          project,
          profileEvaluator: loadArgs.profileEvaluator,
          requiredFeatures: loadArgs.requiredFeatures ?? [],
        });
        break;

      case "read": {
        // Artifact family: read the client DS through the INPUT adapter under the failure
        // contract (a thrown/empty/partial read aborts — never an empty-context assembly).
        const inputName = parts.clientContext.adapters.input;
        const input = deps.getInputAdapter(inputName);
        parts.description = deps.readInput({
          adapter: input,
          adapterName: inputName,
          readArgs: { references: parts.clientContext.references },
          rotationHint: parts.clientContext.secretRefs?.input ?? null,
        });
        break;
      }

      case "resolveRefs":
        // Instruction family: there is no input adapter, but the client's references are still a
        // RUNTIME edge — a file that resolved at load time can be missing or malformed at call
        // time. So this stage READS + PARSES each resolvable reference behind the SAME failure
        // classifier the input adapter uses (deps.resolveRefs → typed AdapterFailure on a missing
        // path or malformed JSON), and hands compose ALREADY-PARSED data (each entry gains a
        // `data` field) instead of a raw path. Compose never touches the filesystem — the engine
        // owns the edge, the same discipline as the artifact family's `read` stage.
        parts.references = deps.resolveRefs
          ? deps.resolveRefs(parts.clientContext.references)
          : parts.clientContext.references;
        break;

      case "compose": {
        // The skill core: the generic recipe meets this client's material. The compose fn is the
        // caller's (no skill named here). Its output is validated against the descriptor's
        // compose contract BEFORE any downstream stage consumes it (fail loud at the source).
        parts.composed = await compose({
          request,
          description: parts.description,
          references: parts.references,
        });
        // CC-10: a compose that returns null/undefined is a recipe bug, not a contract nuance. Catch
        // it HERE with a clear message before validateOutput — a kind's validateOutput may itself
        // dereference a field (e.g. o.report, o.instructions) and would throw an opaque TypeError on
        // null. Fail loud at the source, before build/gate. (CC-14: an empty STRING "" is NOT caught
        // here — only null/undefined is. Whether "" is acceptable is the per-kind compose contract's
        // call: the artifact kind's spec is an object so "" maps to an empty field its validateOutput
        // judges; an instruction kind treats {instructions:""} as a valid-but-empty payload. The
        // engine rejects ABSENT output, never deliberately-empty output.)
        if (parts.composed === null || parts.composed === undefined) {
          throw new Error(
            `compose() returned ${parts.composed} for skill "${skillName}" — a skill must return a non-null string or object`,
          );
        }
        const violations = descriptor.compose.validateOutput(parts.composed) ?? [];
        if (violations.length > 0) {
          throw new Error(
            `compose output for skill "${skillName}" violates its kind contract:\n  - ${violations.join("\n  - ")}`,
          );
        }
        // For the artifact family the composed output IS the spec the output adapter consumes.
        parts.spec = parts.composed;
        break;
      }

      case "build": {
        // Artifact family: build the normalized RESULT + render the artifact (output adapter,
        // by name), under the failure contract. Pure — the only side effect is the gated Write.
        const outputName = parts.clientContext.adapters.output;
        const output = deps.getOutputAdapter(outputName);
        const built = deps.buildResult({
          adapter: output,
          adapterName: outputName,
          spec: parts.spec,
          identity: parts.spec.componentName,
        });
        parts.result = built.result;
        parts.artifact = built.artifact;
        break;
      }

      case "gate": {
        // The tool gate: every side effect the descriptor declares is a tool call and must pass
        // the PreToolUse hook (resolver scope + secret-scan) BEFORE it happens. A 'none'-governance
        // kind declares no side effects → nothing to gate. Deny-first: a denied intent aborts.
        if (descriptor.governance === "none") break;
        const hook = deps.preToolUseHook ?? (deps.createPreToolUseHook && deps.createPreToolUseHook());
        if (!hook || typeof hook.check !== "function") {
          throw new Error("gate stage requires a PreToolUse hook (deps.preToolUseHook)");
        }
        // The config's orgBaseline rules ARE the org layer (docs/13 §Layer 1). Fold them into the
        // org layer the gate sees so a tool the deployment's config allows is actually permitted —
        // not documentation only. The caller's own policyLayers.org composes alongside them
        // (the resolver folds a layer's rules deny-first, so the concat order is irrelevant).
        const orgBaseline = parts.clientContext.orgBaseline ?? [];
        const layers = {
          ...policyLayers,
          org: [...orgBaseline, ...(policyLayers.org ?? [])],
        };
        const intents = descriptor.sideEffects(parts) ?? [];
        for (const intent of intents) {
          const gate = hook.check({
            profile: parts.clientContext.profile ?? null,
            layers,
            requiredTools: registry?.skills?.[skillName]?.requiredTools ?? [],
            tool: intent.tool,
            toolInput: intent.toolInput,
            mcpPolicy: parts.clientContext.mcpPolicy ?? null,
          });
          parts.gate = gate; // the last intent's verdict (single-intent at MVP)
          // Generic audit tap: when a trail is injected, record the (resource NAME, decision, scope)
          // for EVERY gated intent — keyed on nothing kind-specific, so a multi-write/bidirectional
          // kind's full blast radius is attributable. The trail records names + the verdict, never
          // values (audit-trail.js secret-free contract); recording is best-effort and never the
          // reason a run fails (the deny below is the enforcement boundary, not this record).
          if (deps.auditTrail && typeof deps.auditTrail.record === "function") {
            try {
              deps.auditTrail.record({
                tool: intent.tool,
                decision: gate.decision,
                skill: skillName,
                client,
                project,
              });
            } catch {
              // audit export is observability, never enforcement — see audit-trail.js HONEST BOUNDARY.
            }
          }
          if (gate.decision === "deny") {
            throw new Error(
              `a ${intent.tool} side effect for skill "${skillName}" was denied at the PreToolUse gate: ${gate.reason}`,
            );
          }
        }
        break;
      }

      case "emit":
        // The stability-tiers handoff (docs/02 §stability tiers) — only meaningful where a prompt
        // is rendered. Assembled here so the envelope/telemetry can carry it; the executor does not
        // assert byte-stability (that is the prompt-tier renderer's contract).
        parts.promptTiers = {
          tier1: { engine: "skillforge", skill: skillName },
          tier2: parts.description ?? parts.references ?? null,
          tier3: { request, project },
        };
        break;

      case "telemetry":
        // Opt-in, best-effort. A missing dep/sink no-ops; a throwing dep/sink NEVER fails the
        // run — the executor itself guarantees this invariant (so no injected dep can break it),
        // independent of whatever best-effort the dep also applies internally.
        if (typeof deps.emitTelemetry === "function") {
          try {
            deps.emitTelemetry(telemetrySink, {
              skillName,
              client,
              promptTiers: parts.promptTiers,
            });
          } catch {
            // telemetry is observability, never the reason a generation fails.
          }
        }
        break;

      default:
        throw new Error(`executor reached an unhandled stage "${stage}"`);
    }
  }

  return descriptor.envelope(parts);
}
