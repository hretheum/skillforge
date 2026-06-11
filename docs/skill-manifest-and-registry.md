# Skill manifest and registry

> **How skillforge describes its skills as machine-readable data.** A skill is generic behavior
> ([skills-and-commands.md](skills-and-commands.md)); to *govern* a fleet of skills across many
> clients we need the inventory itself to be **data** — diffable, validatable, and enforceable — not prose.
> This document defines two open-format layers: the **per-skill manifest** (the standard `SKILL.md`
> frontmatter, validated by `skills-ref`) and the **skillforge registry** (`skillforge.registry.json`), a
> vendor-neutral catalog that records each skill's version, enabled state, required tools, required
> adapters, required *secret references*, and per-client/per-project scope. A Claude flavour is an
> **optional emit-adapter** that projects this data onto Claude Code's native surfaces.
>

---

## Why this layer exists

Skills are generic by design — a skill carries no client knowledge ([skills-and-commands.md](skills-and-commands.md)). But an engine that serves many clients still needs to answer operational questions *without reading a human's notes*:

- Which skills exist, and at what **version**?
- Is a given skill **enabled** for this client and this project — or turned off?
- Which **tools** and **adapters** does it require, and which **secrets** (by reference) must resolve before it can run?
- What is its **scope** — every client/project, or one narrow pair?

If those answers live only in prose, governance becomes honor-system. The remedy is the same principle the rest of the spec uses for clients and secrets: **the inventory is data that points at resources, not a document that describes them** (the "reference, not content" rule from [client-model.md](client-model.md) and [security.md](security.md)). Two open-format layers carry that data.

---

## Layer 1 — the per-skill manifest (`SKILL.md`, open standard)

skillforge does not invent a skill format. It uses the **Agent Skills open standard**: a skill is a directory whose entrypoint is a `SKILL.md` file with YAML frontmatter followed by Markdown instructions ([agentskills.io/specification](https://agentskills.io/specification)). The standard is **vendor-neutral** — adopted across many agent products — so a skillforge skill is portable, not Claude-locked.

### Standardized frontmatter fields

| Field | Required | Constraint (per the standard) |
|---|---|---|
| `name` | yes | ≤64 chars, lowercase `[a-z0-9-]`, no leading/trailing/consecutive hyphen, **must match the parent directory name** |
| `description` | yes | ≤1024 chars, non-empty — what the skill does *and when to use it* |
| `license` | no | license name or reference to a bundled license file |
| `compatibility` | no | ≤500 chars — environment needs (intended product, system packages, network access) |
| `metadata` | no | **arbitrary string→string map** for properties the spec does not define |
| `allowed-tools` | no | space-separated pre-approved tools (**experimental**; see the warning in [tool-governance.md](tool-governance.md)) |

Source: [agentskills.io/specification](https://agentskills.io/specification).

### How skillforge uses the open fields

Two standardized fields are exactly the hooks skillforge needs, so we lean on them rather than forking the format:

- **`metadata`** carries skillforge-specific properties under a namespaced key to avoid collisions: **`metadata.skillforge.*`** (e.g. `metadata.skillforge.owner`, `metadata.skillforge.registryKey`). The standard explicitly anticipates this use ("clients can use this to store additional properties not defined by the spec") and recommends unique key names — `skillforge.*` satisfies that.
- **`compatibility`** declares environment requirements in human-readable form (e.g. "requires git, jq, network access"); the *enforceable* tool/secret needs live in the registry (Layer 2) where a policy engine can read them.

> **`allowed-tools` is advisory, not a boundary.** The standard marks it experimental, and Claude Code's own docs say it *grants* pre-approval without *restricting* anything. skillforge therefore never treats a skill's self-declared tool list as a security control — the boundary is the registry + policy resolver in [tool-governance.md](tool-governance.md). The manifest *requests*; the registry and resolver *decide*.

### Validation — `skills-ref`

The standard ships a reference validator: **`skills-ref validate ./my-skill`** checks that the `SKILL.md` frontmatter is well-formed and follows naming conventions ([agentskills.io/specification](https://agentskills.io/specification)). skillforge adopts it as a **CI gate** so a malformed or mis-named skill cannot enter the repo — see `docs/security.md`.

---

## Layer 2 — the skillforge registry (`skillforge.registry.json`, original, open-format)

The per-skill manifest describes one skill *in isolation*. The **registry** is the fleet-level catalog that records the governance facts the manifest cannot: version, enabled state, required tools/adapters/secret-references, and scope. It is plain JSON keyed by each skill's open `name`, so a non-Claude runtime — or a human, or a CI linter — can read and enforce it. **This is the inventory as enforceable data.**

### Shape

```jsonc
{
  "schemaVersion": "1",
  "skills": {
    "create-component": {
      "version": "1.2.0",
      "enabled": true,
      "owner": "platform",
      "requiredTools": ["Read", "Edit", "Write"],
      "requiredAdapters": { "input": ["design-system", "jira"], "output": ["react"] },
      "requiredSecrets": ["${client}/${project}/jira/api-token"],   // references only, never values
      "scope": { "clients": ["*"], "projects": ["*"] },
      "model": "inherit",                                           // OD-6: default model/effort hint
      "effort": "medium"
    },
    "push-to-tracker": {
      "version": "0.4.0",
      "enabled": false,                                             // hard off, expressed in data
      "owner": "platform",
      "requiredTools": ["mcp__tracker__*"],
      "requiredAdapters": { "input": [], "output": ["redmine"] },
      "requiredSecrets": ["${client}/${project}/redmine/api-key"],
      "scope": { "clients": ["acme"], "projects": ["checkout"] }    // narrow blast radius
    }
  }
}
```

### Field semantics

| Field | Meaning |
|---|---|
| `version` | Skill version; lets the registry pin/track changes independently of the `SKILL.md` body. |
| `enabled` | Fleet-default on/off, in data. A disabled skill never activates regardless of who asks. |
| `owner` | Accountable team/person (operational, not security). |
| `requiredTools` | Tools the skill needs. **Advisory at this layer**; the policy resolver intersects it with what the active client/project actually permits ([tool-governance.md](tool-governance.md)). |
| `requiredAdapters` | Input/output adapters the skill assembles ([adapters.md](adapters.md)); the loader validates these exist before activation ([loader-and-activation.md](loader-and-activation.md)). |
| `requiredSecrets` | **Secret *references* only** — names/paths resolved at runtime by the secret backend, never values. Identical discipline to [security.md](security.md). |
| `scope` | `{clients, projects}` lists (`"*"` = any). Makes per-client/per-project narrowing **declarative**, matching the `(client, project, adapter)` addressing of the secret model. **`scope` gates *eligibility*, not *permission*** (GOV-03): `"*"` means "not excluded by the inventory" — the skill may *fire* here — **not** "permitted to act"; a tool call still needs an affirmative allow from the deny-first policy resolver, absent which it is denied ([tool-governance.md](tool-governance.md) §"Eligibility ≠ permission"). |
| `model` / `effort` | Default model/effort for the skill (**OD-6**); overridable per client (below). |

### OD-1 — registry in the engine repo, override per client in `clients_dir`

The **generic registry lives in the engine repo** (`skillforge.registry.json`): it is the catalog of the engine's own generic skills, versioned and reviewed with the code. **Per-client overrides live as data outside the repo, in `clients_dir`** — the same boundary the loader already guards ([loader-and-activation.md](loader-and-activation.md)). A client config may carry a `skillOverrides` block that *narrows* the base registry for that client+project:

```jsonc
// in clients_dir/acme/config.json (data, outside the engine repo)
{
  "skillOverrides": {
    "push-to-tracker": { "enabled": true, "scope": { "projects": ["checkout"] } },
    "create-component": { "model": "high", "effort": "high" }     // OD-6 override
  }
}
```

Merge rule, deny-first in spirit: **a client override may tighten but never broaden** the base registry. An override can disable a skill the base enables, or narrow its scope; it cannot enable a skill the base disabled, nor add a tool the base did not list, nor widen scope beyond the base. This keeps the engine's generic catalog authoritative and the client data a *constraint*, mirroring how managed settings outrank project settings in [tool-governance.md](tool-governance.md). It also preserves clean-room hygiene: client data enters solely as data, from a directory the engine does not own ([loader-and-activation.md](loader-and-activation.md)).

> **Why split this way.** Putting the catalog in the repo keeps the inventory diffable and CI-lintable with the code that implements the skills; putting enable/scope/model overrides in `clients_dir` keeps client-specific decisions out of the generic engine, exactly as [loader-and-activation.md](loader-and-activation.md) keeps configs out of the engine tree. The engine can be published without dragging any client's enablement choices along.

### OD-6 — model/effort in the registry, overridable in client config

A skill's default reasoning budget (`model`, `effort`) is recorded in the registry so it is a property of the *capability*, not a per-run guess. The open `SKILL.md` may also express these (Claude flavour fields), but the registry is the vendor-neutral home; a client config override (above) lets one client run "create-component" at higher effort without editing the skill or the base registry.

---

## Validation — `registry-lint` (CI gate)

The registry is only enforceable if it stays internally consistent, so skillforge adds a **`registry-lint`** guard (sibling of `skills-ref` and the `secret-scan` of [security.md](security.md)). It is vendor-neutral — plain JSON checks, no model in the loop.

**Two locations, one clean-room boundary (SEC-P2-1).** `registry-lint` is split across the two environments that legitimately hold each kind of data — the engine CI must never hold a client config, so any check that needs `clients_dir` runs *deployment-side*, not in the engine repo:

**Engine-CI checks — registry *internal* consistency, ZERO client data:** these are the gate that runs in the engine repo's CI and fails the build on —

- a registry `name` with no matching `SKILL.md` (or a `SKILL.md` absent from the registry) — inventory drift;
- a `requiredAdapters` entry naming an adapter the engine does not provide ([adapters.md](adapters.md));
- a `requiredAdapters` entry whose pinned **adapter-contract version** the catalog cannot satisfy (a `{ name, version }` ref whose MAJOR mismatches, or that needs a `(minor, patch)` newer than the catalog ships — API-06, [adapters.md](adapters.md) §"Namespacing and versioning the registry"); a bare-name ref (no pin) is the backward-compatible default and always resolves;
- an adapter in the engine catalog that **ships no gate** (the gate-per-adapter registration rule, [adapters.md](adapters.md) §how-to-add steps 5–6): an input adapter must declare a determinism golden that exists, an output adapter a genericity-proof pairing it is actually in — so the catalog cannot grow ungated;
- a `requiredSecrets` entry that is not a reference *string* (the **shape** check — names only, never values);
- a `requiredTools` entry outside the org's tool allow-list ([tool-governance.md](tool-governance.md));
- the **tighten-only merge rule** is implemented and exported (`validateOverrideTightens`) for the deployment side to call — the engine CI validates the *rule's shape*, not any client's actual override.

**Deployment-side checks — need `clients_dir`, run in the loader environment:** these require real client configs the engine repo must never hold, so they run where `clients_dir` legitimately lives ([loader-and-activation.md](loader-and-activation.md)), using the same exported predicates —

- a `requiredSecrets` **reference not declared in any client config** (a secret nobody can resolve) — *resolvability*, which needs the client configs;
- a per-client **override that *broadens* the base** (enables a disabled skill, widens scope, adds a tool) — evaluated against the client's real override via `validateOverrideTightens`.

This keeps the clean-room boundary intact: the engine CI proves the catalog is internally sound with no client data in the loop, and the resolvability/override checks run in the only environment that legitimately has the client configs. Each engine-CI gate's PASS/FAIL is observable on the [telemetry dashboard](telemetry.md), so "the skill inventory is consistent" becomes a continuously-checked property. Catalog of gates → `docs/security.md`.

---

## Claude flavour — an optional emit-adapter

Everything above runs **without Claude**: open `SKILL.md` + a JSON registry + JSON linters. When the runtime *is* Claude Code, an **optional emit-adapter** projects the registry onto Claude's native surfaces (it never replaces the open layers — it derives from them):

- `enabled: false` → Claude `skillOverrides` set to `"off"`, and/or a `Skill(<name>)` **deny** rule ([code.claude.com/docs/en/skills](https://code.claude.com/docs/en/skills));
- per-client/project `scope` → `Skill(<name> *)` allow rules and the managed-settings projection in [tool-governance.md](tool-governance.md);
- `requiredTools` → the skill's `allowed-tools` pre-approval (advisory) **plus** the enforced permission rules of [tool-governance.md](tool-governance.md);
- `model` / `effort` → the skill's Claude-flavour frontmatter fields;
- packaging a set of skills → Claude `plugin.json` / `marketplace.json` manifests, generated from the registry.

This is the same "swappable edge, generic interior" shape the rest of the spec uses ([adapters.md](adapters.md), [security.md](security.md)): the registry is the stable, vendor-neutral seam; the Claude projection is one replaceable backend.

### Implementation — `src/emit/` (opt-in, default off)

The emit layer is a profile dispatch (`src/emit/index.js`), mirroring the adapter dispatch of [adapters.md](adapters.md): a profile **name** resolves to an emit function, and the catalog has two entries.

- **`open-core`** — the **default**. A strict **no-op**: `emit({ skillText })` returns the `SKILL.md` **byte-identical** and zero companions. This is the portability promise made executable — a skill authored to the open core is never touched by emit, so it runs unchanged on any skills-compatible (non-Claude) runtime.
- **`claude`** — the **opt-in** flavour (`src/emit/claude-flavour.js`), applied only when a caller explicitly selects it. It projects the registry entry onto Claude's surfaces, **purely additively**:
  - a **fenced additive frontmatter block** carrying `model`/`effort` (from the registry, only when concrete — `"inherit"` is *not* projected), `allowed-tools` (from `requiredTools`, advisory pre-approval per [tool-governance.md](tool-governance.md)), and `metadata.skillforge.*` provenance — inserted **before** the closing `---` fence, never overwriting an open-core field;
  - **companion files** the open standard does not define: a slash-command (`commands/<name>.md`), a managed-settings projection (`managed/<name>.settings.json`, the [hardened tier](tool-governance.md)), and — only when the registry declares one — a runtime-context-injection descriptor (`context/<name>.inject.json`).

**The additive invariant is enforced by test, not asserted in prose.** `test/emit-claude-flavour.test.js` proves the key acceptance: the same authored `SKILL.md` emitted under `open-core` is byte-identical to the input, and `stripClaudeFlavour(emit(claude))` recovers the open core **byte-for-byte** — the body untouched, every original frontmatter field preserved verbatim. The flavour only **adds**; it is never required to run the skill.

---

## Takeaways

- A skill's format is the **open Agent Skills standard** (`SKILL.md` frontmatter), validated by **`skills-ref`** — portable, not Claude-locked. skillforge extensions ride in **`metadata.skillforge.*`**.
- **`allowed-tools` is pre-approval, not a boundary** — the registry + resolver decide ([tool-governance.md](tool-governance.md)).
- The **`skillforge.registry.json`** records version, enabled, requiredTools/Adapters, **secret *references***, scope, and model/effort — the inventory as enforceable data.
- **OD-1:** generic registry in the engine repo; per-client overrides as data in `clients_dir`, **tighten-only**.
- **OD-6:** model/effort defaults in the registry, overridable per client config.
- **`registry-lint`** keeps the catalog consistent (sibling of `skills-ref` / `secret-scan`); results are observable.
- A **Claude flavour emit-adapter** projects the registry onto `skillOverrides`, `Skill(...)` rules, and plugin manifests — optional, derived, never authoritative.

---

## Related documents

- What a skill is, generic by design: [`skills-and-commands.md`](skills-and-commands.md)
- How the engine loads/validates skills + the `clients_dir` boundary: [`loader-and-activation.md`](loader-and-activation.md)
- How tool calls are governed and enforced (where `allowed-tools` stops being a boundary): [`tool-governance.md`](tool-governance.md)
- The secret-reference discipline reused for `requiredSecrets`: [`security.md`](security.md)
- The adapter contract behind `requiredAdapters`: [`adapters.md`](adapters.md)
- The CI gates (`skills-ref`, `registry-lint`): `docs/security.md`
