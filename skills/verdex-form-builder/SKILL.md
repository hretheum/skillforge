---
name: verdex-form-builder
description: >-
  نموذج بناء — يساعد في إنشاء نماذج ويب متوافقة مع معايير WCAG.
  Guide an agent to assemble a Verdex Financial web form that conforms to the
  Verdex --vx- design system and to WCAG accessibility criteria. The description
  above is intentionally written in Arabic (RTL prose, CC-25) to prove the engine
  carries non-Latin SKILL.md content through unmodified. Use this when a request
  asks for a Verdex form — a login, payment, or onboarding form — whose fields,
  labels, and validation messages must bind the client's --vx- tokens and remain
  accessible across the four Verdex themes and three locales (en-US, ar-SA, ja-JP).
  The skill reads the active Verdex token set through the engine-resolved
  references; it carries no client-specific values of its own.
license: SEE LICENSE IN LICENSE
compatibility: >-
  Instruction-kind skill: no input/output adapter and no governed side effect
  (governance:none). Reads the client's resolved `tokenHub` reference (the --vx-
  token set). Composition is synchronous.
metadata:
  skillforge.owner: platform
  skillforge.registryKey: verdex-form-builder
  skillforge.sourceKind: design-system
  skillforge.client: verdex
---

# Build a Verdex Financial form (نموذج بناء)

Produce the instructions an agent needs to assemble a single Verdex web form that
conforms to the Verdex Financial design system **and** to WCAG accessibility
criteria. The skill is generic with respect to the *kind* of form; it is made
specific only by the Verdex token set the engine substitutes at run time.

This skill's description carries Arabic prose deliberately (CC-25): the engine
must read and route the skill on its ASCII registry key while preserving the
non-Latin SKILL.md body byte-for-byte. No transliteration, no name parsing.

## When this applies

Activate when a request asks to create or scaffold a new Verdex form — a login,
payment, onboarding, or KYC form — whose fields and validation copy must follow
the Verdex design system and stay accessible.

## What it produces

A set of authoring instructions naming the Verdex token tiers the form must bind
and the WCAG constraints it must honour (label association, focus order, error
identification, contrast). It does **not** write a file — it is an
instruction-kind skill, so its product is guidance, not a governed artifact.

## Boundaries

- This skill holds **no client values**: no colours, no token literals. All of
  that arrives as data through the resolved `tokenHub` reference at run time.
- It decides *what tokens and accessibility constraints* the form must honour; it
  does not render the form and emits no file.
