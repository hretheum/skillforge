# Contributing to skillforge

skillforge is a generic skill factory: one engine, many clients, zero client knowledge baked into the
engine. Contributions are welcome in all of these areas:

- **New skill kinds** — extend the executor catalog with a new kind when existing kinds (artifact,
  instruction, validation, analysis, transformation, sync) do not cover a new class of behavior.
- **New skills** — add a skill to the registry that uses an existing kind. Skills may be generic (useful
  across clients) or client-specific (lives alongside a client config, not in the core registry).
- **Client configs** — add or improve a per-client configuration so the engine serves a new client without
  touching engine code. Each client config is self-contained data; the engine stays untouched.
- **Bug fixes** — correctness fixes to the engine, the gate tools, or the test helpers.
- **Docs** — keep the spec, the audit framework, and inline comments accurate and current.

Before contributing code, read the clean-room rule below. It applies to everyone.

---

## Getting started

```sh
# 1. Fork the repo, then clone your fork
git clone https://github.com/<your-handle>/skillforge.git
cd skillforge

# 2. Install dependencies (one runtime dep: @modelcontextprotocol/sdk)
npm install

# 3. Verify the test suite is green
node --test            # expected: 1076 pass, 0 fail (1 skipped)

# 4. Verify the skill registry
node tools/registry-lint.js    # expected: PASS

# 5. Verify determinism
node tools/determinism-gate.js # expected: PASS
```

If any of those three commands fail on the unmodified `main` branch, open an issue before continuing.

---

## The clean-room rule (read this first)

skillforge is an **independent work written from scratch from the concept alone**. To keep it that way,
the project operates a **one-way membrane**: the concept may cross in, the code never does.

**What this means in practice:**

- You may bring ideas, patterns, interface designs, and design thinking from anywhere.
- You may **not** bring a single line of someone else's code — not by copy-paste, not by "rewrite with a
  foreign file open alongside," not by cherry-pick from another repository.
- You may **not** bring anyone else's client configuration, third-party confidential data, or provenance
  records into this repository.
- You may **not** reproduce module names, directory layouts, or config formats that are concrete
  implementation details of another project. If you need a name, invent one.

**Why it matters for contributors:** clean-room integrity protects every contributor's work. A tainted
contribution exposes not only the submitter but the entire project. When in doubt: close the foreign file,
put it down, and re-derive the solution from the concept alone.

**This applies to skill `SKILL.md` files too.** Write skill definitions from your own knowledge of what the
skill should do. Do not copy frontmatter blocks or prose from other skill frameworks, even as a starting
template.

The full principle and daily practice are documented in
`CLAUDE.md`.

---

## Writing a skill

A skill is three things in harmony: a definition file, a compose function, and a registry entry. All three
must exist and agree before the lint gates pass.

### 1. Skill definition — `skills/<name>/SKILL.md`

The SKILL.md file is the human-facing description of what the skill does, when it applies, and what it
produces. Its frontmatter carries identity and metadata; the body is narrative prose (when this applies,
what it produces, boundaries). The skill *kind* and its governance live in the registry entry (step 3),
not in this file.

Frontmatter fields:

```yaml
---
name: my-skill
description: >-
  One or two sentences on what the skill does and when to use it. The engine
  uses name + description for recognition; keep both ASCII and specific.
license: SEE LICENSE IN LICENSE
compatibility: >-
  Any preconditions — required adapters, file/network access — stated in prose.
metadata:
  skillforge.owner: platform
  skillforge.registryKey: my-skill   # must match the key in the registry
  skillforge.sourceKind: design-system     # optional, skill-dependent
  skillforge.resultKind: frontend-component # optional, skill-dependent
---

# Narrative body — when this applies, what it produces, how a run proceeds, boundaries.
```

See [`skills/create-component/SKILL.md`](skills/create-component/SKILL.md) for the canonical worked
example.

The six available kinds (declared per skill in the registry, not here) and their intended use:

| Kind | What it produces | Write-class? |
|------|-----------------|--------------|
| `artifact` | A new file or asset | Yes |
| `instruction` | A procedural guide for a human or agent | No |
| `validation` | A pass/fail check result | No |
| `analysis` | A structured analysis document | No |
| `transformation` | A modified version of an existing artifact | Yes |
| `sync` | A synchronisation operation (two-way data alignment) | Yes |

Side effects are a property of the skill *kind*, not of the individual skill: each kind is backed by a
descriptor whose `sideEffects` function reports what a run of that kind writes. The
`LINT-GOVERNANCE-SIDEEFFECTS` rule enforces the invariant that any write-class kind (`artifact`,
`transformation`, `sync`) has a `sideEffects` function returning a non-empty result — so adding a new
*kind* (not a new skill) means wiring that descriptor correctly. A new skill that reuses an existing kind
inherits its governance automatically.

### 2. Compose function — `src/skills/<name>/compose.js`

The compose function assembles the skill's normalized result at runtime from a generic recipe plus the
client's already-normalized data. Export it as a **named** function, then register that export in the
compose-registry (see below) so the registry `compose` ref can resolve to it. Keep compose pure — no
I/O, no network, no side effects; the input/output adapters handle all I/O.

```js
// src/skills/my-skill/compose.js
export function composeMySkill({ request, description } = {}) {
  // `description` is the client's design system, already normalized by the input adapter.
  // `request` is caller-supplied skill data (component facts, inputs) — never a client identity.
  // Return a normalized result; the output adapter renders it. No client name/path/literal here.
  return { /* normalized result */ };
}
```

### 3. Registry entry — `skillforge.registry.json`

Add an entry keyed by the skill name under `skills` in the root registry file. The registry is where the
**kind**, the **compose reference**, the **required tools**, and **governance** live:

```json
{
  "skills": {
    "my-skill": {
      "version": "0.1.0",
      "enabled": true,
      "owner": "platform",
      "skillKind": "artifact",
      "compose": "my-skill/compose.js#composeMySkill",
      "requiredTools": ["Read", "Write"],
      "requiredAdapters": { "input": ["dtcg-tokens"], "output": ["react"] },
      "requiredSecrets": [],
      "scope": { "clients": ["*"], "projects": ["*"] },
      "model": "inherit",
      "effort": "medium",
      "sourceKind": "design-system",
      "resultKind": "frontend-component"
    }
  }
}
```

`scope.clients` restricts a client-specific skill to one client (e.g. `["verdex"]`); use `["*"]` for a
generic skill.

The `compose` ref (`"my-skill/compose.js#composeMySkill"`) is **not** resolved by filesystem path — it is
looked up in an explicit allowlist, `COMPOSE_BY_REF` in
[`src/skills/compose-registry.js`](src/skills/compose-registry.js). Import your compose function there and
add it to that map under the same ref string. A ref absent from the map fails `LINT-COMPOSE-REQUIRED` (and
fails loud at run time) — this is deliberate: no compose function runs unless it has been enumerated.

### 4. Tests — `test/skills/<name>/`

Every skill needs at least one integration test that exercises it via the public API:

```js
import { runSkill } from '../../src/engine/run.js';

// At minimum: verify runSkill() returns a non-empty result for your skill
```

### 5. Lint the registry

```sh
node tools/registry-lint.js
```

All rules must pass:

| Rule | What it checks |
|------|---------------|
| `LINT-NAME-REQUIRED` | Every registry entry has a name (the key) |
| `LINT-SKILLKIND-REQUIRED` | Every registry entry declares a valid `skillKind` |
| `LINT-COMPOSE-REQUIRED` | Every registry entry's `compose` reference resolves to an existing export |
| `LINT-GOVERNANCE-SIDEEFFECTS` | Every write-class kind's descriptor reports non-empty side effects |
| `LINT-TOOL-ALLOWLIST` | `requiredTools` only names tools on the allowlist |
| `LINT-SECRET-REF-SHAPE` | `requiredSecrets` entries are well-formed references, not literals |
| `LINT-ECC-DUPLICATE` | No duplicate skill names in the registry |

---

## Writing tests

skillforge uses **Node.js built-in `node:test`** — no external test runner, no additional install
required.

```sh
node --test          # run the full suite
node --test test/engine/  # run a subtree
```

Test files live in `test/` mirroring the `src/` structure:

```
src/engine/run.js         →  test/engine/run.test.js
src/skills/my-skill/      →  test/skills/my-skill/
```

**What to test:**

- **Integration tests** — call `runSkill()` directly. This is the sole public API; test against it, not
  against internal helpers.
- **Gate tests** — verify that lint rules fire correctly on deliberately invalid input. If you add a new
  lint rule, add a test that proves it rejects the bad case.
- **Compose tests** — call the compose function in isolation to check content assembly logic.

Aim for tests that are **data-driven and assertion-first**: state what you expect, then verify it. Avoid
tests that merely confirm "no exception was thrown" — assert the shape and content of the output.

---

## Running gates (quick reference)

All three gates must pass before opening a PR.

| Gate | Command | Must pass |
|------|---------|-----------|
| Test suite | `node --test` | 0 fail |
| Registry lint | `node tools/registry-lint.js` | 0 errors |
| Determinism | `node tools/determinism-gate.js` | PASS |

The determinism gate runs each skill multiple times and checks that identical inputs produce identical
outputs. A non-deterministic skill is a correctness bug.

---

## PR checklist

Verify each item before opening a pull request:

- [ ] `node --test` passes (0 fail)
- [ ] `node tools/registry-lint.js` passes (all rules)
- [ ] `node tools/determinism-gate.js` passes
- [ ] No client-specific data (real URLs, brand names, client configs) in engine code
- [ ] No code from external sources (clean-room rule respected — see above)
- [ ] New skill has tests (`test/skills/<name>/`)
- [ ] CLAUDE.md "Status" table updated if the public API changed
- [ ] Commit messages follow the format below

---

## Commit format

Convention: `<type>(<scope>): <description>`

```
feat(engine): add new skill kind
fix(cli): handle missing registry gracefully
test(store): add manifest roundtrip tests
docs: update CONTRIBUTING
refactor(compose): extract shared context builder
chore: bump node engine field in package.json
```

**Types:** `feat`, `fix`, `refactor`, `test`, `docs`, `chore`

**Rules:**
- Subject line under 72 characters
- Imperative mood ("add", "fix", "remove" — not "added", "fixes", "removing")
- Body is optional; use it to explain *why*, not *what*
- No ticket references required, but `(KAN-NNN)` in the body is welcome for context
