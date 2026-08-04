---
name: benchmark-methodology
description: >-
  Turn a scoped competitor set into comparable, defensible scores across nine
  weighted dimensions. Use after competitive-platform-analysis has produced a
  tiered competitor set, and before assembling the report with
  competitive-report-structure. Reads the active client's competitive-context
  resource for tension axes and weighting rationale; holds no client knowledge
  of its own.
license: SEE LICENSE IN LICENSE
compatibility: >-
  Requires a competitor set produced by competitive-platform-analysis and a
  configured client with a competitive-context resource that defines the
  client's strategic tension (the paired axes whose intersection marks the
  client's target white-space). Second step in the three-skill competitive
  pipeline.
metadata:
  skillforge.owner: platform
  skillforge.registryKey: benchmark-methodology
  skillforge.sourceKind: competitor-set
  skillforge.resultKind: benchmark-scores
---

# Benchmark Methodology

Use this skill to turn a scoped competitor set into **comparable, defensible
scores**. Each competitor is assessed on the same nine dimensions, with
explicit 1–5 rubrics, then captured in a uniform profile card. Consistency is
the point: scores are only useful if the same evidence would earn the same
number for any competitor.

**Source competencies** (pull these skills per dimension):
`marketing-strategy-pmm` for positioning/packaging/battlecard dimensions
(Dunford positioning, competitive intelligence); `brand-messaging-architecture`
for verbal-distinctiveness scoring (Value Proposition Canvas, Moore positioning
template, messaging house); `ui-ux-pro-max` + `web-design-guidelines` for
visual-identity & site-craft scoring; `deep-research` to source and verify
every evidence/credibility claim.

## Client context (read first)

Before scoring, read the active client's `competitive-context` resource. It
supplies:

- **Strategic tension** — the two axes (e.g., memorability × hireability) whose
  intersection marks the client's target white-space. Dimension 9 is always
  the client's named tension; report both poles separately, never averaged.
- **Differentiator** — what makes the client's moat. This informs which
  dimensions matter most for the client's positioning argument.
- **Brand balance** — the intended mix of distinct strategic emphases. Strategic
  recommendations must not break this balance without flagging it.

## Why these dimensions

The client competes on a **specific tension held across two poles**, not on
service breadth. The dimensions are weighted to reflect that moat. Two
dimensions — the tension poles — are scored **separately and never averaged
together**, because the client's strategic question is precisely whether a rival
achieves both simultaneously.

## The nine dimensions (with weights)

Weights guide synthesis emphasis, not a single blended score (avoid a false
composite — see Bias controls). Sum = 100%.

1. **Positioning clarity & distinctiveness** (18%) — Is the studio's position
   sharp, ownable, and instantly legible? Or generic?
2. **Brand voice / verbal distinctiveness** (15%) — Does the copy have an
   ownable register, or is it interchangeable agency-speak?
3. **Visual identity & site craft** (15%) — Quality and ownership of the visual
   system; site as proof-of-craft.
4. **Service offer & packaging** (12%) — Productized and legible (named
   sprints/audits) vs vague. Packaging maturity.
5. **Evidence & credibility** (12%) — Named clients, quantified outcomes,
   case-study depth. Proof beyond assertion.
6. **Enterprise-readiness / commercial maturity** (10%) — Signals they can land
   and hold SaaS/fintech/B2B/enterprise work (process, logos, scale, contracts).
7. **Thought leadership / content presence** (8%) — Owned POV: writing, talks,
   newsletters, frameworks. Depth over volume.
8. **Pricing transparency & engagement model** (5%) — Is pricing/engagement
   legible? Productized vs bespoke vs opaque.
9. **[Client's strategic tension]** (5% as a flag; **score BOTH poles,
   report separately**) — Read the tension name and axis descriptions from the
   client's competitive-context. Plot both; the gap is the insight. The client's
   target quadrant (from competitive-context) is the single most important
   finding: who else is already there?

## Scoring rubric (1–5, applies to dimensions 1–8)

Anchor every score to observable evidence. Generic descriptors below; adapt the
specifics per dimension but keep the level meaning constant.

- **1 — Absent / generic.** No discernible position or craft; indistinguishable
  from a template. Active liability.
- **2 — Below par.** Some intent but inconsistent, derivative, or unconvincing.
  Wouldn't survive a side-by-side.
- **3 — Competent / table-stakes.** Solid, professional, unremarkable. Meets
  expectation, ownable by nobody.
- **4 — Strong / distinctive.** Clearly above peers; a real strength a buyer
  would notice and cite.
- **5 — Category-defining.** Best-in-class, ownable, hard to imitate. Sets the
  bar others react to.

### Tension axes (dimension 9) — score each 1–5

Read the axis labels and their 1/3/5 anchors from the client's
competitive-context. The standard anchors for a memorability × hireability
tension are:

- **Memorability** — 1: forgotten instantly · 3: recognizable in context ·
  5: unforgettable, talked-about, has a "cult".
- **Hireability / credibility** — 1: feels risky/amateur · 3: safe, credible,
  unexciting · 5: enterprise-trusted, obvious safe choice.

Plot competitors on the tension 2×2. The client's target quadrant is named in
competitive-context. Who else occupies that quadrant is the single most
important finding of the benchmark.

## How to collect the data

For each competitor, work the dimensions in this order (cheapest signal first):

1. **Studio site** — positioning, voice, offer packaging, pricing posture, named
   clients, manifesto/POV. Screenshot the homepage + one case study.
2. **Case studies / work** — evidence depth, quantified outcomes, client names.
   Distinguish *asserted* ("we redesigned X") from *proven* (metrics, named,
   verifiable).
3. **Directory / reviews (Clutch.co etc.)** — corroborate clients, project size,
   engagement model → credibility & enterprise-readiness.
4. **LinkedIn** — team size/model, founder narrative, content cadence →
   thought leadership, model.
5. **Portfolio platforms (Dribbble/Behance/Awwwards)** — visual craft register.
6. **Content channels** — newsletter/talks/writing → thought-leadership depth.

**What to record per dimension:** the score, one-line justification, and the
source link/screenshot that earned it. No score without evidence.

## Bias controls

- **No single composite score.** Report dimension scores and the tension plot
  separately. A weighted average hides the asymmetry that matters.
- **Asserted vs proven.** Downgrade credibility/evidence scores for
  self-reported claims with no corroboration. Site copy is marketing, not fact.
- **Aesthetic affinity bias.** Reviewers may over-score studios whose aesthetic
  they share and under-score rivals' commercial strength. Score craft and
  credibility independently; a "boring" site may be winning bigger clients.
- **Recency / flashiness bias.** Awwwards-style sites dazzle but may lack
  commercial depth — verify with Clutch/clients before scoring credibility.
- **Survivorship.** The visible, well-marketed studios aren't the whole market;
  note strong-but-quiet operators found via directories/reviews.
- **Calibrate across the set, not in isolation.** Before finalizing, re-read
  scores side-by-side — a "4" must mean the same thing for every competitor.
  Adjust outliers.

## Competitor profile card (output format)

Produce one card per profiled competitor — the atomic unit the report assembles
from:

```
## <Studio name>
- **Category / Tier:** <1–8> / <Direct | Adjacent | Aspirational>
- **One-liner:** <how they position themselves, in their words>
- **Model / size / geography:** <solo|micro|boutique> · <region> · <pricing/engagement model>
- **Notable clients / evidence:** <named, with proven/asserted tag>

### Dimension scores
| Dimension | Score (1–5) | Justification (1 line) | Source |
|---|---|---|---|
| Positioning clarity & distinctiveness | | | |
| Brand voice / verbal distinctiveness | | | |
| Visual identity & site craft | | | |
| Service offer & packaging | | | |
| Evidence & credibility | | | |
| Enterprise-readiness / commercial maturity | | | |
| Thought leadership / content presence | | | |
| Pricing transparency & engagement model | | | |

### Tension plot
- **[Axis 1 from competitive-context]:** <1–5> — <why>
- **[Axis 2 from competitive-context]:** <1–5> — <why>
- **Quadrant:** <high/high | high-1/low-2 | low-1/high-2 | low/low>

### Read for [client]
- **Strength to learn from:** <…>
- **Weakness to exploit / white-space it exposes:** <…>
- **Threat to [client]:** <…>
```

Hand the completed cards plus the tension plot to `competitive-report-structure`.
