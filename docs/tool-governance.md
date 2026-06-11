# Tool governance

---

## OD-3 — `allowed-tools` is pre-approval, **not** a security boundary

State it plainly, because the whole governance design depends on it:

> **A skill's `allowed-tools` does not restrict anything.** In the open standard the field is marked
> *experimental* ([agentskills.io/specification](https://agentskills.io/specification)). In Claude Code,
> the docs are explicit: `allowed-tools` *"grants permission for the listed tools while the skill is
> active, so Claude can use them without prompting… **It does not restrict which tools are available**:
> every tool remains callable, and your permission settings still govern tools that are not listed"*
> ([code.claude.com/docs/en/skills](https://code.claude.com/docs/en/skills)).

So a skill listing a tool is a **convenience** (skip the prompt), never a sandbox. Two facts reinforce this: the field's support *"may vary between agent implementations"* (open spec), and it is honored by the Claude Code CLI but **does not apply via the Agent SDK** (a documented inconsistency — restrictions must be re-declared in the SDK's `allowedTools` option). **skillforge therefore never relies on `allowed-tools` for a boundary.** It is documentation/UX inside the [skill manifest](skill-manifest-and-registry.md); the boundary is the policy resolver and the enforcement seam below.

---

## The policy resolver — `(profile, skill, client, project, tool) → allow | ask | deny`

The heart of tool governance is a small, **data-driven, model-independent** resolver. Given a proposed tool call, it returns one of `allow | ask | deny` by composing rules from five layers, **deny-first** (any deny anywhere wins). The layers are listed **highest-priority deny first** — Layer 0 is the residency floor that nothing below can re-open:

0. **Deployment profile** — the residency/retention posture from [deployment-profiles.md](deployment-profiles.md), evaluated by the profile-evaluator ([loader-and-activation.md](loader-and-activation.md)). Under the **compliance** profile, every **server-side tool** (code execution, web search/fetch) is denied **before any other layer is consulted**; no org/client/project/skill rule can re-allow it. This closes the residency↔governance seam (GOV-02) — see ["Layer 0 — the deployment-profile deny floor"](#layer-0--the-deployment-profile-deny-floor-gov-02) below.
1. **Org baseline** — what *any* client may ever do (the floor; e.g. "never `Bash(rm -rf *)`", "no `WebFetch` to non-allowlisted domains").
2. **Per-client** rules — narrowing for one client.
3. **Per-project** rules — the **default and preferred** granularity (narrowest), exactly as project scope is first-class for secrets in [security.md](security.md).
4. **Per-skill** `requiredTools` — from the [registry](skill-manifest-and-registry.md), *intersected* with the above (a skill can only use a tool that all higher layers also permit).

The exact composition rule across these layers — what happens when two layers disagree, how `ask` ranks against `allow`, and how layer-4 "intersect" is defined for a three-valued output — is the **decision algebra** below (GOV-01). It is stated as an algebra, not prose, because a three-valued policy with an under-defined join is the classic source of authorization bugs: two correct-looking implementations would otherwise disagree on `(org=ask, project=allow)`.

Properties:

- **Deny-first, strictest-wins.** Mirrors the permission evaluation order Claude Code uses (`deny → ask → allow`, [code.claude.com/docs/en/permissions](https://code.claude.com/docs/en/permissions)) and the tighten-only merge rule of the [registry](skill-manifest-and-registry.md). A stricter decision at any layer cannot be loosened by another — the full ordering is the lattice in the algebra below.
- **Model-independent.** The resolver is plain logic over data (registry + per-client/per-project configs + the active profile, loaded from `clients_dir`, [loader-and-activation.md](loader-and-activation.md)). It runs **without Claude** — it can gate a different runtime, or run as a CI dry-run that replays a transcript and flags any call that *would* have been out of scope.
- **Scoped by `(profile, skill, client, project, tool)`.** The same addressing spine as secrets, plus the profile as the deny floor, so "this skill may touch *acme/checkout*'s tracker but not *acme/billing*'s — and never a server-side tool under compliance" is expressible and enforceable.

This resolver is the **authoritative** counterpart to the skill's advisory `allowed-tools`: the manifest *requests* tools, the resolver *decides*.

### Eligibility ≠ permission — `scope` vs the resolver (GOV-03)

One reconciliation must be stated plainly, because [`12`](skill-manifest-and-registry.md)'s registry `scope` and this resolver could otherwise be read as pointing opposite ways. A skill's `scope.{clients,projects}` (where `"*"` = any, [`12`](skill-manifest-and-registry.md) §`scope`) looks like it grants reach; the resolver is deny-first and project-first. So when a skill is scoped `["*"]` but no project rule opted it in, is the call allowed (scope says any) or denied (no rule)? **The default posture, explicitly:**

> **`scope` gates *eligibility*; the resolver gates *permission*.** A skill scoped `["*"]` is *eligible* in every client/project — but a tool call still needs an **affirmative allow** from the deny-first resolver chain (org/client/project). Absent any allow, the call is **denied**. So `"*"` means "**not excluded by the inventory**," never "**permitted to act**."

This is the least-privilege reading (consistent with deny-first and [`11`](security.md)), and it makes the two docs agree: `scope` decides *whether a skill may run at all here* (the inventory/firing question — enforced at the prompt-expansion gate below); the resolver decides *whether a given tool call is permitted* (the per-call question). They are different questions on different seams, so there is no contradiction.

**Worked case (the GOV-03 disambiguator).** A `["*"]`-scoped skill that *requires* `mcp__tracker__create` but runs in a `(client, project)` whose org/client/project layers carry **no** matching allow rule: the skill layer **defers** (it declared the tool — Layer 4 is a gate, not a grant), every upper layer **defers** (no rule matched), so the fold is all-`defer` → the default **`deny`** (next section). Eligible everywhere, permitted nowhere-without-a-rule. Granting it requires an affirmative org/client/project allow — exactly the `(client, project)`-scoped narrowing the resolver exists to express. (Resolver unit cases: `test/governance/policy-resolver.test.js` §"T-HARD-11 — eligibility ≠ permission".)

---

## Decision algebra (GOV-01) — the complete `deny > ask > allow` lattice

The resolver's output is three-valued, so its composition must be defined as a **lattice**, not as a set operation. Stating it precisely closes GOV-01 and gives `registry-lint`'s "no override broadens scope" check (below) an exact meaning.

### The decision lattice

The three decisions are **totally ordered by strictness**:

```
deny  >  ask  >  allow          (deny is strictest, allow is loosest)
```

A fourth value, **`defer`** (= "no rule at this layer matched this tool"), is the **identity** for composition — it contributes nothing and is treated as the loosest possible, so a layer that says nothing never tightens or loosens the result on its own. `defer` is an internal per-layer outcome only; the resolver's *final* output is always one of `{allow, ask, deny}` (see "default" below). The `defer` permission decision the `PreToolUse` hook can return ([hooks](https://code.claude.com/docs/en/hooks)) is a separate runtime concept — do not conflate the two.

### Composition operator — `⊓` (meet = take the stricter)

Two layer decisions compose with the **meet** operator: the result is the **stricter** (higher in the lattice) of the two. This is the single rule for every layer-vs-layer combination:

| `⊓` | deny | ask | allow | defer |
|---|---|---|---|---|
| **deny** | deny | deny | deny | deny |
| **ask** | deny | ask | ask | ask |
| **allow** | deny | ask | allow | allow |
| **defer** | deny | ask | allow | defer |

Read off the consequences the audit flagged as undefined:

- **`(org = ask, project = allow) → ask`.** `ask` is **stickier** than `allow`: a lower layer cannot downgrade an upper layer's `ask` to `allow`, exactly as it cannot downgrade a `deny`. The safer reading wins, by construction.
- **`(ask, deny) → deny`**, **`(allow, deny) → deny`** — deny-first is just the top of the same lattice; nothing special-cases it.
- **Order-independence.** `⊓` is associative and commutative, so the *order* in which layers are folded does not change the result — "first-match-wins" is not needed and is not used. (The layers are still *listed* highest-deny-first for readability; the math does not depend on the listing order.) The only asymmetry is **Layer 0**, which is evaluated as a pre-filter — see below.

### Full composition

```
resolve(profile, skill, client, project, tool) =
    profile₀(profile, tool)              -- Layer 0, pre-filter (see next section)
    ⊓ org(tool)                          -- Layer 1
    ⊓ client(client, tool)               -- Layer 2
    ⊓ project(client, project, tool)     -- Layer 3
    ⊓ skill(skill, tool)                 -- Layer 4 (the requiredTools clamp)
```

Each `layerₙ(...)` returns a decision in `{allow, ask, deny, defer}` for the matched tool pattern (matching semantics: next section). `defer` means that layer expressed no rule for this tool.

### Layer 4 — `requiredTools` is a clamp, not a broadener

"Intersect" for the per-skill layer is **defined in lattice terms**: a skill's `requiredTools` request is *clamped to the strictest decision of the upper layers*. A skill listing a tool can only ever **lower the result toward `deny`** (or leave it unchanged); it can **never** raise it toward `allow`. Concretely, the skill layer is a **gate, not an affirmative grant**: it contributes `defer` for a tool the skill **requires** (leaving the org/client/project decision untouched — `defer ⊓ X = X`, so requiring a tool **never loosens**) and `deny` for a tool the skill does **not** require (a skill may not use a tool it never declared). The *affirmative `allow`* must therefore come from an org/client/project rule — never from `requiredTools` alone. This is the precise meaning of "a skill can only use a tool that all higher layers also permit," and it is what makes **eligibility ≠ permission** (T-HARD-11) fall out: a `["*"]`-scoped skill that *requires* a tool but has no org/client/project rule granting it folds to all-`defer` → **`deny`** (next section), because being eligible everywhere is not the same as being permitted to call the tool.

### GOV-04 — Affirmative allow required (`requiredTools` clamps, it does not grant)

The Layer-4 clamp above has a deployment consequence that is easy to get wrong, so state it as its own invariant: **declaring a tool in `requiredTools` does not permit it.** The clamp can only *narrow toward `deny`* — for a declared tool it contributes `defer`, the loosest possible decision and the identity of the meet (`defer ⊓ X = X`). It therefore **adds nothing** on its own. The permission must come from an **affirmative `allow`** at the org, client, or project layer; absent one, every upper layer also `defer`s and the all-`defer` default (next section) makes the call **`deny`**.

This bites the common deployment shape where a client config carries `requiredTools` but **no** org-level allow rules: the declared tools are still **denied**, because nothing affirmatively allowed them. The fix is an **org baseline** of `allow` rules for the standard tool set (the `org` layer), so a declared tool clears the chain:

| `requiredTools` | affirmative allow (org/client/project) | resolver result |
|---|---|---|
| tool **declared** | **none** | `deny` (clamp `defer`, all upper `defer` → all-`defer` default) |
| tool **declared** | `allow` present | `allow` (clamp `defer` leaves the upper `allow` untouched) |
| tool **not** declared | `allow` present | `deny` (clamp `deny` wins over the upper `allow` — the gate removes undeclared tools) |

So `requiredTools` and the affirmative allow are **both** necessary and **neither** is sufficient: the allow without the declaration is clamped to `deny` (an undeclared tool), and the declaration without the allow defers to the `deny` default. (Resolver/seam cases: `test/governance/required-tools-gate.test.js`.)

**Where the org baseline comes from (config → org layer).** The "org baseline of `allow` rules" above is **data the client config carries**: an `orgBaseline` array of `{ pattern, decision }` rules. The config loader exposes it (`loadClientConfig` returns `orgBaseline`), and the executor's gate stage folds it into the **org layer** the resolver sees — concatenated with any org rules the caller also passes, since a layer folds its rules deny-first and the order is irrelevant. Without this wire the rules would be documentation only: the gate would run with an empty org layer and every declared tool would hit the all-`defer` → `deny` default. A tool the config's `orgBaseline` allows **and** the skill declares therefore clears the chain to `allow`; a tool outside the baseline stays `deny`. (Executor fold: `test/engine/executor.test.js`.)

### Default when every layer defers

If, after folding, the result is `defer` — **no layer matched the tool at all** — the resolver returns **`deny`**. Silence is denial (deny-first, least privilege; consistent with `11`). The wildcard `*` org-baseline rule (e.g. an org default of `ask` or `deny` on `*`) is the explicit way to set a different floor; absent it, an un-mentioned tool is denied, not allowed.

### Tool-pattern matching and subsumption (also closes GOV-05)

The algebra above operates on *tools*, but layer rules and `requiredTools` are written as **patterns** (`mcp__tracker__*`, `Bash(rm -rf *)`, a bare tool name). Composition and `registry-lint` both need a precise **subsumption order** — when one pattern is "broader than" another:

```
literal   ⊂   prefix-* (e.g. mcp__tracker__*)   ⊂   *   (any tool)
```

- A concrete call `mcp__tracker__create` **matches** a rule pattern `P` iff `P` subsumes it (`literal == call`, or `prefix-*` is a prefix of it, or `*`).
- For two patterns, `A ⊑ B` ("`A` is subsumed by / narrower-or-equal to `B`") iff every tool matching `A` also matches `B` (`mcp__tracker__read ⊑ mcp__tracker__* ⊑ *`).
- When **multiple patterns within one layer** match a call, that layer's decision is the **meet (`⊓`) of all matching patterns' decisions** — a layer-local `Bash(rm -rf *) = deny` beats a same-layer `Bash(*) = allow`, so specific denies are never lost under broad allows.

With subsumption defined, `registry-lint`'s two checks become computable: **"within the org allow-list"** = every `requiredTools` pattern is `⊑` some org-allowed pattern; **"no override broadens scope"** = a client/project override pattern must be `⊑` the pattern it overrides (it may narrow, never widen). This is the same subset test GOV-05 asked for, and it is exactly what makes the Layer-4 clamp checkable in CI rather than only at runtime.

---

## Layer 0 — the deployment-profile deny floor (GOV-02)

The deployment profile is **Layer 0**: the **highest-priority deny source**, evaluated as a **pre-filter** *before* the org→client→project→skill chain runs. This is what wires residency (`14`/`15`) and tool governance into **one** decision path — closing GOV-02, where "may this skill call WebFetch?" previously had two independent answers (the resolver and the loader's separate profile check).

**Rule.** Under the **compliance** profile (profile A, [deployment-profiles.md](deployment-profiles.md)), `profile₀(A, tool) = deny` for every **server-side tool** (code execution, web search/fetch, and any tool whose execution would route content outside the EU/ZDR boundary), and `defer` for everything else. Under the **convenience** profile (profile B) `profile₀` defers for all tools (it imposes no residency restriction). Because `deny ⊓ X = deny` for all `X`, a profile-A server-side tool is rejected **before the resolver consults org, client, project, or skill** — no lower layer can re-open it. A profile-A deployment that *tries* a residency-violating call gets a deny at the **same `PreToolUse` seam** as every other tool decision, not a quiet leak discovered at audit time (`14`'s "invisible until an audit" failure).

**Single source of truth.** Layer 0 reads the **feature × profile contract table** owned by [deployment-profiles.md](deployment-profiles.md); it does not restate it. The *evaluation* of that table is the **profile-evaluator** factored out of the loader ([loader-and-activation.md](loader-and-activation.md), ARCH-03): a small, data-driven `(profile, feature) → allow | deny` function, a sibling of this resolver. The loader *calls* the profile-evaluator for startup-time feature legality (Files API, server-side skills, batch); the resolver *calls* the same evaluator as Layer 0 for per-call server-side-tool legality. **One evaluator, two call sites, one table.**

> **Why pre-filter and not "just another layer".** Layers 1–4 compose with `⊓`, where any layer can in principle be the strictest. Layer 0 is special: it is a **floor that must hold regardless of what the tool layers say**, and it must be **cheap and first** (a residency violation should never even reach org/client/project evaluation). Modeling it as a pre-filter — rather than relying on it happening to be strictest under `⊓` — makes the residency guarantee structural and obvious, and lets the same profile-evaluator gate non-tool features (Files API, batch) that the `⊓` chain does not address at all.

---

## Enforcement seam — hooks

A resolver decision is only governance if something *acts on it before the tool runs*. The enforcement seam is **hooks** — the deterministic interception points around tool calls and skill activation. (the three load-bearing events for skillforge:)

### 1. `PreToolUse` — the per-call gate

Fires **before** a tool executes. It returns a decision via `hookSpecificOutput.permissionDecision ∈ {allow, deny, ask, defer}`, can rewrite arguments via `modifiedToolInput`, and can hard-block by exiting with code 2 ([code.claude.com/docs/en/hooks](https://code.claude.com/docs/en/hooks)). skillforge wires a `PreToolUse` hook to **call the policy resolver** for the active `(profile, skill, client, project, tool, toolInput)` and translate the result into `allow | ask | deny`. This is where the dynamic per-`(client, project)` scope — and the Layer-0 profile floor — which static rules cannot express, gets enforced at one seam. (The hook's `defer` decision and the algebra's internal `defer` identity are distinct — see the algebra above.)

This same hook **hosts the `secret-scan`** of [security.md](security.md): inspect `tool_input` and `deny` when a credential-shaped string is about to be written or sent. Per-call, deterministic, before the side effect.

### 2. `PostToolUse` → telemetry / audit

Fires after a tool runs (cannot undo it). skillforge uses it to emit a **secret-free** telemetry event per tool call ([security.md](security.md) hard rules; [telemetry.md](telemetry.md)), so "no out-of-scope tool ran" and "no secret entered the repo" become continuously observable, not one-time hopes.

#### Audit-trail integrity and scope (GOV-06)

`PostToolUse` is **observation, not enforcement** — it fires *after* the tool ran. So "no out-of-scope tool ran" is only provable from these events if the trail is **complete and trustworthy**: an attacker who can suppress or rewrite a record would erase the audit. The trail therefore carries three explicit properties, and one honest boundary:

- **Append-only.** Once recorded, an entry is immutable; the trail grows only at the end. There is no edit, delete, or reorder path. (In code, recorded entries are deep-frozen and only a single `record()` appends — `src/governance/audit-trail.js`.)
- **Tamper-evident (hash chain).** Each entry stores the previous entry's hash (`prevHash`, a genesis link for the first) and its own `hash = contentHash(fact + seq + prevHash)`. Altering or removing any entry breaks the chain from that point, which `verify()` detects and points at. A strictly-increasing `seq` makes a *gap* (a suppressed entry) visible independently of the chain. `PostToolUse` cannot **prevent** a determined attacker from dropping an in-memory record — so the trail makes such a drop **detectable** rather than pretending to prevent it.
- **Scoped.** Every entry carries its `(client, project)` — the same addressing spine as secrets and the resolver — so the trail filters per client/project and never co-mingles whose action was whose.
- **Secret-free.** An entry records the **resource name** (tool, skill, scope handles) and the resolver **decision** (`allow | ask | deny`) — never a secret value, never raw `tool_input`/source/artifact content. The entry builder secret-scans its own payload and refuses a credential-shaped value (fail-closed), the same discipline as `secret-scan` and `skill_result`. This is the STRIDE **Repudiation** control of [`11`](security.md) ("*names of resources, never values*").

> **Honest boundary (GOV-06).** The audit's *authority* to say a call was blocked derives from the **`PreToolUse` deny** (which actually blocks the call), **not** from the presence of a `PostToolUse` record. A **missing** `PostToolUse` entry is a **reliability** concern (the record is incomplete) — caught by the seq gap / chain check — **not** a security **bypass** (the call was already gated upstream). `PostToolUse` is a *secondary record*; the boundary is, and remains, the deny-first resolver at `PreToolUse`.

### 3. Prompt/command expansion → the skill-firing gate

When a skill is invoked as a `/command`, the expansion event (matcher = the skill name) can **block** activation ([code.claude.com/docs/en/hooks](https://code.claude.com/docs/en/hooks)). skillforge uses it to refuse a skill whose [registry](skill-manifest-and-registry.md) `enabled`/`scope` does not permit it for the active client/project — enforcement of the inventory, not honor-system.

> **Hooks extend, never weaken, policy.** Claude Code's docs note that a `PreToolUse` hook can deny or
> force a prompt, but a hook *"cannot bypass"* a matching deny rule, and a hook exiting 2 blocks even when
> an allow rule would pass ([code.claude.com/docs/en/permissions](https://code.claude.com/docs/en/permissions)).
> The resolver-plus-hook seam is therefore strictly additive to whatever deny rules exist — defense in depth.

### Inbound threat plane (T-HARD-01)

The `PreToolUse` seam is also the **choke point for the inbound (prompt-injection) threat**. The threat itself — untrusted client source / tool-result content riding into the prompt as tier-2 data and trying to act as tier-1 instruction — is modelled in [`security.md`](security.md) §"Inbound threats — untrusted source content" (SEC-P1-1). Its **two controls are executable here**, and the *"injected instruction is inert, not merely unlikely"* claim is **proven by a red-team corpus**, not asserted:

- **Content/instruction isolation** (defense in depth, **not** the boundary) — `frameUntrustedContent()` in `src/governance/inbound-guard.js` wraps inbound content in a labelled *"DATA, NOT INSTRUCTIONS"* fence and neutralizes a **delimiter-breakout** payload (a forged closing fence inside the content), so tier-2 is presented as material to act *on*, never instructions to act *from*.
- **The boundary is the deny-first resolver at this seam.** A synthetic injection corpus (`src/governance/injection-corpus.js` — direct-override, fake-system, role-play, tool-result-poison, scope-escalation, exfiltration, encoded, delimiter-breakout) is replayed through the real `PreToolUse` hook by `findScopeEscalations()`/`probeScopeEscalation()`: each payload runs the hook twice — clean vs with the injected content on the inbound plane — across several governance contexts. The invariant proven (`test/governance/inbound-injection.test.js`): **no payload ever loosens the decision.** A tool the content asks for stays governed by the resolver's allow set, because the resolver decides from tier-1/config data (profile, layers, requiredTools) and **never reads the content** — *no string in a ticket can add a tool* (`11` §"Content / instruction isolation"). A payload whose bytes look credential-shaped may make the decision *stricter* via the co-located `secret-scan` — that is the gate working, not content being honored, so the invariant is "never **looser**," not byte-identity. Non-vacuity is shown by a deliberately content-sensitive hook, which the same probe catches escalating.

---

## OD-2 — base layer is open; managed settings are the optional "hardened tier"

There are two tiers of enforcement strength, and skillforge requires only the first.

### Base layer (required, vendor-neutral)

**Policy resolver + `PreToolUse` hook.** This works on any runtime, depends on no plan or vendor, and is fully data-driven (registry + client/project configs). It is the *required* enforcement: every tool call is resolved and gated before it runs; out-of-scope calls are denied; the secret-scan runs in the same seam. For most deployments this is sufficient — the boundary is real and model-independent.

Its honest limit: the hook runs inside the agent runtime, so its guarantees are as strong as that runtime's integrity. That is acceptable for the default tier (the resolver is deny-first and the secret model keeps values off the text plane regardless), but a hardened deployment wants a layer the runtime *cannot* talk its way past.

### Hardened tier (optional, Claude flavour)

When the runtime is Claude Code, **managed permission settings** add an enforcement layer that **user, project, and even CLI args cannot override** ([code.claude.com/docs/en/permissions](https://code.claude.com/docs/en/permissions)). The relevant, unbypassable controls:

- **`permissions.{deny,ask,allow}` in managed settings** — deny-first, and *"enforced by Claude Code, not by the model"*. A managed deny beats `--allowedTools`; "if a tool is denied at any level, no other level can allow it."
- **`allowManagedPermissionRulesOnly`** — user/project rules are ignored; only managed allow/ask/deny apply.
- **`allowManagedMcpServersOnly` / `allowManagedHooksOnly`** — only managed MCP servers / hooks load (so a rogue project can't register its own).
- **`strictPluginOnlyCustomization`** — block skills/agents/hooks/MCP from user & project sources (lock the customization surfaces).
- **`disableBypassPermissionsMode` / `disableAutoMode`** + **`dontAsk` mode** (auto-deny anything not pre-approved) — remove escape hatches and run locked-down for autonomous batches.
- **`sandbox.*` managed locks** — OS-level filesystem/network enforcement that holds even under prompt injection (complementary to permission rules).

These map directly from the [registry](skill-manifest-and-registry.md) via the **Claude-flavour emit-adapter**: registry `scope`/`enabled`/`requiredTools` → managed `deny`/`allow`/`Skill(...)` rules; the open resolver still runs in `PreToolUse` for the dynamic decisions static rules can't express. **Managed settings are the bonus that makes the boundary unbypassable; they are not the baseline.**

The projection is implemented in `src/emit/claude-flavour.js` and is **opt-in / default off** ([skill-manifest-and-registry.md](skill-manifest-and-registry.md) §"Implementation — `src/emit/`"): the `claude` emit profile derives a `managed/<name>.settings.json` companion whose `permissions.{allow,ask,deny}` is computed from the registry entry — `enabled:false` → a hard `Skill(<name>)` **deny**; otherwise a `Skill(<name>)` **allow** plus the `requiredTools` pre-approval that the resolver still clamps (Layer 4 above). Because it is a *companion* file projected from the registry, it never alters the open core: the same skill emitted under the default `open-core` profile carries no managed settings at all, and the open `SKILL.md` is recovered byte-for-byte (the portability proof in `test/emit-claude-flavour.test.js`).

> **OD-2 decision:** skillforge's **required** enforcement is the open resolver + `PreToolUse` hook (works
> without Claude, no plan gating). Claude managed settings are an **optional hardened tier** for deployments
> that need an enforcement layer the agent runtime cannot override. A deployment chooses its tier; the
> registry data and resolver are the same in both.

### The two seams must agree — managed settings are a verified shadow (GOV-04)

In the hardened tier **two** mechanisms decide the same call: the static **managed rules** (the projection) and the live **resolver** (the hook). Left unstated, they can **drift** — e.g. a registry edit re-emits a managed `allow` for a tool the resolver now denies, so a stale/over-broad managed `allow` pre-empts or contradicts the source-of-truth resolver. State the invariant plainly:

> **The managed settings are a derived projection that must be deny-equivalent-or-stricter than the resolver — never looser.** The resolver is the single source of truth; the managed projection is a *verified shadow*. For every tool, `strictness(managed) ≥ strictness(resolver)` (in the `deny > ask > allow` order): the managed rule may be the **same or stricter**, never looser. A managed **deny** is always safe; a managed **allow** for a tool the resolver **denies**, or a managed **allow** where the resolver only **asks**, is the forbidden drift.

This is enforced by a CI check that is a **sibling of `registry-lint`** — `checkHardenedAgreement` in `src/governance/hardened-agreement.js`: given the emitted `managed/<name>.settings.json` and the governance context (profile + org/client/project layers + `requiredTools`), it proves the projection cannot **allow anything the resolver denies** (nor ask-downgrade). Pure + model-independent, it runs in engine CI over engine data — no client data in the loop (clean-room boundary held). Because the managed projection is built from `requiredTools` alone (a *clamp*, not an affirmative grant — see Layer 4), a deployment whose org/client/project layers do **not** grant a projected tool will see this check flag the divergence: the managed `allow` would be looser than the resolver's deny. That is the GOV-04 drift made visible at build time rather than discovered as a contradiction at run time.

---

## CI gates

Governance config is itself checked, so misconfiguration fails before runtime (`docs/security.md`):

- **`registry-lint`** ([skill-manifest-and-registry.md](skill-manifest-and-registry.md)) — every `requiredTools` entry is within the org allow-list; no client override broadens scope or adds a tool.
- **`secret-scan`** ([security.md](security.md)) — runs both in CI (working tree/diff) **and** at runtime in the `PreToolUse` hook (per-call); no credential-shaped string reaches repo, telemetry, artifact, or prompt.

Both surface PASS/FAIL on the [telemetry dashboard](telemetry.md).

---

## Takeaways

- **`allowed-tools` is pre-approval, never a boundary** (OD-3) — experimental, runtime-variable, SDK-divergent. The resolver decides.
- The **policy resolver** maps `(profile, skill, client, project, tool) → allow|ask|deny`, **deny-first** and **model-independent**, composing profile (Layer 0) → org → client → project → skill via the **`deny > ask > allow` lattice** (meet `⊓`; `ask` is sticky; layer-4 is a clamp; silence = `deny`). Tool patterns subsume `literal ⊂ prefix-* ⊂ *`, making `registry-lint`'s broaden-check computable (GOV-01, GOV-05).
- **Layer 0 = deployment profile** (GOV-02): under the compliance profile, server-side tools are denied as a pre-filter before any other layer — residency enforced at the same `PreToolUse` seam as tool scope, via the profile-evaluator shared with the loader (ARCH-03).
- **Hooks are the enforcement seam:** `PreToolUse` gates each call (and hosts `secret-scan`), `PostToolUse` feeds telemetry, prompt-expansion gates skill firing. Hooks extend, never weaken, deny rules.
- **OD-2:** base = open resolver + `PreToolUse` (required, vendor-neutral); **Claude managed settings = optional hardened tier** that makes the boundary unbypassable.
- Scope is per **client *and* project** (project-first), the same spine as the secret model.

---

## Related documents

- Where tool/secret *needs* are declared as data (the registry): [`skill-manifest-and-registry.md`](skill-manifest-and-registry.md)
- The secret model this mirrors, and the `secret-scan` hosted on `PreToolUse`: [`security.md`](security.md)
- What a skill is (generic; tool needs are part of the recipe): [`skills-and-commands.md`](skills-and-commands.md)
- How skills load per client, the `clients_dir` boundary the resolver reads, and the **profile-evaluator** that Layer 0 shares with the loader: [`loader-and-activation.md`](loader-and-activation.md)
- The feature × profile **contract table** that Layer 0 reads (single source of truth): [`deployment-profiles.md`](deployment-profiles.md)
- The CI gates (`registry-lint`, `secret-scan`): `docs/security.md`
- Why telemetry must stay secret-free: [`telemetry.md`](telemetry.md)
