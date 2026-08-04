---
name: design-system
description: Use this skill to generate or audit design systems, check visual consistency, and review PRs that touch styling.
origin: ECC
---

# Design System — Audit & Inspect Visual Systems

## Scope Note

This skill covers **auditing** an existing design system and **detecting** problems in it — consistency scoring, AI slop detection, and visual review. It also offers a generation mode (Mode 1) for bootstrapping a token set, but its distinctive value is the audit and quality-detection tooling.

For **defining and emitting design system rules** (a codified ruleset that constrains how components should be built), use a rule-emission skill such as `create-design-system-rules` (full ECC install). For **Tailwind-specific token configuration**, use a Tailwind token skill such as `tailwind-design-system` (full ECC install).

## When to Use

- Auditing an existing codebase for visual consistency
- Before a redesign — understand what you have
- When the UI looks "off" but you can't pinpoint why
- Reviewing PRs that touch styling
- Detecting AI-generated design patterns that lack design intention

## How It Works

### Mode 1: Generate Design System

Analyzes your codebase and generates a cohesive design system:

```
1. Scan CSS/Tailwind/styled-components for existing patterns
2. Extract: colors, typography, spacing, border-radius, shadows, breakpoints
3. Research 3 competitor sites for inspiration (via browser MCP)
4. Propose a design token set (JSON + CSS custom properties)
5. Generate DESIGN.md with rationale for each decision
6. Create an interactive HTML preview page (self-contained, no deps)
```

Output: `DESIGN.md` + `design-tokens.json` + `design-preview.html`

### Mode 2: Visual Audit

Scores your UI across 10 dimensions (0-10 each):

```
1. Color consistency — are you using your palette or random hex values?
2. Typography hierarchy — clear h1 > h2 > h3 > body > caption?
3. Spacing rhythm — consistent scale (4px/8px/16px) or arbitrary?
4. Component consistency — do similar elements look similar?
5. Responsive behavior — fluid or broken at breakpoints?
6. Dark mode — complete or half-done?
7. Animation — purposeful or gratuitous?
8. Accessibility — contrast ratios, focus states, touch targets
9. Information density — cluttered or clean?
10. Polish — hover states, transitions, loading states, empty states
```

Each dimension gets a score, specific examples, and a fix with exact file:line.

### Mode 3: AI Slop Detection

Identifies generic AI-generated design patterns:

```
- Gratuitous gradients on everything
- Purple-to-blue defaults
- "Glass morphism" cards with no purpose
- Rounded corners on things that shouldn't be rounded
- Excessive animations on scroll
- Generic hero with centered text over stock gradient
- Sans-serif font stack with no personality
```

## Examples

**Generate for a SaaS app:**
```
/design-system generate --style minimal --palette earth-tones
```

**Audit existing UI:**
```
/design-system audit --url http://localhost:3000 --pages / /pricing /docs
```

**Check for AI slop:**
```
/design-system slop-check
```
