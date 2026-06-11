# Compliance and cost

> **How a hard-compliance client gets EU data residency + zero data retention without an
> Anthropic Enterprise contract, and what running the engine costs per month.** This document
> backs the **compliance profile** (profile A) from [`deployment-profiles.md`](deployment-profiles.md)
> with the residency/retention facts that make its promise true, names the runner-up EU path, and
> gives a reproducible per-month cost model an operator can quote to a client.
>
> **As-of date for all pricing: 2026-06-05.** Prices change — re-confirm before quoting a client.

---

## The compliance promise, without Enterprise

Anthropic **Enterprise is out of scope** (out of budget). The path below reaches EU residency +
zero data retention (ZDR) **without** any Enterprise agreement — it is governed by the AWS
customer agreement, not by an Anthropic contract.

**Recommended: Claude via Amazon Bedrock, pinned to an EU regional endpoint** (e.g. Frankfurt
`eu-central-1`; other `eu-*` regions — Ireland, Zurich, Paris, Stockholm, Milan, Spain, London —
are also available). Four facts make this a real compliance promise:

1. **EU data residency.** A Bedrock *regional* endpoint resolves to the single AWS region you
   specify and routes inference there; for EU-wide high availability use an **EU geo inference
   profile**, whose source *and* destination regions are all inside the EU. (The cheaper *global*
   endpoint is **not** residency-safe — it may route outside the EU.) The regional endpoint
   carries a flat **+10%** over global.
   ([Claude in Amazon Bedrock → Regions](https://platform.claude.com/docs/en/build-with-claude/claude-in-amazon-bedrock#regions), 2026-06-05.)

   > **For the priced model (Sonnet 4.6) specifically:** EU residency is delivered by the **EU geo
   > inference profile `eu.anthropic.claude-sonnet-4-6`** (source/destination all EU: Frankfurt,
   > Stockholm, Milan, Spain, Ireland, Paris — with Zurich and London as additional source
   > regions), or by **London `eu-west-2` In-Region** for a single-region mandate. Prompt caching
   > (5-min + 1-hour TTL, min 1,024 tokens) is supported on this model on Bedrock, so the cost
   > model's "caching on" assumption holds. The invariant that matters: **the priced model must
   > appear in the platform's available-model list for the active profile** — verified for Sonnet
   > 4.6 against the AWS model card (`anthropic.claude-sonnet-4-6`, lifecycle Active, launch
   > 2026-02-17).
   > ([AWS — Claude Sonnet 4.6 model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-4-6.html), fetched 2026-06-05.)
2. **ZDR by default for Claude — no request, no Enterprise (as of 2026-06-05, subject to AWS
   policy change).** AWS: *"Amazon Bedrock uses a zero operator access (ZOA) data security
   model... Also, Amazon Bedrock uses a zero data retention (ZDR) data security model. This means
   that by default, Amazon Bedrock does not store model inputs or outputs."* The **only**
   documented abuse-detection retention exception **as of 2026-06-05** names the **GPT-5.x models —
   not Claude**, so for Claude on Bedrock ZDR is the default with no special request. **This claim
   rests on a single, mutable third-party page; it is monitored, not assumed** (see "Monitoring the
   ZDR basis" below).
   ([Amazon Bedrock abuse detection](https://docs.aws.amazon.com/bedrock/latest/userguide/abuse-detection.html), 2026-06-05.)
3. **Anthropic never sees the data; AWS is the sole processor.** *"Anthropic personnel have no
   access to the inference infrastructure"*; model providers *"don't have access to Amazon Bedrock
   logs or to customer prompts and completions."*
   ([Claude in Amazon Bedrock](https://platform.claude.com/docs/en/build-with-claude/claude-in-amazon-bedrock); [Bedrock data protection](https://docs.aws.amazon.com/bedrock/latest/userguide/data-protection.html), 2026-06-05.)
4. **No training on customer data.** The Bedrock design (model deep-copied into an AWS-owned
   deployment account, no provider access) and AWS's data-privacy posture mean customer
   prompts/completions are not used to train the model.
   ([Bedrock data protection](https://docs.aws.amazon.com/bedrock/latest/userguide/data-protection.html); [AWS GDPR Center](https://aws.amazon.com/compliance/gdpr-center/), 2026-06-05.)

Anthropic's own docs steer regulated customers here: organizations that *"need AWS to be the sole
data processor, should use Claude in Amazon Bedrock."*
([Claude Platform on AWS](https://platform.claude.com/docs/en/build-with-claude/claude-platform-on-aws), 2026-06-05.)

> **The trade-off** (detailed in [`14`](deployment-profiles.md)): the Bedrock-native
> integration does **not** offer server-side Agent Skills, the Files API, batch-via-platform, or
> server-side tools. The compliance profile therefore runs skills **client-side** and the loader
> **forbids** those features (see [`06`](loader-and-activation.md), [`14`](deployment-profiles.md)).

### Monitoring the ZDR basis (not just re-reading at onboarding)

The ZDR-by-default promise (fact 2) is sold to **regulated** clients as a hard guarantee, yet its
truth rests entirely on one **mutable third-party page** — the Bedrock abuse-detection page — that
can change between onboarding and the next audit. That gap (onboarding → silent policy change →
audit) is exactly the window where a regulated client is exposed, so the control cannot be a manual
"re-read at onboarding." Make the promise **monitored, not hoped**:

- **Scheduled re-check.** A periodic automated fetch of the
  [Bedrock abuse-detection page](https://docs.aws.amazon.com/bedrock/latest/userguide/abuse-detection.html)
  (and the model card's EU-available list) that diffs the retention-exception list and **alerts** if
  Claude (or `anthropic.*`) ever appears, or if the GPT-5.x-only scope changes. This catches a
  mid-contract change the same week it lands, not at the next audit. (Cheap to run alongside the
  telemetry stack already costed below.) **This is a CHECK, not a human re-reading the page:** the
  posture is asserted by `tools/residency-check.js` (`npm run gate:residency`, also part of `npm run
  gates`), which evaluates BACKEND EVIDENCE — the EU-available model list and the retention-exception
  list — against the asserted profile-A posture in `src/governance/residency-posture.js`
  (invariants R1 endpoint EU-regional / R2 active model EU-available / R3 active model not on the
  retention-exception list / R4 the exception list has not widened beyond the GPT-5.x scope). It runs
  by default over a committed evidence snapshot (deterministic, offline) and over a **live fetch**
  (`--evidence <fresh.json>`) for the scheduled re-check; a divergence — or missing/malformed
  evidence — is **fail-closed** (the promise is not proven → the check fails). If the backend changes
  deliberately and is re-confirmed, refresh the snapshot **and** the asserted scope/as-of in
  `src/governance/residency-posture.js` in one reviewed change.
- **Contractual backstop.** The **GDPR DPA with AWS** ("Before quoting" pt.4) is the durable,
  audit-defensible basis: a ZDR/no-retention clause in the signed agreement does not change when a
  doc page does. Prefer the contract clause as the *primary* basis for a hard-compliance client and
  treat the abuse-detection page as corroboration.
- **As-of-date language everywhere.** Every restatement of the claim carries "**as of 2026-06-05,
  subject to AWS's abuse-detection policy**" — including the profile-A table in
  [`14`](deployment-profiles.md), which is marked ✅ with that caveat rather than as an
  unqualified default. The honest caveat is kept; what is added is a *mechanism* behind it.

---

## Runner-up EU path: Google Vertex AI (second-source)

Claude on **Vertex AI** via an EU multi-region (`region="eu"`) or single-region (`europe-west3`,
Frankfurt) endpoint gives **equivalent residency** and the same **no-training** commitment
(*"Google won't use your data to train or fine-tune any AI/ML models without your prior
permission or instruction"*), at the same **+10%** regional premium.

The difference that matters: on Vertex, **ZDR is not the default** — you must opt out of
abuse-monitoring prompt logging (request an exception) and disable a default 24h in-memory cache.
More setup to reach the same place. Treat Vertex as a **second-source / failover**, or the first
choice only if the client is already a GCP shop.
([Claude on Vertex AI](https://platform.claude.com/docs/en/build-with-claude/claude-on-vertex-ai); [Vertex AI data governance](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/data-governance), 2026-06-05.)

*(Microsoft Foundry: Claude-on-Azure-EU residency was still maturing as of mid-2026 — not a first
choice for an EU mandate; revisit if a client is Azure-locked.)*

---

## Cost model — per-month $

All cost figures below are for the **compliance profile**: **Bedrock EU regional endpoint
(list × 1.10), Claude Sonnet 4.6, prompt caching on, as-of 2026-06-05.** Bedrock uses the
first-party list price; the regional endpoint adds a flat 10% to every token category.
([Anthropic pricing → cloud platform pricing](https://platform.claude.com/docs/en/about-claude/pricing#cloud-platform-pricing), 2026-06-05.)

### Price inputs (per 1M tokens, list / global; ×1.10 for EU regional)

| Model | Input | Output | 5-min cache write (1.25×) | Cache read/hit (0.1×) |
|---|---|---|---|---|
| Claude Opus 4.8 | $5.00 | $25.00 | $6.25 | $0.50 |
| Claude Sonnet 4.6 | $3.00 | $15.00 | $3.75 | $0.30 |
| Claude Haiku 4.5 | $1.00 | $5.00 | $1.25 | $0.10 |

([Anthropic pricing → model pricing / prompt caching](https://platform.claude.com/docs/en/about-claude/pricing#model-pricing), 2026-06-05. Batch API = 50% off input+output, where available — **not** available under the compliance profile, see [`14`](deployment-profiles.md).)

### Volume assumptions (stated explicitly — replace with telemetry)

A **generation** = one skill-assisted Claude turn. Two workload profiles and three monthly
volumes; these are reproducible placeholders, not measured numbers:

| Profile | Input tokens/gen | Cached share | Output tokens/gen |
|---|---|---|---|
| **A — light skill turn** | 6,000 | 70% | 1,500 |
| **B — typical agentic turn** | 20,000 | 80% | 4,000 |

| Volume | Generations/month |
|---|---|
| LOW | 5,000 |
| MED | 50,000 |
| HIGH | 300,000 |

### Monthly total — model spend (Bedrock EU regional, Sonnet 4.6, caching on)

| Workload profile \ volume | LOW (5k gen) | MED (50k gen) | HIGH (300k gen) |
|---|---|---|---|
| **Profile A — light skill turn** | **$161** | **$1,605** | **$9,633** |
| **Profile B — typical agentic turn** | **$423** | **$4,226** | **$25,355** |

These cells are computed in the public sources cited in-document §3.3–§3.4.
**Every figure quoted to a client must come straight from this table** (or be recomputed with the
formula there) — do not paraphrase a midpoint that no row produces.

> If you need the cheapest realistic figure to quote, it is the **light skill turn at low
> volume (~5–12k generations) ≈ $160–400/mo** — i.e. the Profile-A row *between* the LOW and MED
> columns, not a MED number.

### Model routing is the biggest lever

Same typical turn (Profile B), MED 50k, EU regional:

| Model | Per-gen | MED/month |
|---|---|---|
| Haiku 4.5 | $0.0282 | **~$1,408** |
| Sonnet 4.6 | $0.0845 | **~$4,226** |
| Opus 4.8 | ~$0.19 (incl. new-tokenizer effect) | **~$15k–17k** |

Routing simple skill turns to **Haiku** and reserving **Opus** for hard reasoning is a 3–10×
cost swing — the single largest control. (Opus 4.7+ use a tokenizer that may consume ~35% more
tokens for the same text; raise estimates accordingly.)
([Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing#model-pricing), 2026-06-05; computation in the public sources cited in-document §3.5.)

### Infrastructure (observability)

The OTEL collector + Prometheus + Grafana stack from [`telemetry.md`](telemetry.md)
costs **$0–25/month**: ~$10–25 for one small (4 GB) EU VPS self-hosting the open-source stack, or
**$0** on Grafana Cloud's free tier (10k series, 50 GB logs, 14-day retention). Keep raw
prompt/response bodies **out** of logs to preserve the ZDR story end-to-end — telemetry should be
metrics/events only.
([Grafana Cloud free tier](https://grafana.com/products/cloud/free-tier/); [self-hosted stack cost](https://heroctl.com/en/blog/monitoring-stack-prometheus-grafana-loki), 2026-06-05.)

### Grand total (representative)

| Line | LOW (Profile A) | MED (Profile B) | HIGH (Profile B) |
|---|---|---|---|
| Model (Bedrock EU regional, Sonnet 4.6) | ~$161 | ~$4,226 | ~$25,355 |
| Observability (VPS or Grafana free) | $0–25 | $0–25 | $0–25 |
| **Total** | **~$161–186** | **~$4,226–4,251** | **~$25,355–25,380** |

Token spend is ~99% of total at every scale; infra is rounding error.

---

## Before quoting a client — verify these

1. **Re-confirm prices on AWS.** Bedrock uses first-party list pricing (per Anthropic's docs),
   but **confirm the latest Claude SKUs on [aws.amazon.com/bedrock/pricing](https://aws.amazon.com/bedrock/pricing/)
   before contracting** — the public AWS pricing page does not always surface new Claude SKUs
   promptly.
2. **Re-read the Bedrock abuse-detection page** at onboarding **and put the scheduled re-check in
   place** (see "Monitoring the ZDR basis"). The "ZDR-by-default, no request" claim rests on Claude
   *not* being on the retention-exception list (only GPT-5.x is, as of 2026-06-05) — a mutable
   page, so monitor it, do not assume it. If that ever changes, request the ZDR exception via the
   AWS account team — still without Enterprise — and lean on the DPA's ZDR clause (pt.4) as the
   contractual backstop.
3. **Use a regional (not global) endpoint** for any residency mandate; budget the +10%.
4. **Sign the GDPR DPA** with the chosen hyperscaler (AWS/Google), not with Anthropic.
5. **All volume/token figures here are assumptions** — swap in measured telemetry; the formulas
   in the public sources cited in-document §3 are exact.

---

## Sources (all fetched 2026-06-05)

- the public sources cited in-document — the full clean-room research and cost model this document condenses.
- Anthropic — [Claude in Amazon Bedrock](https://platform.claude.com/docs/en/build-with-claude/claude-in-amazon-bedrock) · [Claude Platform on AWS](https://platform.claude.com/docs/en/build-with-claude/claude-platform-on-aws) · [Claude on Vertex AI](https://platform.claude.com/docs/en/build-with-claude/claude-on-vertex-ai) · [Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- AWS — [Claude Sonnet 4.6 model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-4-6.html) (model ID `anthropic.claude-sonnet-4-6`, EU geo profile `eu.anthropic.claude-sonnet-4-6`, prompt caching support) · [Amazon Bedrock abuse detection](https://docs.aws.amazon.com/bedrock/latest/userguide/abuse-detection.html) · [Data protection in Amazon Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/data-protection.html) · [Bedrock pricing](https://aws.amazon.com/bedrock/pricing/) · [GDPR Center](https://aws.amazon.com/compliance/gdpr-center/)
- Google Cloud — [Vertex AI data governance](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/data-governance)
- Grafana — [Cloud free tier](https://grafana.com/products/cloud/free-tier/) · [pricing](https://grafana.com/pricing/) · self-hosted stack cost ([HeroCtl](https://heroctl.com/en/blog/monitoring-stack-prometheus-grafana-loki))
