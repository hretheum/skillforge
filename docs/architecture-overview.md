# Architecture overview

---

## The idea in one paragraph

**skillforge** is a **skill factory** — a machine that, from a single, generic
**engine** (a core that knows nothing about any particular client) plus a separate
**client description** (its swappable configuration), produces ready-made **skills**:
named, reusable agent capabilities, e.g. "create a component that conforms to this
client's design system". The trick is a clean separation: all knowledge about a client
lives in its data, and all the mechanics live in the engine. The architecture below is
simply that separation broken out into layers.

---

## Five layers — what each one does

The engine splits into **five layers**. Three of them are the "bricks" (the core plus
two kinds of adapters), one is data (the client model), and one binds it all together
at runtime (the loader). I keep the same layer names throughout the spec — in particular
they match [`loader-and-activation.md`](loader-and-activation.md).

1. **Skill/command core** *(core)* — the skill-assembly logic. This is where the mechanics
   live: how a concrete action is built from generic parts plus knowledge about the client.
   A **command** is an explicit invocation of a skill (the user asks: "create component X");
   a **skill** is the capability itself, which the core assembles on demand. The core is
   deliberately "client-blind" — it knows no company names, no formats, no paths.
   Skill anatomy → [`skills-and-commands.md`](skills-and-commands.md).

2. **Input adapter** *(input)* — a plug-in on the input edge. It reads **any kind of client
   source material** and translates it into a **normalized description** that the core understands
   regardless of where the data came from or what it was. A **design system** (a coherent set of
   tokens, colors, typography, components) is the leading example — it is what the first client needs
   — but it is only one kind among equals: a Jira project, Confluence/Notion pages, PDF/DOCX/Markdown
   documents, a Redmine tracker, and so on. Thanks to this the core never knows the concrete source
   kind or format.

3. **Output adapter** *(output)* — a plug-in on the output edge. It takes the result of the
   skill's work and gives it a **target form in the world** — **any kind of SDLC artifact**, not just
   a UI component. A front-end component (React, Web Components, a CMS template) is the leading example,
   but equally valid outputs are backend code, tests, API specs (OpenAPI), infrastructure-as-code /
   configuration, documentation, diagrams, tickets/issues, and database migrations. It is the output
   adapter that decides "in what" the skill ultimately emits the artifact. The two edges are symmetric;
   the contract of both adapters → [`adapters.md`](adapters.md).

4. **Client model** *(data, not code)* — the client's **config** plus **references** to its
   resources. The overriding rule: **client = data only**, zero logic in the config. The config
   says: who the client is, which input adapter to use, which output adapter, and where the
   resources live (e.g. a token file). A **reference** is a pointer to a resource, not its
   inlined content. Config shape → [`client-model.md`](client-model.md).

5. **Loader / activation** *(the runtime glue)* — the layer that, at runtime, finds the chosen
   client, loads its config, picks the right adapters, and hands the core a complete set of
   ready-to-run skills. Crucial from the start: a client's config may live **outside the engine's
   repo tree** — the loader is given a path to a clients directory (`clients_dir`), so the client's
   data and the engine's code are physically separated.
   Details → [`loader-and-activation.md`](loader-and-activation.md).

---

## Diagram — how the layers fit together

```
                         ┌───────────────────────────────────────────┐
                         │                  ENGINE                     │
                         │            (generic, with no knowledge      │
                         │              of any client)                 │
                         │                                             │
   client source material│   ┌───────────────┐     ┌───────────────┐  │   target artifact
   (DS / Jira / docs /   │   │ INPUT          │    │ OUTPUT         │  │   (component / API /
    PDF / …)             │   │ ADAPTER        │    │ ADAPTER        │  │    tests / IaC / …)
        │                │   │ (input)        │    │ (output)       │  │        ▲
        │  normalized    │   └──────┬────────┘     └──────▲────────┘  │        │
        └─────description►│         │                     │           │────────┘
                         │          ▼                     │           │  finished artifact
                         │     ┌─────────────────────────────────┐    │
                         │     │   SKILL / COMMAND CORE (core)    │    │
                         │     │   skill-assembly logic           │    │
                         │     └──────────────▲──────────────────┘    │
                         │                    │ skills ready           │
                         │                    │ to run                 │
                         │            ┌───────┴────────┐               │
                         │            │ LOADER /        │              │
                         │            │ ACTIVATION      │              │
                         │            └───────▲────────┘               │
                         └────────────────────┼──────────────────────┘
                                              │ reads config + references
                                ┌─────────────┴──────────────┐
                                │   CLIENT MODEL (data)       │
                                │   config + references       │
                                │   ── lives in clients_dir,   │
                                │      may be OUTSIDE the repo ──│
                                └────────────────────────────┘
```

One thing reads clearly here: the arrow from the client model enters the engine **only as
data**, through the loader. Nowhere is there an arrow "client → engine code". This is the same
boundary that, in clean-room terms, separates concept from code — the client's data does not
contaminate the generic core (more in [`loader-and-activation.md`](loader-and-activation.md)).

---

## One full path: from request to artifact

Let's trace a single request through every layer. The example runs on the first real
client — and on one kind of source (a design system)
and one kind of artifact (a UI component), to keep the path concrete. The same path holds for any
other source/artifact pair: swap the adapters, the layers and their roles are identical.

1. **Request (command).** The user invokes a skill explicitly: "create the *Badge* component
   for client `example-studio`, in the React stack". This is a **command** — an explicit invocation
   of the `create-component` skill.

2. **The loader fetches the client.** The loader looks into `clients_dir`, finds the config for
   client `example-studio`, loads it, and validates it (are the required fields present, do the named
   adapters exist). From the config it reads: input adapter = read the client's design system,
   output adapter = React, plus references to resources (e.g. a token file). The mechanics of this
   step → [`loader-and-activation.md`](loader-and-activation.md).

3. **The input adapter reads the DS.** The chosen input adapter reaches for the resource named
   by a reference (the client's design system) and returns a **normalized description**: which
   tokens exist, what the color roles are called, what the component contract looks like. The core
   does not know whether the data came from Figma or a file — it gets a uniform shape.

4. **The core assembles the skill.** Given the request (which component) plus the normalized DS
   description, the core runs the assembly logic: it selects the skill's generic parts and fills
   them with knowledge about the client, producing a **stack-independent result** (a description
   of the component with the right tokens and roles). A skill's genericity = zero client knowledge
   baked into the skill itself (elaborated in [`skills-and-commands.md`](skills-and-commands.md)).

5. **The output adapter materializes the artifact.** The core's result goes to the output adapter
   named in the config (here: React). The adapter turns the stack-independent result into concrete
   component file(s) in the target stack. **The same core result, a different output adapter
   (e.g. Web Components), would yield the same component in a different stack** — that is the
   practical proof of genericity.

6. **The artifact returns to the world.** The user gets a finished Badge component, conforming to
   the client's design system, in the requested stack.

The whole path shows the project's rule in action: **the mechanics flow through the core,
knowledge about the client enters from the side as data, and the form of the result is swappable
via the output adapter.** Changing the client = a different config in `clients_dir`; changing the
stack = a different output adapter; in both cases **the engine's core stays untouched.**

---

## How the core lays out a prompt: stability tiers

The layers above describe *which parts* flow through the engine. There is one more shaping decision the
core makes on every run that does not change *what* is sent to the model but *in what order* — and it
turns out to matter a great deal for both answer quality and cost. The core assembles every skill prompt
in **stability tiers**, from the most stable content to the most variable, never interleaved:

```
   ┌─ tier 1: ENGINE / SKILL  (most stable) ── the engine's instructions + the skill recipe.
   │                                            Identical across *every* client and *every* run.
   ├─ tier 2: CLIENT          (stable)       ── the normalized description from the input adapter
   │                                            (this client's tokens, roles, contract). Identical
   │                                            across *that client's* runs; changes only when the
   │                                            client's source changes.
   └─ tier 3: REQUEST         (variable)     ── the specific ask ("create the Badge component").
                                                Different on (almost) every run.
```

The rule is simple: **stable first, variable last.** Two independent benefits fall out of it, and both
are **generic** — they hold for any model backend, not just one vendor:

- **Better answers.** A model's effective reasoning degrades as the context grows and as high-signal
  tokens get buried among low-signal ones (the "context is a finite resource" idea). Putting the
  unchanging, load-bearing instructions and client facts up front, and the volatile request last, keeps
  the high-signal material prominent.
- **Cheaper runs.** Because tier 1 and tier 2 are *byte-for-byte identical* across many runs, a backend
  that can reuse a repeated prompt **prefix** charges far less for it on the second and later runs. A
  skill factory runs the *same* client prefix over and over, so this is the single biggest cost lever the
  architecture exposes — and it falls out *for free* from the tiered layout. The mechanism that pays off
  here lives at the edge (a runtime/output adapter that marks the tier boundaries for the backend), not in
  the core; the core only has to **emit the tiers in order and keep tiers 1–2 deterministic**. The
  determinism requirement this places on the input adapter — *why byte-stability is now a cost concern,
  not just a testing nicety* — is spelled out in [`adapters.md`](adapters.md) ("the determinism
  rule"). The money behind the prefix-reuse saving is modelled in
  [`compliance-and-cost.md`](compliance-and-cost.md).

> **Tier-1 byte-determinism is a *core* contract — not just an adapter one.** The prefix-reuse saving (and
> the genericity tests that key off it) only hold if the *whole* prefix is byte-for-byte identical across
> runs, and the prefix has **two owners**: tier 1 (the engine instructions + the skill recipe) is the
> **core's** responsibility; tier 2 (the normalized description) is the **input adapter's**. So the core
> commits to the same byte-stability discipline it requires of the adapter: tier-1 content must serialize
> identically every run — **stable ordering and formatting, no timestamps, run IDs, or incidental
> whitespace churn** (the same canonical-serialization rules as the normalized form,
> [`normalized-form.md`](normalized-form.md), "byte-stability"; mirrored for the adapter in
> [`adapters.md`](adapters.md), "the determinism rule"). Naming both owners explicitly matters
> operationally: a cache-hit-ratio dip can originate in *either* tier, so the dashboard must attribute it to
> the right one rather than always blaming the adapter (see [`telemetry.md`](telemetry.md)).

This is why the core stays **provider-blind** even about efficiency: it expresses *intent* ("here are the
stability tiers"); any given backend's caching, and any long-conversation management it offers, are
realized by an adapter. Some backends (Claude is the leading example today) additionally offer
**server-side context management** — automatically summarizing or trimming an over-long conversation so a
long-running skill stays within the model's window. That capability is **optional and vendor-specific**
(a "Claude-flavour" execution profile the runtime adapter may switch on for long skills); the core never
depends on it, and a backend without it simply runs the same tiers without that extra trimming. Whether
such *server-side* conveniences are even permitted depends on the deployment posture — a hard-compliance
deployment turns them off (see the profiles in [`deployment-profiles.md`](deployment-profiles.md)).
The guiding principle — *make the stable stuff stable and put it first* — is the generic part; everything
that translates it onto a particular vendor's wire is adapter territory.
