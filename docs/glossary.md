# Glossary

---

## Core concepts

**skillforge** — the whole project: a **skill factory**. A machine that, from one generic engine and a
description of a specific client, produces ready-made skills. The first client is the author's own brand,
the example client. See [`vision-and-problem.md`](vision-and-problem.md).

**engine** (core) — the generic part of the project, the same for every client. It knows nothing about
any specific client; it receives all client knowledge from the outside (from the client's config and
adapters). See [`architecture-overview.md`](architecture-overview.md).

**skill** — a named, reusable **agent capability** (e.g. "create a component consistent with the client's
design system"). It is composed of generic parts (engine logic) plus client knowledge brought in by the
config and adapters — by itself it contains no knowledge of any specific client. See
[`skills-and-commands.md`](skills-and-commands.md).

**command** — an explicit invocation of a skill by the user (skill = capability, command = the deliberate
act of running that capability). See [`skills-and-commands.md`](skills-and-commands.md).

---

## Adapters

**adapter** — a swappable plugin at the edge of the engine that translates between the outside world and
the generic interior. The engine does not know specific formats; the adapters understand them. See
[`adapters.md`](adapters.md).

**input adapter** (input) — an adapter that **reads any kind of client source material** and returns a
normalized description the engine can understand. The source can be a design system (tokens, components),
a Jira project, Confluence/Notion pages, PDF/DOCX/Markdown documents, a Redmine tracker, or anything else —
an open catalog. Generic with respect to the *kind and format* of source.

**output adapter** (output) — an adapter that **takes the result of a skill and turns it into a concrete
SDLC artifact** in the target form. The artifact can be a front-end component (React, Web Components, a CMS
template), but equally backend code, tests, an API spec (OpenAPI), infrastructure-as-code / configuration,
documentation, a diagram, a tracker ticket, or a DB migration — an open catalog. Generic with respect to
the *kind* of artifact. (Symmetric counterpart of the input adapter.)

**artifact** — the concrete, finished product of a skill after it has passed through the output adapter:
any SDLC artifact (e.g. a component file, a test suite, an OpenAPI document, an IaC module).

---

## The normalized form (the core's only language)

**normalized form** — the single, named, **versioned** data contract the engine speaks internally: input
adapters produce it, output adapters consume it, and the core never sees raw client formats. Defined as a
contract (not by example) so determinism and genericity can be *proven*. See
[`normalized-form.md`](normalized-form.md).

**envelope** — the shared, kind-agnostic wrapper every normalized value carries: source-kind / result-kind,
identity, a content-hash, and the form's version. The stable part that lets the core route, cache, and
diagnose without knowing the payload's kind. See [`normalized-form.md`](normalized-form.md).

**source-kind** — the tag on an *incoming* normalized description that says what kind of source it came from
(design system, tracker, document, …); paired with the input adapter that produces it. See
[`normalized-form.md`](normalized-form.md).

**result-kind** — the tag on an *outgoing* normalized result that says what kind of artifact intent it is
(component, OpenAPI, ticket, …). A skill declares the result-kind it emits; an output adapter declares which
kinds it accepts; the normalized result is a **tagged union** over the shared envelope, keyed by this tag.
See [`normalized-form.md`](normalized-form.md) and [`adapters.md`](adapters.md).

**runtime-failure contract** — the rules every adapter call obeys when a *live* external system fails
mid-run (not just at startup): a bounded **timeout**, three failure classes (transient → retry-with-backoff,
auth → fail-fast with a rotation hint, permanent → stop), and **idempotent-or-transactional** output writes
(write-temp-then-commit) so a half-written artifact never leaks. See [`adapters.md`](adapters.md).

---

## Client and its data

**client** — the entity for which the engine produces skills (a brand, a team, a project). In skillforge
every client is **data only** — a description, not code. See [`client-model.md`](client-model.md).

**client model** — the agreed shape of a client's description: which fields its config has and how it
points to its resources. See [`client-model.md`](client-model.md).

**config** (client configuration) — a file describing a single client: its identity, which input and
output adapter to use, and references to its resources. **Zero logic** — data only.

**reference** — a pointer in the config to a client resource (e.g. a path to a tokens file or the address
of a design system source). The config **points** to resources rather than pasting their contents.

**`clients_dir`** — the directory holding client configs, which may live **outside the engine repo tree**
(the engine is given a path to it). This keeps client data and engine code physically separated (important
for the clean-room). See [`loader-and-activation.md`](loader-and-activation.md).

---

## Loader and activation

**loader** — the part of the engine that **finds and loads** the selected client (from `clients_dir`) and
assembles the set of skills available to that client. See [`loader-and-activation.md`](loader-and-activation.md).

**activation** — the moment a skill "comes into play" for a given client: the conditions for its trigger
are met and it becomes available for use. See [`loader-and-activation.md`](loader-and-activation.md).

---

## Telemetry and observability

**telemetry** — the signals a running system emits about itself (counters, measurements, events) so its
behavior can be watched from the outside. The raw material of observability. See
[`telemetry.md`](telemetry.md).

**observability** — the property of being able to answer questions about a system's behavior from the data
it already emits, without attaching a debugger. See [`telemetry.md`](telemetry.md).

**OpenTelemetry** (OTEL) — an open, vendor-neutral standard for *how* a program emits telemetry, so any
compatible tool can collect it. Claude Code (which drives skillforge) speaks OTEL natively.

**OTLP** — the **OpenTelemetry Protocol**: the wire format OTEL uses to ship signals from the program to a
collector. OTEL is the language; OTLP is the envelope.

**metric** — a numeric signal tracked over time (a *time series*), e.g. "tokens used per minute". Compact and
ideal for trends; stored in Prometheus.

**Prometheus** — a database specialized for storing and querying **metrics** (time series). See
[`telemetry.md`](telemetry.md).

**Loki** — a database specialized for storing and querying **logs/events** (structured per-occurrence
records). See [`telemetry.md`](telemetry.md).

**Grafana** — the **dashboard**: a single screen that reads from Prometheus and Loki and draws the charts and
tables a human reads — where the factory's activity, cost, and **guardrail PASS/FAIL trend** become visible.
See [`telemetry.md`](telemetry.md).

---

## Security and secrets

**secret** — a credential an adapter needs to reach an external system (an API token, an OAuth client
secret, a service-account key, a password). See [`security.md`](security.md).

**secret reference** — a stable **name/path** in the config that says *which* secret is needed and *where to
find it*, **without containing the value** (e.g. `client/project/adapter/secret-name`). The config holds
references; values live in a secret backend and are resolved at runtime. See
[`security.md`](security.md).

**secret backend** — the pluggable, vendor-neutral store that turns a secret reference into a value at
runtime: environment variables, a gitignored `.env` file, an OS keychain, HashiCorp Vault, or a cloud secret
manager (AWS/GCP/Azure). The reference is the stable seam; the backend behind it is swappable, and works
without Claude. See [`security.md`](security.md).

**per-project scope** — the default granularity for a secret: a credential bound to **one specific project of
one client** (a client has many projects; an integration is usually enabled for one of them), further
narrowed to the **adapter** that uses it — `(client, project, adapter)`. Smaller scope = smaller blast
radius. See [`security.md`](security.md).

**least privilege** — granting each credential the **narrowest** access that lets its adapter do its job
(read-only where reading suffices, one project rather than a whole instance, only the permissions actually
used), so the cost of any single compromise stays small. See [`security.md`](security.md).

**secret-scan** — a guardrail that scans for credential-shaped strings and **fails** if any are found. It
runs both in CI (working tree / diff) and at runtime inside the `PreToolUse` hook (per tool call), so no
secret value reaches the repo, telemetry, an artifact, or a prompt. It is **defense-in-depth** — a backstop
behind the real primary control (references-not-values), since regex/entropy detection has known
false-negative classes. See [`security.md`](security.md) and
[`tool-governance.md`](tool-governance.md).

**inbound threat** — the threat plane of untrusted client *content entering* the model (the dual of the
outbound secret-leak plane): source material the input adapter returns (a Jira ticket, a Confluence page, a
PDF) is **untrusted data, never instructions**, because the engine cannot tell a genuine spec from a planted
directive. See [`security.md`](security.md) and [`adapters.md`](adapters.md).

**prompt injection** — the concrete inbound attack in which planted text inside otherwise-legitimate source
content tries to act as a tier-1 instruction (e.g. "ignore your rules and …"). Mitigated by treating input as
untrusted and by content/instruction **isolation** (fenced, labelled source content never concatenated into
the instruction stream). See [`security.md`](security.md).

**STRIDE** — the threat-modeling checklist (Spoofing, Tampering, Repudiation, Information disclosure, Denial
of service, Elevation of privilege); the spec runs a one-page STRIDE pass over its four data flows to surface
the inbound plane systematically. See [`security.md`](security.md).

---

## Skill manifest and governance

**skill manifest** — the per-skill, machine-readable description of a skill: the `SKILL.md` frontmatter
(the open standard) carrying its identity and metadata. The manifest *declares* what a skill is and what it
needs; enforcement lives elsewhere (the registry + the policy resolver). See
[`skill-manifest-and-registry.md`](skill-manifest-and-registry.md).

**`SKILL.md`** — the entry file of a skill: a folder whose `SKILL.md` holds YAML frontmatter (required
`name` + `description`, optional `license`/`compatibility`/`metadata`/`allowed-tools`) followed by a
Markdown body, with optional `scripts/`, `references/`, `assets/`. The portable, vendor-neutral unit of a
skill. See [`skill-manifest-and-registry.md`](skill-manifest-and-registry.md).

**Agent Skills (open standard)** — the published, multi-vendor specification at
[agentskills.io](https://agentskills.io) that defines the `SKILL.md` format; skillforge adopts it so its
skills are portable and **not** Claude-locked. See [`skill-manifest-and-registry.md`](skill-manifest-and-registry.md).

**`skills-ref`** — the open standard's reference validator (`skills-ref validate ./my-skill`): checks that a
`SKILL.md` frontmatter is well-formed and correctly named. skillforge runs it as a CI gate. See
[`skill-manifest-and-registry.md`](skill-manifest-and-registry.md).

**`metadata.skillforge.*`** — the namespaced key under which skillforge stores its own per-skill properties
inside the open `metadata` map (e.g. `metadata.skillforge.owner`), so extensions ride along without breaking
portability. See [`skill-manifest-and-registry.md`](skill-manifest-and-registry.md).

**skill registry** (`skillforge.registry.json`) — the vendor-neutral catalog that records the *governance*
facts about every skill in one machine-readable place: version, enabled state, required tools, required
adapters, required secret references, and per-client/per-project scope. The generic registry lives in the
engine repo; per-client overrides live as data in `clients_dir`. See
[`skill-manifest-and-registry.md`](skill-manifest-and-registry.md).

**registry-lint** — a guardrail (sibling of `skills-ref` and `secret-scan`) that fails CI when the registry
is internally inconsistent (an unknown adapter, an undeclared secret, an out-of-scope tool, or drift from a
skill's `SKILL.md`). Plain JSON checks, no model in the loop. See
[`skill-manifest-and-registry.md`](skill-manifest-and-registry.md).

**policy resolver** — the vendor-neutral, model-independent decision function at the heart of tool
governance: given `(profile, skill, client, project, tool)` it returns **allow / ask / deny** (deny-first,
composed from the deployment profile (Layer 0) → org → client → project → the registry's required tools).
It is the *authoritative* boundary —
the manifest only *requests* tools, the resolver *decides*. See [`tool-governance.md`](tool-governance.md).

**decision algebra** — the precise, written-down composition rule the policy resolver uses to combine the
per-layer decisions, so two correct-looking implementations cannot disagree. The three values form a
**lattice** ordered `deny > ask > allow`; layers combine with the **meet** (`⊓`, "take the stricter") which
is associative and commutative, so the fold is order-independent. **ask-sticky**: once any layer says `ask`,
no lower-priority `allow` can silence it (only a `deny` can override). See
[`tool-governance.md`](tool-governance.md).

**deployment-profile deny floor** (Layer 0) — the deployment profile as the **highest-priority, pre-filter**
deny source in the resolver: under the compliance profile every server-side tool is denied *before any other
layer is consulted*, and nothing below can re-allow it. This wires residency enforcement (`14`) into the same
`PreToolUse` seam as tool scope, closing the residency↔governance seam. See
[`tool-governance.md`](tool-governance.md) and [`deployment-profiles.md`](deployment-profiles.md).

**profile-evaluator** — the small, data-driven, model-independent function `(profile, feature) → allow|deny`
factored *out of the loader* (single responsibility): the one component that decides whether a feature is
permitted under the active deployment profile. The loader and the resolver's Layer 0 both *call* it rather
than re-implementing the profile table. See [`loader-and-activation.md`](loader-and-activation.md).

**`allowed-tools`** — the open-standard frontmatter field that **pre-approves** tools (skip the prompt)
while a skill is active. It **grants, it does not restrict** — so it is convenience/UX, **never a security
boundary**; the policy resolver is the boundary. See [`tool-governance.md`](tool-governance.md).

**hook** — a deterministic extension point that intercepts a tool call or lifecycle event and returns a
decision. skillforge uses **`PreToolUse`** (fires before a tool runs — the per-call enforcement seam that
calls the policy resolver and hosts `secret-scan`), **`PostToolUse`** (after a tool runs — feeds
telemetry/audit), and prompt-expansion (gates skill firing). Hooks *extend*, never weaken, deny rules. See
[`tool-governance.md`](tool-governance.md).

**hardened tier** — an *optional* extra enforcement layer for Claude Code deployments (managed permission
settings that user/project configs cannot loosen). The policy resolver + `PreToolUse` hook are the required
baseline that works on any runtime; the hardened tier is a Claude-flavour bonus. See
[`tool-governance.md`](tool-governance.md).

---

## Deployment, compliance, and cost

**deployment profile** — the *posture* under which skillforge runs for a client, decided once (not per
call). There are two, and the loader refuses to mix the features that distinguish them:
[`deployment-profiles.md`](deployment-profiles.md).

**compliance / client-side profile** (profile A) — the posture that can make a compliance promise (EU data
residency + zero data retention): skills execute client-side and the server-side conveniences that would
void the promise (server-side Agent Skills, Files API, batch) are forbidden. See
[`deployment-profiles.md`](deployment-profiles.md).

**convenience / server-side profile** (profile B) — the posture that trades the compliance promise for the
full server-side platform (server-side skills, Files API, batch). See [`deployment-profiles.md`](deployment-profiles.md).

**data residency** — the guarantee that inference runs (and data stays) in a chosen geography, e.g. the EU.
Reached via a cloud *regional* endpoint pinned to an EU region. See [`compliance-and-cost.md`](compliance-and-cost.md).

**ZDR** (zero data retention) — a data-security model in which the service, **by default, does not store**
model inputs or outputs. On Amazon Bedrock this is the default for Claude with no Enterprise contract. See
[`compliance-and-cost.md`](compliance-and-cost.md).

**ZOA** (zero operator access) — a complementary model in which no operator of the service can access model
input or output. See [`compliance-and-cost.md`](compliance-and-cost.md).

**Bedrock** (Amazon Bedrock) — the AWS service through which skillforge can run Claude inside the AWS
security boundary; an EU *regional* endpoint gives EU residency + ZDR-by-default without an Anthropic
Enterprise contract. It is the recommended backend for the compliance profile. See
[`compliance-and-cost.md`](compliance-and-cost.md).

**prompt caching** — reusing an identical, stable **prefix** of a prompt across runs so later calls pay a
fraction of the price and start faster — the factory's single biggest cost lever. It requires byte-stable
prefixes, which is why input-adapter determinism is also a cost rule. See
[`architecture-overview.md`](architecture-overview.md) and [`compliance-and-cost.md`](compliance-and-cost.md).

**stability tiers** — the layering of a prompt from most-stable to most-variable (engine/skill prefix →
client normalized description → the specific request), never interleaved. The core emits these tiers; a
caching backend maps them onto cache breakpoints. See [`architecture-overview.md`](architecture-overview.md).

**cache-hit ratio** — the share of input tokens served from cache rather than charged at full price; a
first-class telemetry KPI proving the factory is cost-efficient per client/skill. See
[`telemetry.md`](telemetry.md) and [`compliance-and-cost.md`](compliance-and-cost.md).

**cache-hit determinism owner** — the source of a byte-instability that drops the cache-hit ratio. There are
**two** owners, because the cacheable prefix has two tiers: **tier-1** (the core's rendered engine/skill
text) and **tier-2** (the input adapter's normalized description). A drop can come from either, so the panel
annotation names both and a distinguishing signal (a **tier-1 prefix hash** vs a **tier-2 content hash**)
tells them apart — never mis-attributing a core regression to the adapter. See
[`telemetry.md`](telemetry.md).

---

## Verification

**verification gate** — a CI check that *proves* a spec contract holds rather than asserting it, run beside
`skills-ref` / `registry-lint` / `secret-scan`. The two are the **determinism gate** and the **genericity
proof**. See [`normalized-form.md`](normalized-form.md).

**determinism gate** — the verification gate that re-generates the normalized description for a golden input
fixture and **byte-diffs** it against the stored golden; any drift fails CI. It is what makes the
prompt-caching cost lever (byte-stable prefixes) enforceable rather than hoped-for. See
[`normalized-form.md`](normalized-form.md).

**genericity proof** — the runnable verification artifact that runs **one skill through two output adapters**
and shows the same intent emerges in two forms **with zero engine-code changes** between the runs — mechanizing
the "engine is generic" claim instead of arguing it. See [`normalized-form.md`](normalized-form.md).

---

## Provenance and clean-room

**clean-room** — a way of working in which the engine is built **from scratch, from the concept alone**,
without carrying over anyone else's code — which is what keeps it an independent work. See
`docs/security.md` and `CLAUDE.md`.

**membrane** (one-way) — the clean-room rule: **the concept may cross** into the project (ideas, patterns,
"how it should work"), **the code never** (files, contents, implementations). See `CLAUDE.md`.

**guardrail** — a concrete, usually automated gate protecting provenance (e.g. no paths to a foreign repo,
private commit authorship), with a binary PASS/FAIL outcome. The full set is kept local-only (in
`private/`, not in the remote).

**Track A / Track B** — the two separated sides of the work: **Track A** is the existing, external source
of inspiration (read-only in the sense of ideas, untouchable in the sense of code), **Track B** is
skillforge — only your own code, written from scratch. The membrane lets the concept pass A→B; the code,
never. See `CLAUDE.md`. (The detailed guardrails are kept local-only,
in `private/`, not in the remote.)
