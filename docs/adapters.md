# Adapters

---

## Why adapters

The skill-factory engine is deliberately **unaware** of the details of the outside world. It does not know
the format in which a given client keeps their **source material**, and it does not know what kind of
**artifact** the result must become. If it did — it would stop being generic: every new source format or
every new kind of output would require digging into the core.

An **adapter** is a swappable plug-in at the **edge** of the engine that translates between "the outside
world" and "the engine's internal, normalized language". There are two edges, hence two kinds of adapters —
and the two are **symmetric**: each one generalizes one axis of "the outside world".

- **Input adapter (`input`)** — stands before the engine. It takes **any kind of client source material**
  and returns a **normalized description** that the engine understands regardless of where the data came
  from or what it was. A design system is just *one* kind of source; equally valid sources include a Jira
  project, Confluence/Notion pages, PDF/DOCX/Markdown documents, a Redmine tracker, and anything else a
  client wants the engine to read. (The list is open — see "Input sources" below.)
- **Output adapter (`output`)** — stands after the engine. It takes the **skill's result** (also in an
  internal, normalized form) and turns it into **any kind of concrete SDLC artifact** in the target form.
  A front-end component is just *one* kind of artifact; equally valid outputs include backend code, tests,
  API specs (OpenAPI), infrastructure-as-code / configuration, documentation, diagrams, tickets/issues,
  database migrations, and anything else. (The list is open — see "Output artifacts" below.)

Thanks to this, the engine core always speaks the same internal language. All the "dirty work" of
translating formats — on **both** edges — lives in the adapters, and that is the only place you swap it
when a new source format or a new kind of artifact appears. Neither edge is special: the input side is not
"the design-system side" and the output side is not "the component side". Both are open catalogs.

### Input sources (open catalog)

An input adapter is generic with respect to the *kind* of source, not just its format. Examples, all peers:

- a **design system** (tokens, components — e.g. a DTCG token file, a design-tool export),
- a **Jira** project (issues, epics, workflows),
- **Confluence / Notion** pages (specs, knowledge bases),
- **documents** — PDF, DOCX, Markdown,
- a **Redmine** tracker,
- **anything else** a client can point the engine at.

The design-system case is the one the first client (the example client) needs first — so it is the leading example
throughout this spec — but it carries no special status in the architecture.

> **Source content is untrusted by default.** Everything an input adapter ingests is third-party content the
> engine does not author, and it enters the prompt as tier-2 CLIENT material alongside tier-1 instructions —
> the inbound (prompt-injection) attack surface. The threat and its controls (content/instruction
> isolation, a STRIDE pass over the four data flows) are modeled in
> [`security.md`](security.md) §"Inbound threats".

### Output artifacts (open catalog)

An output adapter is generic with respect to the *kind* of artifact it produces. Examples, all peers:

- a **front-end component** (React, Web Components, a CMS template),
- **backend** code,
- **tests**,
- **API specs** (e.g. OpenAPI),
- **infrastructure-as-code / configuration**,
- **documentation**,
- **diagrams**,
- **tickets / issues**,
- **database migrations**,
- **a packaged agent-skill bundle** — the factory can also emit its assembled result *as a skill package*
  for an agent runtime to load (e.g. a folder with a manifest plus supporting files; Claude's
  "Agent Skills" packaging, with its `SKILL.md` manifest, is one concrete target). This makes "a skill the
  agent can run" itself an output artifact, alongside code and specs. The manifest/registry shape skillforge
  uses for its *own* skills is described in
  [`skill-manifest-and-registry.md`](skill-manifest-and-registry.md); emitting toward an external
  bundle format is just one more output adapter in this open catalog.
- **anything else** that is an SDLC artifact.

The front-end component is the leading example here because it is what the example client needs first — but, again,
it is one of many, not the privileged one.

```
  client source material        SKILLS CORE            target artifact
 (DS / Jira / docs / …)       (assembly logic)        (any SDLC: component /
        │                          │                   API / tests / IaC / …)
        ▼                          ▼                          ▲
 ┌──────────────┐          ┌───────────────┐          ┌──────────────┐
 │ INPUT        │  norm.   │ skill assembles│  norm.   │ OUTPUT       │
 │ adapter      │ ───────► │ result from    │ ───────► │ adapter      │
 │ (input)      │  desc.   │ generic parts  │  result  │ (output)     │
 └──────────────┘          └───────────────┘          └──────┬───────┘
        ▲                                                     │
        │ reads from references in the config                 ▼
   (see 03)                                          finished artifact
```

> "norm." = the **normalized** form: an internal, fixed shape of data, independent of any specific source
> kind/format or output artifact. It is the shared language the core speaks. **Its shape is a contract, not
> an example** — the envelope (`kind`, `identity`, `content-hash`, `schema-version`), the per-source-kind
> normalized *description*, and the tagged-union normalized *result* are defined in
> [`normalized-form.md`](normalized-form.md). This document describes the *contracts that produce and
> consume* that shape; 04a defines the *shape itself*.

---

## The input adapter contract (`input`)

The input adapter answers one question: *"how do I turn this client's raw source material — whatever kind it
is — into a normalized description that the engine will use to assemble a skill?"*

**What it receives:**
- **references to client resources** — addresses from the config (a token file path, a Jira project handle, a
  Confluence/Notion space, a document path, etc.). The adapter loads the content from those addresses itself;
  the config never carries content (the "references, not content" principle → [`client-model.md`](client-model.md)).
- (optional) **parameters** relevant to reading, if the config declares them — as data.

**What it must return:**
- **a normalized description of the source** — the input-edge payload of the normalized form, wrapped in the
  shared envelope (its `kind` is the **source-kind**). The shape is the contract in
  [`normalized-form.md`](normalized-form.md), not an ad-hoc per-adapter blob: one payload shape per
  source-kind (for a design system, tokens/roles/possibly component structure; for a Jira project, issues
  with fields and relations; for documents, structured sections). Whatever the source, the core only ever
  sees the uniform, normalized view — and it must be **byte-deterministic** (see "the determinism rule"
  below, and the canonical-serialization rules in 04a).

**What it must not do:**
- **it does not know the client by name** — the input adapter is generic with respect to the *kind and
  format* of source, not with respect to *client*; a "DTCG token reader" serves any client who keeps tokens in
  DTCG, a "Jira reader" serves any client on Jira, and so on.
- **it does not inject client logic** — it translates the source, it does not make brand or business
  decisions. Such rules arrive as data from the config, not from the adapter.
- **it does not judge content on its merits** beyond what is needed for normalization — validation of the
  *meaning* of the data is done earlier (the config) or higher up (the skill); the adapter cares about
  *shape*.

**The determinism rule:** the same input (the same resources behind the references) must produce the same
normalized description. This makes the whole pipeline repeatable and testable — **and it is also a cost
lever, not just a testing nicety.** The normalized description is the stable, repeated middle of every
prompt the core sends for a given client (tier 2 in the "stability tiers" layout, see
[`architecture-overview.md`](architecture-overview.md)). Backends that can reuse a repeated prompt
**prefix** charge a small fraction for it on re-runs — but a prefix only matches if it is **byte-for-byte
identical** across runs. So "deterministic" here means *byte-deterministic*: stable key ordering, stable
number formatting, no timestamps or run-specific identifiers, no incidental whitespace churn. A
description that is *semantically* the same but *byte*-different on each run quietly forfeits the saving.
For a factory that runs the same client prefix dozens of times, the steady-state input cost of a
byte-stable description can be on the order of ~10% of a naïvely re-sent one (the exact economics — which
are backend-specific — are modelled in [`compliance-and-cost.md`](compliance-and-cost.md)). The
mechanism that *captures* the saving lives at the edge (a runtime/output adapter), but the *precondition*
is the input adapter's byte-determinism — hence it is a hard part of this contract.

---

## The output adapter contract (`output`)

The output adapter answers the question: *"how do I take the skill's result and deliver it as this client's
target artifact — whatever kind of SDLC artifact that is?"*

**What it receives:**
- **the skill's normalized result** — the output-edge payload of the normalized form: a description of the
  intended artifact in an internal, artifact-independent form (e.g. "a component with these parts, bound to
  these tokens/roles", or "an API with these endpoints and schemas", or "these test cases for this
  behavior"). These do not share an internal structure, so the normalized result is a **tagged union over
  the shared envelope** — the envelope's `kind` (the **result-kind**) is the tag that selects the payload
  shape. The contract is in [`normalized-form.md`](normalized-form.md); the typing relationship that
  pairs a skill's emitted result-kind with an adapter's accepted result-kinds is "Skill↔adapter typing"
  below.
- (optional) **output settings** from the config — as data (e.g. a naming convention, the target directory).

**What it must return:**
- **a concrete SDLC artifact in the target form** — e.g. React component file(s), a Web Component definition,
  a CMS element, but equally backend code, a test suite, an OpenAPI spec, IaC/config, documentation, a
  diagram, a tracker ticket, or a DB migration. This is the "product" ready to hand to the world.

**What it must not do:**
- **it does not change the content of the result, only its form** — the output adapter *renders* what the
  skill decided; it does not add decisions of its own. If it began deciding, two output adapters for the same
  skill would yield different *results*, whereas they must yield different *forms of the same result*.
- **it does not reach back to the source** — it works solely on the normalized result it was given.

**The fidelity rule:** for a given skill result the artifact must match the client's contract (e.g. for
the client's component output: a thin React wrapper emitting the canonical classes, with craft staying in the
source CSS — the "code as the source of truth" path, see [`client-model.md`](client-model.md)).
Different output adapters = different *forms/kinds of artifact* for the same intent, not different intents.

---

## Adapters and secrets

Adapters that talk to external systems (a Jira reader, a cloud output adapter, …) need **credentials**. The
contract for that is small and strict: **an adapter *declares* the secrets it requires** — by reference name
and purpose, scoped per integration — but it **never holds the secret values**. At runtime a secret resolver
looks each declared reference up in the configured backend (scoped per client/project/adapter) and hands the
value to the adapter only for the duration of the call; the value never enters the config, a prompt, a log,
telemetry, or an artifact. Declaring required secrets is part of describing an adapter; resolving them is an
environment concern. The full security model — scoping, backends (env/`.env`/keychain/Vault/cloud), least
privilege, and the hard rules — lives in [`security.md`](security.md).

---

## Adapters and file transport

Much of what an adapter moves is **files**: a client's source material on the input edge (a token file, a
PDF/DOCX spec, a CSV dataset, a Jira export) and produced artifacts on the output edge (component files,
an OpenAPI document, a rendered diagram, a DB migration). *That* files cross the edges is part of the
contract; *how the bytes physically reach and leave a given model backend* is a **transport detail that
belongs inside the adapter**, never in the core. The core only ever sees the normalized description (in)
and the normalized result (out) — never a raw blob or a backend-specific file handle.

This keeps two things clean:

- **The "upload-once, reference-many" optimization stays adapter-local.** Some backends let you upload a
  file once, get a handle, and reference it across many calls without re-sending the bytes — the file-layer
  analogue of prefix reuse for prompts. An input adapter that reads the *same* client source on every run
  should exploit that (cache the handle in the client's loaded runtime state, keyed by a content hash so a
  changed source re-uploads — implemented generically as `createUploadCache()` in
  `src/adapters/file-transport.js`, keyed by the envelope's **source content-hash**, the SAME value the
  tier-2 cache-hit diagnostic reads; T-HARD-07), but it does so **behind the contract** — the core is unaware. As with the
  prompt prefix, the saving only holds if the adapter still produces a **byte-deterministic** normalized
  description for the same source bytes (see "the determinism rule" above).
- **Backend-specific file mechanisms are vendor-flavoured, not core.** A concrete example: Claude exposes a
  *Files API* (upload → `file_id` → reference by id) which is a natural transport for a Claude-backed
  adapter. It is also a good illustration of *why* this must sit behind the contract — it carries
  **compliance constraints** that not every client can accept: as of this writing it is **not eligible for
  zero-data-retention** and **not available on the Bedrock/Vertex hosting paths**. A client whose config
  demands ZDR or EU data-residency therefore **cannot** use that particular transport, and the
  loader/validator should reject such an adapter+policy combination loudly rather than silently violate the
  policy (the "validate before acting" rule in [`loader-and-activation.md`](loader-and-activation.md)).
  This is exactly the rule the **deployment profiles** formalize: the Files API is forbidden under the
  hard-compliance profile and allowed under the server-side profile — see
  [`deployment-profiles.md`](deployment-profiles.md) (and the residency/retention facts behind it in
  [`compliance-and-cost.md`](compliance-and-cost.md)). The security model for any credentials such a
  transport needs is [`security.md`](security.md).

The takeaway mirrors the secrets rule: an adapter *declares and handles* its file transport; the engine
core stays unaware of any backend's file API, limits, or compliance flags.

---

## Adapter runtime-failure contract

The contracts above describe the **happy path**. But adapters are the engine's contact with *live external
systems* — a Jira API, a cloud output target, a model backend's file API — and those systems fail in ways
the startup-time validation in [`loader-and-activation.md`](loader-and-activation.md) cannot foresee:
the tracker returns `429` mid-read, a credential is revoked between activation and the call (`401`), a read
times out, an output write half-completes. Start-up validation guarantees the wiring is *valid*; it says
nothing about a system that is valid at start and unreachable at second 30. So every adapter must also honor
a **runtime-failure contract**. The core stays unaware of *which* system failed or *how* — but it relies on
the failure being **classified and surfaced**, never swallowed.

**Every adapter call is bounded.** No adapter call may block indefinitely. Each declares a **timeout**
(a sensible default, overridable as config data); exceeding it is a failure of the *transient* class below,
not a hang.

**Failures are classified into three classes**, and the class dictates the response:

| Class | Examples | Adapter response |
|---|---|---|
| **Transient** | `429` rate-limit, `503`, timeout, a dropped connection | **Retry with backoff**, bounded (a cap on attempts + total time). If still failing after the cap, it becomes a permanent failure for this run. |
| **Auth** | `401`/`403`, expired/revoked credential | **Fail fast** — no retry (retrying a bad credential just burns the budget). Surface a **rotation hint** naming the secret *reference* that needs attention (never the value → [`security.md`](security.md)). |
| **Permanent** | `404` on a referenced resource, malformed source, a `400` the request can't fix | **Stop** — retrying cannot help. Report what was unreachable/invalid. |

**Input failures abort assembly; they never degrade it.** A fatal input-adapter failure (auth, permanent,
or transient-past-cap) **aborts the run** — the core must **not** proceed to assemble a skill on a partial
or empty context. A confidently-wrong artifact built from half a design system is worse than a clean stop;
"no partial-context run" is a hard rule, not a preference.

**Output adapters are idempotent or transactional.** Because an output write can fail *after* starting,
an output adapter must never leave a **half-written artifact** as if it were finished. It satisfies this in
one of two ways: **idempotent** (re-running produces the same final artifact, so a retry is safe) or
**transactional** (**write to a temporary location, then commit atomically** — e.g. write-temp-then-rename
for files, or the target system's own transaction for a tracker/DB). A failed output call leaves the world
either fully updated or untouched — never half-done.

**The failure is data, and it is observable.** A classified failure is surfaced to the caller as a typed
result (class + a human-readable reason + any rotation hint), not an opaque crash, and it feeds the
generation-grain success signal on the dashboard ([`telemetry.md`](telemetry.md)).
The error message carries **no secret values and no raw source content** — the same discipline as everywhere
else at the edge.

> **Why this lives in the adapter, not the core.** The *meaning* of `429` vs `401`, the right backoff, what
> "atomic commit" means for a given target — all of it is backend-specific, so it belongs behind the
> contract, exactly like secrets and file transport. The core only ever sees a **classified outcome**:
> success with a normalized result, or a typed failure of a known class.

---

## Skill↔adapter typing (the result-kind contract)

The output contract says an adapter "renders the skill's normalized result". But genericity is asserted
*across artifact kinds* — a component, an OpenAPI spec, a tracker ticket — and those results have **no
shared internal structure**. So "the skill's result" is not one shape; it is a **tagged union over the
shared envelope**, tagged by **result-kind** ([`normalized-form.md`](normalized-form.md)). That tag
is what lets a skill and an output adapter be **type-checked against each other before any work runs**:

- **A skill declares the result-kind it emits** — e.g. `frontend-component`, `openapi-spec`, `tickets`. This
  is part of the skill's recipe and is recorded as data in the registry
  ([`skill-manifest-and-registry.md`](skill-manifest-and-registry.md)).
- **An output adapter declares the result-kinds it accepts** — a `react` adapter accepts
  `frontend-component`; an `openapi` adapter accepts `openapi-spec`. An adapter may accept more than one kind.
- **The loader / `registry-lint` validates the pairing on the tag alone.** A skill emitting
  `frontend-component` wired to an adapter that only accepts `openapi-spec` is a **wiring error caught at
  start-up** (the "validate before acting" rule), not a malformed artifact discovered at the very end.
  Crucially, the check reads only the **envelope's `kind`** — it never parses the payload, so the core stays
  generic.

The input edge mirrors this: an input adapter's normalized description carries a **source-kind**, and a
skill states which source-kind(s) it can consume; the same start-up check catches a skill pointed at a
source-kind it cannot read. In both directions the rule is the same — **type the edges by `kind`, validate
the wiring as data, parse nothing.**

---

## The symmetry of the two contracts

Both adapters are translators at opposite edges, and they share the same discipline:

| | **input** adapter (`input`) | **output** adapter (`output`) |
|---|---|---|
| Direction | world → engine | engine → world |
| Receives | references to client resources | the skill's normalized result |
| Returns | a normalized description of the source | a concrete SDLC artifact |
| Generic with respect to | the **kind & format** of source (DS, Jira, docs, …) | the **kind** of artifact (component, API, tests, IaC, …) |
| Does not | bring in client logic/decisions | change the content of the result |

Between them the core speaks **exclusively** in the normalized form — that is the axis around which the
genericity of the whole engine turns.

---

## Registering and selecting an adapter

The engine maintains an **adapter registry** — a list of the adapters it knows, each under a stable **name**
(e.g. `dtcg-tokens` or `jira` for input; `react` or `openapi` for output). This registry is the "driver
catalog", and it holds both kinds of adapters side by side.

The client config **selects** adapters **by name** — it declares which input adapter and which output
adapter to use (see [`client-model.md`](client-model.md), the "adapter selection" field). The config
never *defines* an adapter, it only *points at* one. The binding is closed at start-up:

1. The loader reads the client config and reads off the selected adapter names.
2. Validation checks that both names exist in the registry (a typo = stop, with a readable error).
3. The engine takes the right adapters from the registry and plugs them onto the edges of the pipeline for
   this run.

Thanks to this, changing either edge for a client — the source (e.g. design system → Jira) or the output
(e.g. React component → OpenAPI spec) — is **a change of a single field in the config**, provided the target
adapter already exists in the registry. The engine code does not change.

### Namespacing and versioning the registry (API-06)

The registry is **namespaced by edge** and **versioned per adapter**, mirroring the discipline the *skill*
registry already has ([`skill-manifest-and-registry.md`](skill-manifest-and-registry.md), where every
skill carries a `version`):

- **Namespace = the edge.** Every adapter is addressed as `input.<name>` / `output.<name>`. The two edges are
  independent namespaces, so the same short name may legitimately exist on both edges without collision (a
  version is a property of the `(edge, name)` pair, not of a bare name).
- **A per-adapter contract version.** Each catalog entry carries a `MAJOR.MINOR.PATCH` **contract version** —
  the version of the *normalized form it produces/consumes* and its public behavior, not its source revision.
  A breaking change to that contract is a **MAJOR** bump ([`normalized-form.md`](normalized-form.md)
  §versioning).
- **A config can PIN a version.** A `requiredAdapters` entry may be a bare name (no pin — the
  backward-compatible default) **or** a `{ name, version }` object that pins the adapter-contract version the
  skill/config was built against:

  ```jsonc
  "requiredAdapters": {
    "input":  [{ "name": "dtcg-tokens", "version": "1.0.0" }],  // pinned
    "output": ["react"]                                          // unpinned (any catalog version)
  }
  ```

- **The loader / `registry-lint` check compatibility.** Resolution is **semver-compatible**: a pin is
  satisfied when the catalog's MAJOR matches (no breaking change) and its `(minor, patch)` is `>=` the pin.
  A MAJOR mismatch — or a catalog older than the pin needs — is a **wiring error caught at start-up** (the
  "validate before acting" rule, [`loader-and-activation.md`](loader-and-activation.md)), not a runtime
  surprise. The single resolver (`adapter-registry.resolve(edge, name, pin?)`) enforces existence **and** the
  pin in one step, so the loader and `registry-lint` share one definition of "compatible wiring".

This keeps the catalog evolvable: an adapter can ship an additive `MINOR`/`PATCH` without breaking pinned
clients, and a breaking `MAJOR` cannot silently reach a client that pinned the old contract.

---

## How to add a new adapter (step by step)

Adding either kind of adapter follows the same shape — the two are mirror images:

- **A new input adapter** (e.g. a Jira reader, a PDF reader): "take references → return a normalized
  description". You are teaching the engine to read a *new kind of source*.
- **A new output adapter** (e.g. Web Components, an OpenAPI emitter): "take the result → emit an artifact".
  You are teaching the engine to produce a *new kind of SDLC artifact*.

The steps below are written for a **new output adapter**; for an input adapter read each step in the mirror
(source instead of artifact, "normalized description" instead of "rendered output").

1. **Establish the contract, do not reinvent it.** A new output adapter must satisfy *the same* contract as
   every other output adapter (the "output adapter contract" section above): it receives the skill's
   normalized result, it returns an artifact. Your job is only *that* translation, nothing more. (For an input
   adapter: satisfy the input contract — references in, normalized description out.)
2. **Implement the form translation.** Turn the normalized result into a concrete artifact of the target
   kind. Do not make decisions of your own — render what the skill decided. Respect the settings from the
   config (if any) as data. (For an input adapter: turn the raw source into the normalized description, adding
   no interpretation beyond shaping.)
3. **Register the adapter under a stable name.** Add it to the registry under the name the config will use
   (e.g. `web-components` for output, `jira` for input).
4. **Point at it from the client config.** In the config of the client that should use the new edge, set the
   relevant adapter field (output, or input) to that name. (Data only — zero changes in the engine.)
5. **Check determinism/fidelity — and failure behavior.** The same input must yield the same output
   (byte-deterministic per [`normalized-form.md`](normalized-form.md)), and the result must match the
   skill's intent (not the adapter's own additions). Also honor the **runtime-failure contract** above:
   bounded timeout, the three failure classes, and (for output) idempotent-or-transactional writes. Declare
   the `kind` you read/emit so the loader can type-check the wiring ("Skill↔adapter typing"), and the
   **contract `version`** so a config can pin it ("Namespacing and versioning the registry" above).
6. **Ship a gate with the adapter — this is a *registration requirement*, not a courtesy.** Every adapter in
   the catalog MUST declare the gate that proves it, and the gate must actually cover it:
   - **a new INPUT adapter → a determinism golden.** Add a checked-in golden fixture and declare it on the
     catalog entry (`gate: { kind: "determinism-golden", golden: "<file>" }`). The determinism gate then
     proves the same source bytes serialize byte-identically.
   - **a new OUTPUT adapter → a genericity-proof pairing.** Prove it against another output adapter for the
     same result-kind: the same skill, the same client, *two different output adapters* → two artifacts that
     are the same intent in two forms (declare `gate: { kind: "genericity-pair", pairsWith: "<other>" }` and
     add it to the proof's adapter list). (Mirror for input: the same skill fed by two input adapters reading
     equivalent sources assembles the same result.) That is proof that the adapter adds *form*, not *content*.

   The catalog rejects an entry whose declared gate kind does not match its edge, and **`registry-lint` (the
   gate-per-adapter coverage check, [`12`](skill-manifest-and-registry.md) §registry-lint) FAILS** if an
   adapter declares no gate, names a golden that does not exist, or names a genericity pairing it is not
   actually in. **Adding an adapter without its gate therefore fails review/CI — the catalog cannot grow
   ungated.**

> **The clean-room rule when adding an adapter:** you design the contract and the naming from the concept
> (this document), not from someone else's code. An adapter translates formats — it is not a place to paste
> in someone else's solutions. The tie-in to the guardrails:
> `docs/security.md`.

---

## Takeaways

- An adapter = **a translator at the edge** of the engine; the core speaks only in the **normalized** form.
- The two edges are **symmetric, open catalogs** — neither is special.
- **Input** (`input`): references → normalized description; generic with respect to the **kind & format** of
  source (design system, Jira, Confluence/Notion, documents, Redmine, …).
- **Output** (`output`): normalized result → a concrete **SDLC artifact**; generic with respect to the
  **kind** of artifact (component, backend, tests, API spec, IaC, docs, diagrams, tickets, migrations, …).
- An adapter **translates form, it does not bring in client decisions** — those arrive as data from the
  config.
- The config **selects** an adapter by name from the **registry**; changing an edge = changing one field. The
  registry is **namespaced by edge** (`input.*` / `output.*`) and **versioned per adapter** (API-06); a config
  may **pin** a contract version and the loader/`registry-lint` check semver-compatibility at start-up.
- A new adapter = the same contract + registration + a pointer from the config; the proof is **genericity**,
  not just that it works — and **shipping that gate is a registration requirement** (input → a determinism
  golden; output → a genericity-proof pairing). The catalog cannot grow ungated.
- The **shape** of the normalized form (envelope + per-kind description / tagged-union result) is its own
  contract → [`normalized-form.md`](normalized-form.md); this doc owns the **contracts that produce
  and consume** it.
- Adapters honor a **runtime-failure contract** (bounded timeout; transient→retry, auth→fail-fast,
  permanent→stop; input-failure aborts assembly; output idempotent-or-transactional) and declare their
  `kind` for **skill↔adapter typing**.

---

## Related documents

- The **shape** these contracts produce and consume — envelope, normalized description, tagged-union result, versioning, byte-stability: [`normalized-form.md`](normalized-form.md)
- Where the config points at an adapter by name (adapter selection, references not content): [`client-model.md`](client-model.md)
- Where adapters sit in the engine and the stability tiers that make byte-determinism a cost lever: [`architecture-overview.md`](architecture-overview.md)
- "Validate before acting" — the loader closing the adapter binding and rejecting wiring/version mismatches at start-up: [`loader-and-activation.md`](loader-and-activation.md)
- The registry/`registry-lint` that records and validates each skill's/adapter's `kind` as data: [`skill-manifest-and-registry.md`](skill-manifest-and-registry.md)
- The security model for adapter credentials, and the inbound (untrusted-source) threat: [`security.md`](security.md)
- Definitions of the terms used here: [`glossary.md`](glossary.md)
