# Skill-Type System Architecture

> _Sources: written from the concept + first principles; zero files from any third-party codebase (clean-room)._

The skill-type system is how skillforge runs many different *kinds* of skill — generating a
file, composing a prompt, running a validation, producing an analysis report, applying a
multi-file transformation, syncing two systems — through **one** engine. A skill's kind is named
by its `skillKind` field in `skillforge.registry.json`, and each kind is described by a frozen
**`SkillKindDescriptor`** that declares *how* that kind runs: which lifecycle stages apply, where
its input comes from, what governance class it carries, how its side effects are projected as tool
calls, and what its return envelope looks like. The engine reads descriptors; it never branches on
the literal kind string. Adding a new kind is therefore adding **data** — a descriptor plus a
compose function plus a registry entry — never a new top-level run function. This keeps the engine
open for extension and closed for modification, and keeps all client-specific knowledge at the
edges as data the engine consumes.

---

## The six skill kinds

Every kind shares the same orchestrator and the same `compose` call signature
(`{ request, description, references }`); they differ only in the descriptor data below. Two axes
organize them: **output shape** (what the compose returns) and **side-effect class** (whether the
engine itself issues a governed tool call).

| `skillKind` | Input source | Governance | Output shape | Typical use |
|---|---|---|---|---|
| `artifact` | adapter | `write` | a spec → one rendered file | Generate a component (React, web-component, …) from a client DS + a request |
| `instruction` | references | `none` | `{ instructions, context?, request? }` | Compose a prompt (SKILL.md + injected client context) for an LLM/agent |
| `validation` | references | `none` | `{ pass, violations[] }` | Run a contract/guard and emit a typed pass/fail verdict |
| `analysis` | references | `none` | `{ report }` | Read-only audit producing a schema'd report (scores, findings, no verdict) |
| `transformation` | adapter | `write` | `{ plan[] }` → many files | Read-many → write-many (token rename, component migration) via plan → approve → apply |
| `sync` | adapter | `bidirectional` | `{ intents[] }` (both sides) | Bidirectional write (e.g. design ↔ code) with the full two-way blast radius gated and audit-logged |

### `artifact`

Reads the client design system through an **input adapter**, composes a spec (required: a
`componentName`), builds and renders the artifact through an **output adapter**, and writes the
result as a single governed `Write`. Governance class `write`: its `sideEffects` projects one
`Write` intent whose `file_path` is resolved from the client's `componentOutputDir` parameter and
the artifact's own filename (the output adapter owns the extension, so a non-React client is named
correctly). The gate must pass before the write happens.

### `instruction`

Reads client resources via the **references** map (no adapter), composes a prompt (required: a
string `instructions` field), and returns it for an LLM/agent to consume. Governance class `none`:
the engine issues no side effect, so the gate stage does not run. The skill's `requiredTools` clamp
and deployment policy still apply to whatever tools the downstream *agent* invokes — those calls are
governed by the same PreToolUse hook at the agent's call time, not pre-issued by the engine.

### `validation`

A read-only kind in the references family. Composes a typed verdict (required:
`{ pass: boolean, violations: string[] }`). Governance class `none` — the verdict *is* the result,
never a write. A validation skill is itself a gate for other operations (CI-style semantics), but
running it produces no engine side effect.

### `analysis`

A read-only kind in the references family, like validation, but its output is descriptive rather
than a verdict: required `{ report }` (an arbitrary report payload). Governance class `none`. The
report is consumed by other skills or by an operator; the kind contract enforces the report field
is present.

### `transformation`

A multi-write kind in the adapter family. Reads a normalized description through an input adapter
and composes a **plan** (required: a non-empty `plan[]` array of intended changes). Unlike artifact
(one spec → one write) a transformation fans out to many writes: `sideEffects` projects *every* plan
entry as a tool call, so the gate sees the full blast radius before anything is applied (plan →
operator approval → apply). Governance class `write`.

### `sync`

A bidirectional, multi-write kind in the adapter family. Reads a description through an input
adapter and composes a non-empty `intents[]` array — the writes for **both** sides of the sync.
`sideEffects` projects every intent, so the gate sees both directions' blast radius before
anything is applied. Governance class `bidirectional` (distinct from transformation's `write`)
names that the writes flow two ways; every gated intent is recorded on the audit trail via the
executor's generic audit tap, so the two-way sync is fully attributable.

---

## `SkillKindDescriptor`

A descriptor is a frozen object (pure data plus small pure functions) living in
`src/registry/kinds/<kind>.js`. It is the single extension surface for a kind — the engine reads
only these fields and never imports a kind by name.

| Field | Type | What it controls |
|---|---|---|
| `kind` | `string` | The `skillKind` string this descriptor answers to (its catalog key). |
| `compose.inputSource` | `"adapter" \| "references"` | Whether compose's material is read through an input adapter (`read` stage) or from the loader-resolved references map (`resolveRefs` stage). |
| `compose.validateOutput` | `(composed) => string[]` | Shape-checks the compose output against the kind contract; a non-empty array of messages aborts the run before any downstream stage consumes the output. |
| `stages` | `Set<string>` | The subset of the fixed stage pipeline this kind runs. The executor walks the canonical order and runs only the stages in this set. |
| `governance` | `"none" \| "write" \| "bidirectional"` | The governance class. `none` skips the gate stage; `write`/`bidirectional` run it against the projected intents. |
| `sideEffects` | `(parts) => Intent[]` | Projects the kind's side effects as `{ tool, toolInput }` tool-call intents for the gate. A `none` kind returns `[]`; write kinds return one or more intents derived from the composed output. |
| `envelope` | `(parts) => object` | Assembles the kind's public return shape from the accumulated lifecycle `parts`. Each kind exposes exactly the fields meaningful to it. |

The `parts` object passed to `sideEffects` and `envelope` is the accumulating pipeline state — it
carries `activation`, `clientContext`, `description`, `references`, `composed`, `result`,
`artifact`, `gate`, and `promptTiers`, each populated by the stage that produces it.

A registry-lint invariant (`LINT-GOVERNANCE-SIDEEFFECTS`) couples `governance` to `sideEffects`: a
`write`/`bidirectional` kind must be able to return a non-empty intent list (so the gate has
something to govern) and a `none` kind must return `[]`. The lint calls `sideEffects` with mock
`parts` and asserts the shape behaviorally, so a misdeclared kind fails at start-up rather than
silently mis-routing.

---

## `GenericExecutor` — the descriptor-driven pipeline

`execute()` in `src/engine/executor.js` is the single runner all kinds pass through. It owns the
**order** of the lifecycle and the descriptor-gated **subset** of stages — nothing else. Every
stage delegates to a layer the engine already owns, injected through `deps` (loader, adapters,
governance, telemetry), so the executor re-implements no policy, typing, rendering, or failure
interpretation, and imports no concrete client or skill.

The canonical stage order (`STAGE_ORDER`, deny-first / validate-before-acting) is:

```
load → activate → read → resolveRefs → compose → build → gate → emit → telemetry
```

| Stage | Runs for | What it does |
|---|---|---|
| `load` | all | Load the client config through the loader chain → `clientContext`. |
| `activate` | all | The six-conjunct deny-first activation predicate; a failing conjunct throws. |
| `read` | `inputSource: "adapter"` | Read the client DS through the input adapter under the runtime-failure contract (empty/partial/thrown read aborts). |
| `resolveRefs` | `inputSource: "references"` | Read + parse each resolvable reference behind the same failure classifier, handing compose already-parsed data so compose never touches the filesystem. |
| `compose` | all | The skill core: the generic recipe meets this client's material. Output validated against `descriptor.compose.validateOutput` before anything consumes it. |
| `build` | adapter kinds with an output adapter | Build the normalized result + render the artifact through the output adapter. |
| `gate` | `governance !== "none"` | For each `descriptor.sideEffects(parts)` intent, run the PreToolUse check; a denied intent aborts. |
| `emit` | all | Assemble the prompt-tier handoff into `parts.promptTiers`. |
| `telemetry` | all (best-effort) | Opt-in observability emission through the injected sink; a throwing sink never fails the run. |

The executor's loop is `for (stage of STAGE_ORDER) if (descriptor.stages.has(stage)) run(stage)`.
Stage *ordering* is fixed in the executor; a kind can omit a stage, never reorder one. After the
loop, the executor returns `descriptor.envelope(parts)`.

The `gate` stage is generic over kind. It folds the client config's `orgBaseline` rules into the
org policy layer, then for each projected intent calls the hook's `check()` with the skill's
`requiredTools` clamp, the client profile, and the policy layers. When a `deps.auditTrail` is
injected, it records `{ tool, decision, skill, client, project }` for every gated intent — the
generic **audit tap**, keyed on nothing kind-specific, so a multi-write or bidirectional kind's
full blast radius is attributable. Recording is best-effort; the deny is the enforcement boundary,
not the record. Compose is `await`ed, so a recipe that assembles data asynchronously works without
leaking an unresolved Promise into `validateOutput`/`build`.

---

## The kind catalog — registering a new kind (OCP)

The set of known kinds lives in `src/registry/skill-kinds.js` and is exposed through
`src/registry/index.js` as `createSkillKinds` / `defaultSkillKinds`. The catalog is a small map
wrapper:

```js
export function createSkillKinds(seed = {}) {
  const catalog = new Map(Object.entries(seed));
  return {
    get(kind) {
      if (!catalog.has(kind)) {
        throw new Error(`unknown skillKind "${kind}" (known: ${[...catalog.keys()].join(', ')})`);
      }
      return catalog.get(kind);
    },
    has(kind) { return catalog.has(kind); },
    kinds() { return [...catalog.keys()]; },
  };
}

export function defaultSkillKinds() {
  return createSkillKinds({
    [artifactDescriptor.kind]: artifactDescriptor,
    [instructionDescriptor.kind]: instructionDescriptor,
    [validationDescriptor.kind]: validationDescriptor,
    [analysisDescriptor.kind]: analysisDescriptor,
    [transformationDescriptor.kind]: transformationDescriptor,
    [syncDescriptor.kind]: syncDescriptor,
  });
}
```

`createSkillKinds(seed)` is the injectable factory (a run can seed an alternate catalog for tests);
`defaultSkillKinds()` is the production catalog that imports the six descriptors. The
`get(kind)` accessor fails loud on an unknown kind — the same fail-loud discipline the adapter
typing enforces.

**To add a kind:**

1. Write `src/registry/kinds/<kind>.js` exporting a frozen descriptor with the six fields above.
2. Re-export it from `src/registry/kinds/index.js`.
3. Add one line to `defaultSkillKinds()` binding `descriptor.kind → descriptor`.
4. Give each skill of that kind a registry entry whose `skillKind` matches, plus a `compose` ref
   (below).

No executor edit is required: the executor reads only `descriptor.stages`, `descriptor.governance`,
`descriptor.sideEffects`, `descriptor.compose`, and `descriptor.envelope`. The descriptor is the
whole extension surface. The only friction is that a kind needing a genuinely novel *stage* (not
just a novel subset of the existing stages) requires adding that stage to the pipeline — a
deliberate, reviewed engine change. That friction is intentional: novel lifecycle stages should be
rare and scrutinized.

Activation makes `skillKind` load-bearing: the activation predicate resolves the descriptor for the
entry's `skillKind` (failing on an unknown kind) and validates the contract that kind declares —
adapter typing for adapter kinds, the reference contract for references kinds — via
`validateKindContract` in `src/registry/typing.js`. A registry-lint rule requires every skill to
declare a `skillKind` the catalog knows, so a registry kind with no descriptor fails at start-up.

---

## Compose binding — data, not a table

A compose function is a *per-skill* plugin, not per-kind (many skills can share one kind, each with
its own compose). The binding from a skill to its compose function is **data**:
`src/skills/compose-registry.js` resolves a registry entry's `compose` ref string —
`"<dir>/compose.js#<export>"` — to the actual callable.

The compose-registry mirrors the adapter resolution pattern: a static `COMPOSE_BY_REF` table
enumerates every compose export the engine knows, keyed by the same ref string a registry entry
carries. Adding a recipe is a deliberate, visible code touch in that one table.

```js
export function resolveComposeRef(ref) {
  if (typeof ref !== "string") return null;
  const fn = COMPOSE_BY_REF[ref];
  return typeof fn === "function" ? fn : null;
}

export function get(skillName, entry) {
  const fn = resolveComposeRef(entry?.compose);
  if (typeof fn !== "function") {
    throw new Error(
      `no compose step registered for skill "${skillName}" (compose ref: ${JSON.stringify(entry?.compose)})`,
    );
  }
  return fn;
}
```

The module deliberately does **not** import `skillforge.registry.json`: the engine already carries
the parsed registry and passes the per-skill `compose` ref in, so a caller running against a
sandboxed or alternate tree (e.g. the determinism gate) is not coupled to the repo-root JSON.
`resolveComposeRef` is pure over its input, so the run path and registry-lint
(`LINT-COMPOSE-REQUIRED`) share one resolver with no registry dependency.

Keeping the binding as data — one descriptor per kind, many skills per kind, each skill naming its
own compose ref — is what lets a new skill be added with no engine change: a registry entry (with
`skillKind` and `compose`), a `compose.js`, and one line in `COMPOSE_BY_REF`.
