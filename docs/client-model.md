# Client model

---

## Why a separate "client model"

The entire value of the skill factory comes from the fact that **one engine** serves **many clients**
with no changes to its code. For that to be possible, all knowledge about a specific client must live
outside the engine — in a swappable description the engine receives as input. We call this description
the **client configuration** (hereafter: **config**), and the shape that this config is allowed to take
is precisely the **client model**.

The client model is therefore a contract: it states *what information about a client the engine is able
to accept at all*. As long as a given client fits within this contract, the engine will serve them. If
someone wants to describe something the model does not foresee, that is a signal to extend the model
(a deliberate spec change), not to work around it with a hack in the config.

---

## The overriding principle: a client is data only

**The client config is declarative — it describes, it does not execute.** That means there is no logic
in the config: no conditionals, no loops, no snippets of code "run along the way". The config merely
*states facts* about the client — who they are, which adapters they use, where their resources live —
and all the work is done by the generic engine on the basis of those facts.

Why this is a hard rule:

- **The engine stays generic.** If the config could carry logic, that logic would be client-specific and
  would effectively leak into the engine's behavior. After a few clients the engine would stop being one
  engine — it would become a sum of exceptions. By keeping logic on the engine side and data on the config
  side, we maintain a sharp split: **the code is shared, the data is swappable.**
- **Configs are predictable and comparable.** Two configs differ only in values, not in behavior. They can
  be read, validated and diffed like ordinary data.
- **Provenance purity (clean-room).** Client data (e.g. the the client brand) does not mix with the
  engine's code — physically or conceptually. The engine does not "learn" any client; it simply reads their
  data. (The code↔data split is reinforced further by `clients_dir` — a client's config can live outside
  the engine repo tree; details in [`loader-and-activation.md`](loader-and-activation.md).)

A practical test of the rule: *if you had to "run" the config in order to understand what it means, then it
is no longer a config but a program.* Such a case belongs in the engine or in an adapter.

---

## Client config fields

A client config consists of a few groups of fields. Below is a description of each group *conceptually* —
the exact file format (keys, syntax) is an engine implementation decision; here we establish *what* the
config must carry.

### 1. Client identity
Who this is — enough for the engine to point at them unambiguously and to name the outputs.
- **identifier** — a short, stable handle for the client (e.g. `example-studio`), used by the loader to select
  the client and to name artifacts.
- **display name** — the full name for presentation (e.g. "the example client").
- (optional) a short description / note — what this client is for, whose brand it is.

### 2. Adapter selection
Which **input adapter** and which **output adapter** to use for this client. These are *references by name*
to adapters the engine knows — the config does not define an adapter, it only selects one (analogous to
picking a driver from a list, rather than writing a driver). The two edges are symmetric and both are
**open** — the input adapter can read any kind of source, the output adapter can produce any kind of SDLC
artifact (full catalogs → [`adapters.md`](adapters.md)).
- **input adapter** (`input`) — which **kind of source** to read. E.g. a DTCG token reader, a design-system
  reader from Figma, a Jira reader, a Confluence/Notion reader, a document (PDF/DOCX/MD) reader, a Redmine
  reader.
- **output adapter** (`output`) — which **kind of artifact** to produce. E.g. React, Web Components, a CMS
  component, but equally backend code, tests, an OpenAPI spec, IaC/config, documentation, diagrams, tickets,
  or DB migrations.

The contract and the full list of what an adapter receives and returns → [`adapters.md`](adapters.md).
Here the config merely *declares the choice*.

### 3. References to client resources
Pointers to **where** the client's materials live, which the input adapter will use. This is the heart of
"references vs content" (below). The kinds of reference depend on the chosen source — examples:
- a path to a design system token file, or a handle/URL of a design-system source (e.g. a Figma file),
- a handle of a Jira project or a Confluence/Notion space,
- a path to a document (PDF/DOCX/Markdown) or a folder of them,
- a path to the client's brand or business rules, if the skills are to respect them.

The config holds **addresses**, not copies. The content behind those addresses is loaded by the input
adapter at run time.

### 4. Skill parameters (optional, still as data)
If a given skill has settings for the client (e.g. a default output directory for components, a naming
convention), those are also **data** — simple values, not logic. We keep them in the config as explicit
settings, so that the skill stays generic and the client-by-client differences are visible in the data.

### 5. Secret references (never secret values)
When an adapter integrates with an external system (Jira, Confluence/Notion, a cloud account, …) it needs a
**credential**. The config records **which** credential is needed and **where to find it** — a *secret
reference* (a name/path) — but **never the secret value itself**. References are scoped **per client and per
project** (a client has many projects; an integration is usually enabled for one of them), so a reference
typically reads like `client/project/adapter/secret-name`. The value is resolved at runtime from a separate
secret backend and is never written into the config. This is the "references, not content" rule below applied
to the most sensitive resource — full model in [`security.md`](security.md).

---

## References vs content

This distinction matters enough to get its own section.

**The config points at resources — it does not paste them in.** Instead of copying the contents of a token
file or a design system dump into the config, the config holds a **reference**: a path, a URL, or another
handle to the place where that content actually lives. The raw content is fetched only by the **input
adapter**, when the engine is actually working.

Why this way:

- **A single source of truth.** When the client's design system changes (a new token, a new component), the
  *source* changes while the config stays the same — it still points at the same place. If the config held a
  copy, it would immediately drift from the original.
- **The config stays small and readable.** It is a handful of addresses and choices, not a pile of design
  data.
- **A clean separation of concerns.** The config says *"what to use and from where"*; the input adapter
  knows *"how to load and normalize it from that address"*. Two different concerns, two different places.

In short: **the config is a list of addresses and decisions, not a content store.**

---

## Example: config for the example client

the example client is a brutalist, "ecclesiastical" product-design studio brand — the first real client of the
factory. Its design system is **token-centric** (a DTCG token pyramid as the hub) and deliberately
**craft-heavy**: some components have a handcrafted character (rotations, halos, animations) that lives in
the source CSS and is not fully generatable — in the component model this is the path where **code is the
source of truth** (craft stays with the code, structure and tokens are assembled by the engine).

For the client model this yields **a few concrete facts-as-data** that the the example client config carries
(descriptively, without binding to a file syntax):

- **Identity:** identifier `example-studio`, name "the example client".
- **Input adapter:** a DTCG token reader — because the source of truth for *this* client is a token hub in
  DTCG format. (Another client could instead point its input adapter at Jira, Confluence, documents, etc. —
  this is the client's choice from the open catalog, not a fixed default.)
- **Output adapter:** React — the DS is shipped as a React library (thin wrappers emitting the canonical
  classes; craft stays in the source CSS). (Equally, a client could select an output adapter producing tests,
  an API spec, IaC, docs, etc. — React is the client's choice, not the only option.)
- **References to resources:** the address of the DTCG token-hub file and the handle of the design system
  source; optionally a pointer to the brand rules (e.g. the title-accent rule) that the skills are to respect.
- **Brand rules as data, not code.** Rules such as "the accent in a title falls on the last word" are, for
  the engine, **input data** (a parameter/reference), not baked into any skill. This keeps the "create a
  component" skill generic: for another client the same fields simply hold different values, or are empty.

The point of the example: **everything that makes the output match this client's brand lives in the client's data —
the engine contains not a single line of knowledge about the example client.** The same task with a different config
will produce a skill for a different brand.

---

## Config validation

Before the engine does anything, it **validates the config** — so that an error in the client description
stops the work immediately, with a readable message, instead of producing a broken or "almost right"
artifact. Validation treats the config as data (per the principle above) and checks at least:

1. **Completeness of mandatory fields** — there is an identity, there is a choice of input and output
   adapter. Missing any of these = stop, with a clear note on what is missing.
2. **The adapters are known to the engine.** The referenced adapters (by name) actually exist in the
   adapter registry. A typo in an adapter name should surface here, not halfway through the work. (What a
   registry is → [`adapters.md`](adapters.md).)
3. **References are resolvable.** The referenced resources can be pointed at / opened (e.g. the path exists,
   the source handle is well-formed). The client model does not judge the *content* itself at this stage —
   that is the input adapter's job — but the **address** must be sensible.
4. **Data only, no logic.** The config contains no executable elements — if the format allows them,
   validation must reject them. This is the guardian of the "a client is data only" principle.

Validation is a **gate**: the entire config passes or the engine does not start. This lets the rest of the
pipeline (adapters, skill assembly) assume it received a valid, complete client description.

---

## Takeaways

- **A client is data only.** The config describes, it does not execute.
- The config carries **identity**, **adapter selection** and **references to resources** (plus optional
  settings as data).
- **References, not content** — the config points, the input adapter loads.
- **Validation before start** — completeness, known adapters, resolvable references, no logic.
- What's next: how the adapters that the config points to work → [`adapters.md`](adapters.md).
