---
name: competitive-platform-analysis
description: >-
  Identify, categorize, and score-filter a competitor set for the active client
  before any benchmarking begins. Use when scoping a competitive landscape,
  deciding who counts as a competitor, or choosing which sources and platforms
  to mine for competitive intelligence. Reads the active client's positioning
  brief from the client's competitive-context resource; holds no client
  knowledge of its own.
license: SEE LICENSE IN LICENSE
compatibility: >-
  Requires a configured client with a competitive-context resource containing
  brand identity, differentiator, offer, target-client profile, and strategic
  tension. First step in the three-skill competitive pipeline; precedes
  benchmark-methodology.
metadata:
  skillforge.owner: platform
  skillforge.registryKey: competitive-platform-analysis
  skillforge.sourceKind: brand-positioning
  skillforge.resultKind: competitor-set
---

# Competitive Platform Analysis

Use this skill to decide **who to benchmark** and **where to find them** before
any scoring begins. A competitive analysis is only as good as its frame: the
wrong set makes the client look either unbeatable or doomed. The goal is a
defensible, decision-relevant set — not an exhaustive census.

**Source competencies** (pull these skills when working this stage):
`deep-research` for multi-source, cited competitor identification; `research`
for fast breadth passes and landscape framing; `marketing-strategy-pmm` for
competitive-set framing (ICP overlap, competitive intelligence). Verbal-
positioning and visual-craft judgment come later via
`brand-messaging-architecture`, `ui-ux-pro-max`, and `web-design-guidelines`
(see `benchmark-methodology`).

## Client context (read first)

Before scoping the set, read the active client's `competitive-context` resource.
It supplies:

- **Identity / aesthetic register** — what kind of studio or company this is and
  how it presents itself.
- **Offer** — what services or products it delivers.
- **Target clients** — who it sells to.
- **Differentiator** — the moat or positioning argument the client believes in.
- **Scoping consequence** — the implication for how to weight competitors (e.g.,
  prioritize by distinctiveness vs. capability overlap vs. price).
- **Strategic tension** — the paired axes that define the client's white-space
  (e.g., memorability × hireability).

**Do not proceed without loading the competitive context.** A competitor list
scoped without the client's lens is noise, not intelligence. The scoping
consequence in particular determines which competitors are *strong* rivals (those
that contest the client's moat) vs. merely overlapping on service menu.

**If no competitive context is present** (fresh start — the client has no
`competitive-context` resource yet), do **not** invent one and do **not** scope
the set blind. First run **Brand Discovery**: conduct the structured interview in
`INTERVIEW.md` (a short series of `AskUserQuestion` rounds) to elicit the
client's identity, offer, target clients, differentiator, and strategic tension,
assemble the `competitive-context.json`, and confirm it with the user before
scoping any competitors. When the context is absent, the interview is appended
below these instructions automatically.

## Selection criteria

For each candidate, capture these axes — they decide both inclusion and tier:

- **Size / model** — solo, micro-studio (2–8), boutique (sub-30), mid-size
  agency. Match the client's own band; same-band studios are the realistic
  head-to-head set.
- **Niche / specialization** — how closely the candidate's focus overlaps with
  the client's offer. Tighter overlap = more direct.
- **Geography / market** — EU vs US vs global-remote; language; time-zone reach.
  Note whether they win the same clients the client targets.
- **Pricing & engagement model** — productized sprints, retainer, project,
  day-rate; transparent vs "contact us". Signals positioning maturity.
- **Portfolio style** — generic vs. opinionated/editorial vs. contrarian. Closer
  to the client's aesthetic register = more they contest the client's
  distinctiveness.
- **Design-system / tooling maturity** — relevant if the client's credibility
  story includes DS, tokens, component libraries, or public Storybook/Chromatic.
- **Brand strength** — does the studio have an ownable verbal/visual identity, or
  is it interchangeable? Weight this per the client's scoping consequence.

## Player taxonomy — 8 categories to populate

Source the set across all eight so the landscape isn't skewed toward one
archetype. Aim for breadth first, then prune to the most instructive.

1. **Brand-led / editorial boutique studios** — the client's closest mirror if
   they compete on identity and voice, not just craft.
2. **Conversion / activation-focused product studios (CRO-adjacent)** — compete
   on evidence-based, outcomes-first positioning.
3. **Product-strategy & discovery consultancies** — compete on the
   strategy/discovery half of a typical offer.
4. **Design-system specialist studios** — contest DS-foundations credibility.
5. **"Anti-agency" / manifesto-driven contrarian studios** — share an
   opinionated, heretical posture; key for distinctiveness benchmarking.
6. **Premium UX/product agencies serving SaaS / fintech / B2B** —
   aspirational/commercial-credibility reference; show what "enterprise-ready"
   looks like.
7. **Senior independent designers / micro-studios with cult following** — prove
   the "memorable solo brand" model.
8. **Workshop / sprint-format facilitators** — compete on productized engagement
   formats (discovery sprints, workshops).

## Competitive tiers (how the set resolves)

Group the final set into three tiers — this structure carries through to the
report:

- **Direct** — same band, overlapping offer, same client targets. The realistic
  head-to-head.
- **Adjacent** — partial overlap (one capability, or a different client size)
  that pressures at the edges.
- **Aspirational** — studios the client is not competing with today but whose
  brand or commercial maturity sets the bar to aim at.
- *(Watch also for substitutes:* no-code/AI design tools, in-house product
  teams, generalist freelancers — note as a threat vector, not a profiled
  competitor unless materially relevant.)*

## Data sources (where to look)

Match the source to the dimension you need:

- **Dribbble / Behance** — visual craft, portfolio range, aesthetic register.
- **Awwwards / FWA** — site craft and editorial ambition; over-indexes on flashy,
  so cross-check commercial credibility.
- **Studio sites** — primary source for positioning, voice, offer packaging,
  pricing posture, named clients, manifesto/POV.
- **LinkedIn** — team size/model, founder narrative, post cadence, client logos,
  geography.
- **Clutch.co / similar directories** — reviews, named clients, project sizes,
  engagement models; strongest signal for commercial credibility and
  enterprise-readiness.
- **Public Storybook / Chromatic / GitHub** — design-system maturity evidence.
- **Conference talks / podcasts / newsletters** — thought-leadership depth and
  POV ownership.

Always **verify claims across at least two sources** before treating a competitor
attribute as fact (self-reported site copy ≠ verified outcome). Carry the
`deep-research` discipline of adversarial verification into every profile.

## Scoring matrix template (selection stage)

A lightweight pre-filter to decide who graduates into full benchmarking. Score
1–5; keep candidates that score high on **either** distinctiveness **or**
credibility — the client's strategic tension means both poles are instructive.

| Candidate | Category (1–8) | Tier | Offer overlap (1–5) | Distinctiveness (1–5) | Commercial credibility (1–5) | Aesthetic proximity (1–5) | Include? |
|-----------|----------------|------|---------------------|------------------------|------------------------------|---------------------------|----------|

Rules of thumb (apply per the client's scoping consequence in competitive-context):

- High distinctiveness **and** high credibility → must-profile (proves the
  client's target tension is achievable).
- High distinctiveness, low credibility → cautionary case (memorable but
  un-hireable — a potential failure mode to learn from).
- High credibility, low distinctiveness → "competent but forgettable" mass the
  client defines itself against.
- Low on both → drop unless needed for landscape breadth.

## Output of this stage

A scoped, tiered competitor set (typically 10–18 candidates → 8–12 profiled),
each tagged with category, tier, and source links, ready to hand to
`benchmark-methodology`.
