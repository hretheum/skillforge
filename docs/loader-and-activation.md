# Loader and activation

---

## Why a separate "loader" layer

The engine's other layers are static: the core is logic, the adapters are plug-ins, the
client model is data on disk. The **loader** is the layer that, at runtime, gathers these
elements together **for a specific client**: it locates its config, loads it, picks the
adapters named in it, and hands the core a ready-to-run set of skills. Without the loader the
engine would be a complete set of parts with no assembly instructions for the given case.

**Activation** is this layer's second duty: not everything is loaded "hard-wired" — a skill
"comes into play" only when its conditions are met (the client has it, the adapters exist, it
gets invoked). The loader is responsible for keeping the right set active.

---

## `clients_dir` — a client's config may live outside the engine's repo

The most important decision of this layer, made **from the start**: the loader does not assume
that client configs sit inside the engine's repo. It is given **`clients_dir`** — a path to a
**clients directory**, which may be **any location on disk, including outside the engine's
repository tree**.

Why this matters:

- **Physical separation of code and data.** The engine's code (generic, our own) and the
  client's data (config + references to resources) sit apart. The engine can be versioned,
  published, and developed independently of how many clients it has and which ones.
- **An edge over a "hard-wired path".** If configs had to live in a fixed subdirectory of the
  repo, every new client would dirty the engine's tree, and extracting/publishing the engine
  would drag someone else's data along. With `clients_dir` the engine stays clean, and clients
  are plugged in "from the outside".
- **Clean-room hygiene.** The code↔data split is the same boundary the clean-room process
  guards (the membrane "concept passes, code never" — see `CLAUDE.md`).
  Client data does not contaminate the generic core, because it enters solely as data, from a
  directory the engine does not itself own. This makes the split not just tidiness but a
  safeguard of provenance: the engine remains a standalone work regardless of whose configs
  are plugged into it.

Concretely: the loader takes `clients_dir` as a parameter (e.g. a call argument or an
environment variable), and it is in that directory — not in its own tree — that it looks for
clients.

---

## Tenancy posture — the per-client subtree is the isolation unit (ARCH-06)

`clients_dir` may hold **many** clients side by side (`clients/example-studio/`, `clients/glasshouse/`,
…). That raises the multi-tenant question this section answers authoritatively: **what stops one
client's run from reading another client's data?** The posture has two parts — a deployment choice
and a loader-enforced invariant — and the loader behaves accordingly rather than relying on hope.

### The posture

skillforge supports two tenancy models; a deployment picks one, and **both** make the **per-client
subtree** (`clients_dir/<client>/`) the **isolation unit**:

- **Single-tenant per deployment (simplest, strongest).** Each deployment serves exactly one
  client: `clients_dir` contains a single subtree, and the operator grants the process filesystem
  access to that subtree only. Cross-client reads are impossible because no other client's data is
  on disk for that deployment. This is the default for a compliance-profile client whose data must
  not co-reside with anyone else's.
- **Multi-client `clients_dir` with per-subtree ACL (convenience).** One deployment serves several
  of the **author's own** clients from one `clients_dir`. Here co-residence is allowed, so isolation
  is enforced two ways that compose: **(1) operator-enforced ACL** — the deployment grants the
  process read access per subtree (an out-of-band, OS-level control the engine cannot weaken), and
  **(2) the loader's subtree-containment invariant** below, which holds even if the ACL is loose.

> **Who may co-reside.** The clean-room guard (`tools/cleanroom-guards.js` §`guardClientsDir`)
> already restricts the *tracked* `clients/` tree to the **author's own** clients (`example-studio`,
> `glasshouse`) and forbids any prior-employer identifier. A real third party's data is never
> committed; it lives in an out-of-tree `clients_dir` under that deployment's ACL. The tenancy
> posture and the clean-room membrane are the same boundary seen from two sides.

### The loader-enforced invariant: a client may only reference its own subtree

A client config addresses its resources by **reference** (§"validate before acting"; the references
link of the chain). A local-path reference is resolved **relative to that client's own subtree**
(`clients_dir/<client>/`). The loader enforces a hard **containment** rule:

> **A client's local reference must resolve to a path *inside* its own subtree. A reference that
> escapes — `../other-client/resources/secret.json`, or an absolute path into a sibling subtree —
> is refused at the `references` gate, loud and early, before any adapter opens the file.**

Without this, a config could name `../<other>/…` and the loader would silently **cross-read**
another tenant's data — a confidentiality break that no amount of downstream tool/secret scoping
([`security.md`](security.md), [`tool-governance.md`](tool-governance.md))
would catch, because it happens at *load* time, before the run. The check is computed on the
**resolved absolute path** (after `..` normalization): a reference escapes iff its path relative to
the client subtree begins with `..` or is itself absolute. A non-local reference (a `scheme://`
handle such as `figma://…`) is unaffected — it names no filesystem path; opening it is the input
adapter's job, under that adapter's own scoped credential.

This is a **minimal, security-correct** loader rule (not policy that belongs elsewhere): it is part
of "validate before acting" — the loader already validates that a reference *resolves*; it now also
validates that it resolves *within the tenant boundary*. It composes with, and does not replace, the
operator ACL: the ACL is the outer wall, the containment invariant is the inner one, and a
single-tenant deployment needs neither because nothing else is on disk.

> **This guard is a generic tenancy hardening, distinct from the data-only second-client proof.**
> It is a **uniform rule applied to every client**, not per-client logic, so it does not weaken the
> genericity proof — the engine still names no client. And it does not affect the "a second
> client is added by **data only**, zero `src/` engine change" claim: the *second client itself*
> needs no engine change to run; the containment guard is a separate, cross-cutting isolation
> concern that hardens tenancy for **all** clients (it was added because the loader was empirically
> shown to silently cross-read a sibling subtree before it — a real isolation gap, fixed once for
> everyone, not a per-client patch).

---

## Where the loader gets the client from

1. **Establish `clients_dir`.** The loader first knows *where* to look: it takes the given
   path to the clients directory. If none is given, that is a startup-configuration error —
   the loader does not guess (see "handling what's missing" below).
2. **Select the client.** From `clients_dir` the loader selects **one client** named in the
   request (e.g. by the identifier `example-studio`). The clients directory may contain many — the
   loader takes the one that was asked for.
3. **Load and validate the config.** The loader reads the selected client's config and checks
   its correctness before running anything: are the required fields present, do the named input
   adapter and output adapter exist, can the references to resources be resolved. The config
   shape and exactly what is validated → [`client-model.md`](client-model.md).

---

## How the loader assembles the set of skills available to the client

With a validated config, the loader **completes the set of skills** for that client:

1. **Pick the adapters.** From the config the loader reads which input adapter and which output
   adapter to plug in, and places them on the core's edges. The choice of adapter is driven
   solely by the client's config — the core does not pick on its own (contract → [`adapters.md`](adapters.md)).
2. **Make the generic skills available.** Skills are themselves generic (zero client knowledge
   baked into the skill — [`skills-and-commands.md`](skills-and-commands.md)).
   The loader makes them executable for the given client: every running skill has access to the
   client's config and to the chosen pair of adapters.
3. **Return the ready set to the core.** The result: the core gets a complete set of skills
   "armed" with the client's context — ready to be assembled on demand, exactly as in step 2 of
   the path in [`architecture-overview.md`](architecture-overview.md).

---

## Activation — when a skill comes into play (the full predicate)

Assembling the set is not the same as running it. Activation is a **security-relevant gate** — it
decides whether a skill *can run at all* — so this document, the loader's home, states the
**complete predicate authoritatively** (ARCH-05). A reader of any single other doc would otherwise
implement a *weaker* gate than the system promises: the conditions are spread across the client
model, the registry, the adapters, tool governance, and the deployment profile. Here they are
collected, with a pointer to where each is defined and **the order the loader evaluates them**.

A skill **activates only when every one of these six conjuncts holds** — it is an AND, not an OR;
any single failing conjunct stops activation:

1. **Recognition** — the request matches the skill's `name` + `description` (agent-judged) **or**
   the user fired it explicitly as a command. This is the only conjunct about *choosing* the skill;
   the rest are *permission to run it*. *([`skills-and-commands.md`](skills-and-commands.md);
   the open Agent Skills standard.)*
2. **Client-has-skill** — the active client's config selects/includes this skill; a skill the
   client has not adopted does not activate for it. *(this doc, §"How the loader assembles the set";
   [`client-model.md`](client-model.md).)*
3. **Registry-enabled** — the skill's registry entry is `enabled: true`; an `enabled: false` skill
   **never activates regardless of who asks**. *([`skill-manifest-and-registry.md`](skill-manifest-and-registry.md).)*
4. **Adapters valid (and result-kind-paired)** — the input and output adapters the recipe names
   exist **and** their **kinds type-check against the skill**: the skill's emitted result-kind is
   accepted by the output adapter, and the source-kind it consumes is produced by the input adapter.
   A mistyped/mis-paired wiring is caught here, at start-up, not as a broken artifact at the end.
   *([`adapters.md`](adapters.md) §"Skill↔adapter typing"; the `kind` shape is
   [`normalized-form.md`](normalized-form.md); the pairing is recorded as `requiredAdapters`
   data in [`skill-manifest-and-registry.md`](skill-manifest-and-registry.md).)*
5. **Scope permits** — the `(client, project)` scope on the skill/registry allows it in this
   context; a scope mismatch is a deny, enforced at the prompt-expansion seam.
   *([`skill-manifest-and-registry.md`](skill-manifest-and-registry.md);
   [`tool-governance.md`](tool-governance.md) §prompt-expansion deny.)*
6. **Profile permits** — the active deployment profile does not forbid a feature the skill requires
   (e.g. a server-side Agent Skill under the hard-compliance profile). This conjunct is decided by
   the **profile-evaluator** (§"The profile-evaluator" below) — the same component the tool resolver
   uses as Layer 0 — so feature legality at activation and tool legality per call share one verdict
   source. *([`deployment-profiles.md`](deployment-profiles.md); profile-evaluator below.)*

So the true activation predicate is:

```
activates  ⇔  recognition  ∧  client-has-skill  ∧  registry-enabled
              ∧  adapters-valid (result-kind paired)  ∧  scope-permits  ∧  profile-permits
```

**Evaluation order (validate before acting).** The loader evaluates the conjuncts in the order the
client-context chain is built — `client-has-skill → registry-enabled → adapters-valid → scope-permits
→ profile-permits` — failing **loud and early** on the first that does not hold (the same chain
**client → config → adapters → references → profile** from "validate before acting" above; conjunct
1, recognition, is what *brings the request to the loader* in the first place). It is an AND, so the
order does not change *whether* a skill activates, only *which* error the operator sees first — and
that error names the specific failing gate, never a silent half-activation.

Until all six hold, the skill exists but is dormant. Activation therefore guards against running a
skill without the full client context — and against running one the registry, scope, or profile
forbids. (Conjuncts 5 and 6 are also enforced **again at runtime** by the tool resolver's
prompt-expansion deny and Layer 0 in [`13`](tool-governance.md): activation is the start-up gate,
the resolver is the per-call gate — defense in depth, not redundancy.)

---

## What happens when something is missing (errors that make sense)

The loader is meant to fail **loud and early**, with a message that says *what* and *where* is
wrong — never silently, never guessing. Typical cases:

| Missing / error | Loader's response |
|---|---|
| `clients_dir` not provided | Stop immediately: "I don't know where to look for clients" — this is a startup error, not a runtime one. |
| The named client does not exist in `clients_dir` | Error "client `X` not found in `clients_dir`", ideally with a list of available ones. |
| Client config invalid / missing required fields | A validation error pointing at the specific field (delegated to the rules in [`client-model.md`](client-model.md)). |
| The input/output adapter from the config does not exist | Error "unknown adapter `Y`", noting which adapter was expected. |
| A reference to a client resource cannot be resolved | Error "I cannot open the resource named by reference `…`" — with no attempt to guess the content. |

The common rule: **validate before acting.** The loader checks the full chain (client → config
→ adapters → references → **deployment profile**) before the core assembles anything — where the
profile link is a **call into the profile-evaluator**, not loader-resident policy (see below).
Thanks to this a skill never starts with half its context, and the user gets the error at a stage
where it can still be fixed.

---

## The profile-evaluator — a separate component the loader *calls* (SRP, ARCH-03)

A client config also carries a **deployment profile** — either **compliance / client-side**
(profile A) or **convenience / server-side** (profile B). The two profiles, and the full
feature × profile contract table, are defined in [`deployment-profiles.md`](deployment-profiles.md);
the residency/retention facts and cost model behind profile A are in
[`compliance-and-cost.md`](compliance-and-cost.md).

**The policy and the wiring are two different jobs, and skillforge keeps them in two different
components.** Enforcing the profile is a *policy* decision — *is this feature legal under this
profile?* — which changes for a different axis of reasons (a new platform feature, a changed
residency rule) than the loader's *wiring* job (resolve `clients_dir`, select + validate the
config, bind adapters, assemble skills). Folding compliance policy into the loader would make the
residency rules and the wiring logic change together and be tested together. So the policy is
factored out:

> **profile-evaluator** — a small, **data-driven, model-independent** function
> `(profile, feature) → allow | deny` over the [`14`](deployment-profiles.md) contract table.
> It is the **single evaluator** of profile legality, and the **direct sibling of the tool policy
> resolver** in [`tool-governance.md`](tool-governance.md): the same deny-first, runs-without-
> Claude, can-run-as-a-CI-dry-run shape. It **owns no table** — it *reads* the one table that
> [`14`](deployment-profiles.md) owns, so the feature × profile contract lives in exactly one
> place (this also retires the duplicated table; cf. ARCH-04).

The loader's relationship to it is **call, not contain.** The loader does the wiring and, as one
link in its validate-before-acting chain, **calls the profile-evaluator** for each feature a request
would use; it does not itself hold the legality rules. A profile is a real guarantee only because
this evaluator is consulted **before any skill runs**, and because the *same* evaluator is also
called by the resolver as **Layer 0** of every per-call tool decision ([`13`](tool-governance.md)
§"Layer 0 — the deployment-profile deny floor"): one evaluator, two call sites (the loader at
startup for feature legality; the resolver per-call for server-side-tool legality), one table.

When the evaluator returns `deny` for a feature a **compliance**-profile request would use, the
loader **refuses, loud and early, before any skill runs** — the same "validate before acting, fail
loud" discipline it applies to missing adapters and unresolved references:

| Feature the evaluator denies under the compliance profile | Loader's response (on the evaluator's `deny`) |
|---|---|
| A skill that requires the **Files API** | Stop: "client is in **compliance** profile; the Files API is forbidden — it would place content outside the EU/ZDR boundary." |
| A **server-side** Agent Skill | Stop: "compliance profile allows **client-side skills only**; skill `X` requests server-side execution." |
| A **batch** job | Stop: "batch processing is not available under the compliance profile (Bedrock-native)." |
| A **server-side tool** (code exec, web search/fetch) | Stop: "server-side tools are forbidden under the compliance profile." |

(The rows above are *illustrations of the evaluator's verdicts*, not a second copy of the contract —
the authoritative feature × profile table is owned by [`14`](deployment-profiles.md).) Each error
names **which** feature and **why** (the compliance boundary), so the operator can either switch the
deployment to profile B knowingly or pick a client-side path — never discover a residency/retention
leak after the fact. A compliance deployment that *tries* a forbidden feature does not produce
wrong-but-quiet output — it stops. (Profile B imposes no such restrictions; the evaluator defers and
the full server-side feature set is available.)
