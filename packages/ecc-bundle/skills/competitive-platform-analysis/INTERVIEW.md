# Brand Discovery interview (fresh-start mode)

Run this interview only when the active client has **no** `competitive-context`
resource yet. Its purpose is to elicit the positioning facts a competitive
analysis needs, then assemble a `competitive-context.json` the rest of this skill
(and `benchmark-methodology`, `competitive-report-structure`) can read.

This interview holds **no** knowledge of any specific studio. Every option below
is a generic preset that fits any design or product studio. Treat the presets as
starting points, not a closed list — always offer a free-text path so the user
can describe a register, offer, or tension the presets miss.

## How to run it

Use `AskUserQuestion` for each round. Keep each round to at most four questions,
each question to at most four options, and always allow a free-text answer ("Other")
because several target fields are free-form descriptions. Five rounds, roughly ten
questions total — enough to fill the whole schema without fatiguing the user.

Some fields are **not asked directly** because users don't think in their terms
(`scopingConsequence`, `brandBalance` weights). You **derive** these from the
answers and **confirm** them in the final round.

### Round 1 — Identity

1. **Studio name?** (free text) → `identity.name`. Derive a short form (initials
   or a natural abbreviation) for `identity.shortName` and confirm it.
2. **One-line positioning / tagline?** (free text) → `identity.tagline`.
3. **Aesthetic register?** Options: `minimal / corporate-clean` ·
   `editorial / premium` · `brutalist / experimental` · Other (free text) →
   `identity.aestheticRegister`.
4. **Size & model?** Options: `solo / freelancer` · `micro-studio (2–8)` ·
   `boutique (sub-30)` · `mid-size agency` → `identity.modelType` and
   `identity.band` (use the band word: solo / micro / boutique / mid-size).

### Round 2 — Offer (multi-select)

1. **What do you deliver?** (multiSelect) Options: `product design / UX` ·
   `UX strategy & discovery` · `UX audits & conversion diagnostics` ·
   `design-system foundations` + Other (free text). → `offer[]` as a flat list of
   strings. Parse the Other free-text into separate list items (split on commas).

### Round 3 — Target clients (multi-select)

1. **Who do you sell to?** (multiSelect) Options: `founders / product leaders` ·
   `scaleups / startups` · `SaaS / fintech / B2B platforms` ·
   `enterprise innovation teams` + Other (free text). → `targetClients[]` as a
   flat list of strings (split Other on commas).

### Round 4 — Differentiator & strategic tension

1. **Your moat — what sets you apart that competitors lack?** (free text) →
   `differentiator`.
2. **Strategic axis 1 — what you want to be exceptional at.** Options:
   `memorability / distinctiveness` · `technical depth` · `speed / delivery` ·
   Other → `strategicTension.axis1.label`.
3. **Strategic axis 2 — what you cannot sacrifice.** Options:
   `hireability / credibility` · `affordability` · `breadth of service` · Other →
   `strategicTension.axis2.label`.

From axes 1 and 2, compose `strategicTension.name` = `"{axis1} × {axis2}"`, set
`strategicTension.targetQuadrant` = `"high-{axis1} / high-{axis2}"`, fill the 1/3/5
anchors for both axes (templates below), and write a one-paragraph
`strategicTension.description` explaining the white-space the client is aiming for.

### Round 5 — Brand balance & confirmation

1. **Where do you put the emphasis?** Options: `evidence / strategy first` ·
   `distinctiveness / brand first` · `premium craft first` · `balanced`. Map the
   answer to three weights summing to 1.0 (see the brandBalance template), then
   write a `brandBalance.note` capturing what must not be broken.

After this round, **present the assembled `competitive-context.json` for
confirmation** before scoping any competitors. Include the **derived**
`scopingConsequence` — a full sentence you generate from the differentiator and
strategic tension (e.g., whether to rank competitors by distinctiveness, by
capability overlap, or by price) — and let the user accept or correct it.

## Answer → schema mapping

| Schema field | Source |
|---|---|
| `identity.name` | Round 1 Q1 |
| `identity.shortName` | derived from name (confirm) |
| `identity.tagline` | Round 1 Q2 |
| `identity.aestheticRegister` | Round 1 Q3 |
| `identity.modelType`, `identity.band` | Round 1 Q4 |
| `offer[]` | Round 2 Q1 (multi + Other) |
| `targetClients[]` | Round 3 Q1 (multi + Other) |
| `differentiator` | Round 4 Q1 |
| `strategicTension.name` | `"{axis1} × {axis2}"` from Round 4 Q2+Q3 |
| `strategicTension.axis1.{label,anchor1,anchor3,anchor5}` | Round 4 Q2 + anchor template |
| `strategicTension.axis2.{label,anchor1,anchor3,anchor5}` | Round 4 Q3 + anchor template |
| `strategicTension.targetQuadrant` | `"high-{axis1} / high-{axis2}"` |
| `strategicTension.description` | generated from Q1+Q2+Q3 |
| `scopingConsequence` | derived from differentiator + tension (confirm in Round 5) |
| `brandBalance.{...}` weights + `note` | Round 5 Q1 + template |

## Anchor template (per axis)

For each strategic axis, fill three calibration anchors on a 1–5 scale. Phrase
them for the **axis label the user chose**, following this shape:

- `anchor1` — the weak / failing end (e.g., for a "memorability" axis: "forgotten
  instantly"; for a "credibility" axis: "feels risky or amateur").
- `anchor3` — the competent-but-unremarkable middle (e.g., "recognizable in
  context"; "safe but unexciting").
- `anchor5` — the exceptional end the client aims for (e.g., "unforgettable,
  talked-about"; "the obvious trusted choice").

Keep anchors specific to the chosen axis label; do not reuse another client's
phrasing.

## brandBalance template

Three weights that sum to 1.0, mapped from the Round 5 emphasis answer. The three
dimensions are: **strategy/evidence**, **distinctiveness/brand**, and
**premium/editorial craft**. Suggested mappings (adjust with the user):

| Round 5 answer | strategy/evidence | distinctiveness/brand | premium craft |
|---|---|---|---|
| evidence / strategy first | 0.60 | 0.25 | 0.15 |
| distinctiveness / brand first | 0.25 | 0.60 | 0.15 |
| premium craft first | 0.20 | 0.25 | 0.55 |
| balanced | 0.34 | 0.33 | 0.33 |

Name the three keys in camelCase, derived from how the studio describes itself —
for example `strategyAndEvidence`, `brandAndDistinctiveness`, `premiumCraft` — or
whatever vocabulary matches the client's own language. If an existing
`competitive-context.json` is created later, align the key names with it. Write a
`note` that states which way the balance must not be broken (e.g., "do not trade
credibility for shock value").
