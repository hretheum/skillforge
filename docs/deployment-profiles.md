# Deployment profiles

---

## Why two profiles instead of one knob

Two needs pull in opposite directions:

- A client in a **regulated industry** needs a hard promise: *our prompts and outputs never
  leave the EU, and nobody retains them.* That promise is only true if the engine avoids every
  feature that would route data through, or store data on, infrastructure that breaks it.
- A client who just wants the engine to be **convenient** wants the full platform: server-side
  Agent Skills, the Files API, batch processing — features that make the engine do more, faster,
  with less local plumbing.

You cannot serve both with one configuration, because the convenience features are *exactly* the
ones that void the compliance promise. So skillforge names the two postures explicitly and makes
the choice **structural**: a deployment is either profile **A** or profile **B**, and the loader
treats a request that mixes them as an error — loudly, not silently (see "the loader enforces the
profile" below, and [`06`](loader-and-activation.md)).

---

## Profile A — "compliance / client-side"

**Promise:** EU data residency + zero data retention (ZDR), with no Anthropic Enterprise
contract. The model is reached through **Amazon Bedrock pinned to an EU regional endpoint**
(e.g. Frankfurt `eu-central-1`), or — for the priced model **Sonnet 4.6** — the **EU geo inference
profile `eu.anthropic.claude-sonnet-4-6`** (all source/destination regions inside the EU) or
**London `eu-west-2` In-Region**. Why this delivers the promise — ZDR/ZOA are Bedrock's default
for Claude (as of 2026-06-05, monitored), AWS is the sole data processor, no training on customer
data — is documented in [`compliance-and-cost.md`](compliance-and-cost.md).

**The cost of the promise:** the Bedrock-native integration deliberately does **not** offer the
platform's server-side conveniences. Under profile A:

- **Skills run client-side.** A skill is executed by the engine/agent process, not by a
  server-side sandbox. The model is used purely as a Messages-API reasoning engine.
- **The Files API is FORBIDDEN.** Uploading files to a server-side store is not available on
  Bedrock and would, by definition, place client content outside the residency boundary. The
  loader rejects any attempt to use it under profile A.
- **No server-side Agent Skills, no code-execution sandbox, no batch-via-platform.** These are
  not available on Bedrock-native and are blocked under profile A.

**What still works:** the Messages API, prompt caching, extended thinking, **client-side** tool
use, citations, and structured outputs. That is enough to run the engine's core skills as
client-side recipes (see [`05`](skills-and-commands.md)).

---

## Profile B — "convenience / server-side"

**Promise:** maximum capability and least local plumbing, reached through the **first-party
Claude API** (Anthropic-operated). Under profile B the engine may use:

- **Server-side Agent Skills** — skills executed in Anthropic's managed runtime.
- **The Files API** — upload and reference files across requests.
- **Batch processing** — asynchronous bulk jobs at a discount.
- **Server-side tools** (code execution, web search/fetch) where a skill needs them.

**The cost of the convenience:** profile B makes **no EU-residency and no ZDR guarantee** by
default. Data is processed by Anthropic as an independent data processor; routing may leave the
EU; retention follows the first-party model (ZDR only on request). Profile B is therefore **not**
a vehicle for a hard-compliance client — it is the posture for clients who prioritize features
over a residency/retention promise.

---

## Feature × profile — the contract table

This table is the single source of truth for what is allowed under each profile. The loader
enforces it (next section).

| Feature / capability | Profile A — compliance / client-side | Profile B — convenience / server-side |
|---|:---:|:---:|
| Reaches the model via | **Bedrock, EU regional endpoint** | **first-party Claude API** |
| EU data residency guarantee | ✅ yes (regional endpoint) | ❌ no (global by default) |
| Zero data retention (ZDR) | ✅ default for Claude, no request *(as of 2026-06-05, subject to AWS abuse-detection policy — monitored, see [`15`](compliance-and-cost.md) §"Monitoring the ZDR basis")* | ❌ on request only |
| Sole data processor | AWS (not Anthropic) | Anthropic |
| Messages API | ✅ | ✅ |
| Prompt caching | ✅ | ✅ |
| Extended thinking | ✅ | ✅ |
| Client-side tool use | ✅ | ✅ |
| Citations / structured outputs | ✅ | ✅ |
| Skills execution | **client-side only** | client-side **or** server-side |
| Server-side Agent Skills | ❌ **forbidden** | ✅ |
| Files API | ❌ **forbidden** | ✅ |
| Batch processing | ❌ **forbidden** | ✅ |
| Server-side tools (code exec, web search/fetch) | ❌ **forbidden** | ✅ |

Feature availability per platform is drawn from the public Anthropic docs as collected in
the public sources cited in-document §1.5.

---

## Enforcement: the profile-evaluator (this table is the only copy)

A profile is only a real guarantee if the engine **cannot** quietly do the forbidden thing. The
table above is **the single source of truth**; enforcement reads it through one component — the
**profile-evaluator** — and **no other document re-prints these rows.**

The profile-evaluator is a small, data-driven, model-independent function `(profile, feature) →
allow | deny` over the table above — the **sibling of the tool policy resolver** in
[`tool-governance.md`](tool-governance.md). It is defined and owned operationally by the
loader doc ([`loader-and-activation.md`](loader-and-activation.md) §"the profile-evaluator"),
which keeps *policy* (this legality decision) separate from *wiring* (resolving clients/adapters) —
the SRP factoring the audit asked for. It has **two call sites**, one decision logic:

1. **The loader, at startup** ([`06`](loader-and-activation.md)) — for **feature** legality
   (Files API, server-side Agent Skills, batch). It treats the profile as part of the validated
   client context and **rejects an illegal combination before any skill runs**, the same
   "validate before acting, fail loud and early" discipline it applies to missing adapters and
   unresolved references. The loader's error table in [`06`](loader-and-activation.md)
   *illustrates* the evaluator's `deny` verdicts; it is not a second copy of this contract.
2. **The tool resolver, per call** ([`13`](tool-governance.md) §"Layer 0") — as **Layer 0**,
   the highest-priority deny pre-filter, so a profile-A **server-side tool** is denied at the same
   `PreToolUse` seam as every other tool decision (closing the residency↔governance seam, GOV-02).

The error must name *which* feature and *why* (the compliance boundary), so the operator can
either switch the deployment to profile B knowingly, or pick a client-side path for the skill —
never discover the leak after the fact. The profile check is one more link in the loader's chain
**client → config → adapters → references → profile** that is validated up front — but the
*rules* of that check live here, in the table, read by the shared evaluator.

> **Why this is structural, not advisory.** If the rule lived only in documentation, a
> convenience feature could slip into a compliance deployment and silently void the residency/ZDR
> promise — the worst possible failure, because it is invisible until an audit. Putting the check
> in the loader makes the promise enforceable: a compliance deployment that *tries* to use a
> forbidden feature does not produce wrong-but-quiet output; it stops.

---

## Choosing a profile

- Pick **profile A** when the client has a residency/retention mandate (GDPR-sensitive data, a
  regulated sector, a contractual ZDR clause). Accept that skills must be authored to run
  client-side and that the Files API / batch / server-side skills are off the table.
- Pick **profile B** when there is no hard residency/retention requirement and the client wants
  the full server-side feature set.

The profile is set in the client config and resolved by the loader. For the residency facts,
the no-Enterprise path, and the per-month cost model that makes profile A quotable to a client,
continue to [`compliance-and-cost.md`](compliance-and-cost.md).

---

## Sources

- the public sources cited in-document — the clean-room research this
  document builds on (Bedrock EU residency + ZDR-by-default for Claude; feature gaps of the
  Bedrock-native integration; Vertex EU as second-source). It in turn cites only public
  Anthropic, AWS, and Google Cloud documentation, fetched 2026-06-05.
- Concept + first principles; zero third-party `skills-factory` code (clean-room — see
  `CLAUDE.md`).
