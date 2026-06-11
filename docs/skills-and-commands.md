# Skills and commands

> Part of the **skillforge** specification. Back to the map: [`architecture-overview.md`](architecture-overview.md).
> This document explains **what a skill is** conceptually, how it differs from a command,
> and — through one worked example ("create a component") — how a skill actually works
> step by step. "Create a component" is just *one* skill among many: the same mechanics
> produce any SDLC artifact (tests, an API spec, IaC, docs, tickets, …) from any kind of
> source (a design system, Jira, documents, …); a skill is generic with respect to the
> kind of artifact, exactly as the adapters are. This is a conceptual description of
> what a skill is, not a catalog of the concrete skills the engine ships.
>
> **What a skill *is on disk*** — its file format, frontmatter, and how it is packaged and
> discovered — is the **open [Agent Skills](https://agentskills.io) standard**, which skillforge
> adopts verbatim as its open core. The manifest/registry mechanics live in
> [`skill-manifest-and-registry.md`](skill-manifest-and-registry.md); per-skill tool
> governance lives in [`tool-governance.md`](tool-governance.md). This document stays at the
> conceptual layer and points to those two for the concrete contract.

---

## What a skill is

A **skill** is a named, reusable **agent capability** — a piece of behavior that the agent can
"switch on" when a task calls for it. It is neither a finished script nor a rigid procedure: it is
more of a **recipe for solving a certain class of tasks**, which the agent understands and knows how
to apply in a concrete situation.

For intuition: instead of explaining to the agent from scratch every time "how a component compliant
with this client's design system is created", we lock that knowledge inside a skill named "create a
component". From then on it is enough that a task matches this skill — the agent knows what to do.

Every skill has four components that you have to be able to describe:

- **Name** — what the skill is called and how to recognize it ("create a component").
- **Usage conditions** — when the skill is appropriate: which user request or which context makes
  this particular skill the one that should come into play (e.g. "the user asks for a new UI element").
- **What it does** — the result the skill is meant to produce (e.g. "a finished component file in the
  client's target stack, compliant with their design system").
- **What it is composed of** — which **generic parts** the engine uses to build this behavior:
  references to input/output adapters, steps of core logic, and the points where client knowledge is
  injected. These parts are shared across all clients; the only thing that differs is the client
  config, which the engine substitutes at runtime.

> **The term "adapter"** (full definition → [`adapters.md`](adapters.md)): a replaceable plug at
> the edge of the engine. An **input adapter** reads any kind of client source material (e.g. a design
> system, but equally Jira, Confluence/Notion, documents) and returns its normalized description. An
> **output adapter** takes a skill's result and writes it out as any kind of SDLC artifact (e.g. a React
> component, but equally tests, an API spec, IaC, docs).

### What makes a skill *generic*

The most important rule: **a skill contains no knowledge about any concrete client.** In the body of
the skill there is no name "the example client", no paths to its files, no colors, no token names. Everything
specific to the client is pulled in **from the outside** — through the client config and through the
adapters — only at the moment of execution.

Thanks to this, the same skill serves any client: "create a component" emits a React component compliant
with one client's tokens, or a component in a different stack reading a different design system — and the
*same generic mechanics* underlie other skills entirely (e.g. "generate an API spec" reading a Jira
project, or "scaffold tests" reading a requirements document). The skill code does not change; only the
**data** flowing into it changes. This is the heart of the whole factory: a
[generic engine + a replaceable config](client-model.md).

---

## The skill on disk: the open Agent Skills standard

The four conceptual components above (name, usage conditions, what it does, what it is composed of)
are not a skillforge invention — they map directly onto an existing **open standard**, the
[Agent Skills format](https://agentskills.io). **skillforge adopts that standard verbatim as its open
core**: we do not define a competing skill format. A skill is, concretely, a **directory whose entry
point is a `SKILL.md` file** — YAML frontmatter followed by a Markdown body — optionally bundling
`scripts/`, `references/`, and `assets/`.

Two frontmatter fields carry the conceptual model:

- **`name`** — the skill's identity ("create-component"). This is the *name* component above.
- **`description`** — what the skill does *and* when to use it. This is the *usage conditions* +
  *what it does* components, fused into the one field the agent reads to decide whether the skill
  applies. (In the open standard, **only `name` + `description` drive activation** — the body is read
  *after* the skill is chosen.)

The Markdown body and bundled files carry the *what it is composed of* component: the generic recipe,
references to adapters, and the points where client knowledge is injected. The body never names a
concrete client — the "generic skill" rule above is preserved exactly.

**Why adopt the open standard rather than invent one.** The Agent Skills format was released as an
open standard and is already supported by a broad set of agent runtimes (Claude Code, Cursor, Gemini
CLI, OpenAI Codex, GitHub Copilot/VS Code, Goose, and more). Adopting it verbatim means a skillforge
skill is **portable**: the same `SKILL.md` runs on any skills-compatible agent, and skillforge's value
is the *generic engine, adapters, and client model* around the skill — not a proprietary wrapper.

The **full frontmatter contract, validation rules, packaging, and the registry** (how skills are
listed, versioned, and resolved for a client) are specified in
[`skill-manifest-and-registry.md`](skill-manifest-and-registry.md). **skillforge-specific
properties** that the open standard does not define ride in the standard's `metadata` map under a
namespaced key, so they never break portability — again, see doc 12.

### Open core vs the optional "Claude flavour"

The open core is the strict subset that **runs without Claude**: a `SKILL.md` with `name` +
`description`, the standard optional fields (`license`, `compatibility`, `metadata`), and bundled
files. Everything skillforge needs to author, validate, and ship a portable skill lives here.

On top of that, individual runtimes add **additive conveniences**. The "Claude flavour" — extra
frontmatter beyond the standard (e.g. invocation control, file-path gating, forked-context execution),
**slash-command invocation**, and **runtime context injection** (running a shell command and inlining
its output before the agent sees the skill) — is an **optional adapter layer applied at export time**.
It is purely additive: a skill authored to the open core works unchanged on a non-Claude agent; the
flavour only *adds* capability when the target runtime is Claude. skillforge therefore keeps these out
of the open core and treats them as an opt-in emit profile. Per-skill **tool pre-approval / governance**
(which tools a skill may use) is also runtime-sensitive and is specified separately in
[`tool-governance.md`](tool-governance.md).

The emit profile is implemented in `src/emit/` and is **default off**: emitting under the `open-core`
profile returns the `SKILL.md` **byte-identical** (a no-op), so the portable artifact is never altered;
the `claude` profile, applied only when explicitly selected, *adds* the surfaces above (additive
frontmatter plus separate slash-command / managed-settings / context-injection companions) and the open
core is recoverable byte-for-byte. The concrete projection and its portability proof live in
[`skill-manifest-and-registry.md`](skill-manifest-and-registry.md) §"Claude flavour — an optional
emit-adapter".

---

## Skill versus command

These two notions are easy to confuse, so we separate them explicitly:

- **Skill = capability.** It exists "in standby". The agent itself judges whether a task fits it and
  can activate it when it deems that appropriate. Skills are *the verbs the agent knows*.
- **Command = explicit invocation.** This is a direct instruction from the user that triggers a
  specific behavior here and now, without relying on the agent's judgment. A command says "do it **now**".

Most simply: **a command is a deliberate press of a button; a skill is the ability that the button
triggers.** Often one wraps the other — a command is simply an explicit, convenient way to fire a
given skill when the user does not want to leave the decision to the agent. The same capability
("create a component") can therefore act through two routes: activated by the agent because the
request matched its usage conditions, or invoked directly as a command.

From the engine's point of view the difference is shallow: in both cases the same skill logic runs.
The only thing that differs is **what pulled the trigger** — the agent's judgment or an explicit
instruction. That is why we build skills as the core, and treat commands as a thin layer that "fires
skill X directly".

> **Where commands live in the standard.** Agent-judged activation (the "verb the agent knows") is the
> portable open-core behavior: it follows from `name` + `description` on any skills-compatible runtime.
> Explicit user invocation as a **slash command** (`/create-component`) is a runtime convenience — part
> of the "Claude flavour" / per-runtime emit layer described above, not a separate format. The capability
> is the same skill either way.

---

## When a skill actually activates — the full predicate

`name` + `description` decide whether a skill is *the right one for this request* — that is the part the
open standard governs, and it is what the agent (or an explicit command) keys off to **choose** a skill.
But choosing a skill is not the same as the skill being **allowed to run**. Several other gates, defined in
other documents, can each independently block activation, and a reader who knows only this document (or only
[`loader-and-activation.md`](loader-and-activation.md)) would implement a *weaker* gate than the
system actually promises. Because activation decides whether a skill *can run at all*, it is a
security-relevant boundary and worth stating in full, in one place.

A skill activates **only when every one of these conjuncts holds** — it is an AND, not an OR; any single
failing conjunct stops activation:

1. **Recognition** — the request matches the skill's `name` + `description` (agent-judged) **or** the user
   fired it explicitly as a command. *This document; the open Agent Skills standard.* This is the only
   conjunct about *choosing* the skill; the rest are about *permission to run it*.
2. **Client-has-skill** — the active client's config selects/includes this skill (a skill the client has not
   adopted does not activate for that client). *[`loader-and-activation.md`](loader-and-activation.md);
   [`client-model.md`](client-model.md).*
3. **Registry-enabled** — the skill's registry entry is `enabled: true`. An `enabled: false` skill **never
   activates regardless of who asks**. *[`skill-manifest-and-registry.md`](skill-manifest-and-registry.md).*
4. **Adapters valid (and result-kind-paired)** — the input and output adapters the skill's recipe names
   exist in the registry **and** their **kinds type-check against the skill**: the skill's emitted
   **result-kind** is accepted by the selected output adapter, and the source-kind it consumes is produced by
   the selected input adapter. A mistyped or mis-paired wiring is caught here, at start-up, not as a broken
   artifact at the end. *[`adapters.md`](adapters.md) §"Skill↔adapter typing"; the shape behind `kind`
   is [`normalized-form.md`](normalized-form.md); the pairing is recorded as data via
   `requiredAdapters` in [`skill-manifest-and-registry.md`](skill-manifest-and-registry.md).*
5. **Scope permits** — the `(client, project)` scope on the skill/registry allows it in this context (a
   scope mismatch is a deny). *[`skill-manifest-and-registry.md`](skill-manifest-and-registry.md);
   [`tool-governance.md`](tool-governance.md) §prompt-expansion deny.*
6. **Profile permits** — the active deployment profile does not forbid a feature the skill requires (e.g. a
   transport disallowed under a hard-compliance profile). *[`deployment-profiles.md`](deployment-profiles.md).*

So the true activation predicate is:

```
activates  ⇔  recognition  ∧  client-has-skill  ∧  registry-enabled
              ∧  adapters-valid (result-kind paired)  ∧  scope-permits  ∧  profile-permits
```

Conjuncts 2–6 are the *governance* gates; this document owns only conjunct 1 (recognition, via
`name` + `description`). The **complete predicate and the order in which the gates are evaluated** are the
loader's responsibility and are stated authoritatively in
[`loader-and-activation.md`](loader-and-activation.md) §"Activation" — the home for the "validate
before acting" chain. The list here exists so that the *skill's* view of activation is not silently weaker
than the system's: recognizing a skill is necessary but not sufficient.

> **Why conjunct 4 belongs to activation, not to the run.** The skill↔adapter **result-kind typing** is
> exactly the *what it is composed of* component from "What a skill is" above made checkable: the skill
> declares the result-kind it emits, the output adapter declares which kinds it accepts, and the pairing is
> validated **on the tag alone, before any work runs** — the core never parses the payload, so it stays
> generic. A skill emitting `frontend-component` wired to an adapter that only accepts `openapi-spec` fails
> *here*, at activation, instead of producing a malformed artifact. Full rule:
> [`adapters.md`](adapters.md) §"Skill↔adapter typing"; the tagged-union shape it keys off:
> [`normalized-form.md`](normalized-form.md).

---

## The life cycle of a single invocation — the "create a component" example

Let us trace one full run on an example. A user working on the the example client brand asks: "create a
button component compliant with our design system". This is one source kind (a design system) and one
artifact kind (a UI component); the very same six steps describe any other pair — e.g. "draft an OpenAPI
spec from our Jira epics" — with only the adapters swapped. Here is what happens underneath, step by step
— purely conceptually, without implementation details:

1. **Recognizing the skill.** The request matches the usage conditions of the "create a component"
   skill — either the agent judges this itself, or the user fired it directly as a command. *Recognition is
   only conjunct 1 of the full activation predicate above* — the skill also has to pass the client,
   registry-enabled, adapter-typing, scope, and profile gates before it actually runs; here we assume all
   hold and the skill comes into play.

2. **Loading the client.** The engine takes the **active client's config** (here: the example client). From
   the config it learns three things: which input adapter to use, which output adapter, and where the
   client's resources live (e.g. the design-system tokens file). How the engine finds and loads the
   client is described in [`loader-and-activation.md`](loader-and-activation.md). The config
   itself — [`client-model.md`](client-model.md).

3. **Fetching design-system knowledge (input adapter).** The skill asks the input adapter named in
   the config for a **normalized description** of the client's design system — colors, typography,
   spacing, token names. The adapter translates the source's concrete format (e.g. a tokens file or an
   export from a design tool) into a uniform shape that the engine core understands. The skill does
   not know and need not know where the data came from — it receives it already unified.

4. **Composing (skill core).** The skill core combines the **generic mechanics** of "how to build a
   component" with the **freshly fetched client knowledge**. Here the component description is born:
   what structure it has, which client tokens it binds, what states it has. This is the only moment
   where the "recipe" meets "this client's data" — and precisely that is why the recipe can stay generic.

5. **Producing the artifact (output adapter).** The composed description goes to the output adapter
   named in the config. The adapter turns it into a **concrete artifact in the client's target stack**
   — e.g. a React component file. Were the client to have a different output adapter in its config, the
   same description would become a component in a different stack, with no change to the skill.

6. **Result.** The user receives a finished component — compliant with the client's design system and
   in its target technology. The engine returns to standby, awaiting the next task.

### What follows from this

Notice where, in this run, client knowledge lives: **only at the edges** — in the config (step 2), in
the input adapter (step 3), and in the output adapter (step 5). The middle — the skill itself (step 4)
— stays purely generic. This separation is the reason one skill scales across many clients, and why
adding a new client comes down to writing **data**, not code.

---

## Related documents

- The `SKILL.md` file format, frontmatter contract, packaging, the skill registry, and `requiredAdapters` (the data that records the result-kind pairing in conjunct 4): [`skill-manifest-and-registry.md`](skill-manifest-and-registry.md)
- Per-skill tool pre-approval and governance, and the prompt-expansion scope deny (conjunct 5): [`tool-governance.md`](tool-governance.md)
- How a client is described (config, references, the "client = data only" principle): [`client-model.md`](client-model.md)
- The contract of input and output adapters, how to add one, and the **skill↔adapter result-kind typing** (conjunct 4): [`adapters.md`](adapters.md)
- The normalized form behind the `kind` tag the typing checks: [`normalized-form.md`](normalized-form.md)
- The deployment profiles that can forbid a feature a skill needs (conjunct 6): [`deployment-profiles.md`](deployment-profiles.md)
- How the engine finds, loads, and activates skills for a client — the **authoritative home of the full activation predicate** and the order its gates are evaluated: [`loader-and-activation.md`](loader-and-activation.md)
- The open standard skillforge adopts: [Agent Skills](https://agentskills.io) ([specification](https://agentskills.io/specification))
