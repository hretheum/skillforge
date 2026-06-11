---
name: verdex-analytics
description: >-
  アナリティクス — Verdex Analytics Dashboard Skill. An analysis-kind skill that
  reads the Verdex --vx- token set and composes a read-only report describing the
  token tiers available to an analytics dashboard. The title above is written in
  Japanese katakana (CC-29) to prove the engine routes on the ASCII registry key
  while preserving non-Latin title prose. Use this when a request asks to assess
  which Verdex tokens a dashboard surface can bind. The skill produces a report
  envelope only — it writes no file (governance:none).
license: SEE LICENSE IN LICENSE
compatibility: >-
  Analysis-kind skill: no input/output adapter and no governed side effect
  (governance:none). Reads the client's resolved `tokenHub` reference and returns
  a {report} envelope. Composition is synchronous.
metadata:
  skillforge.owner: platform
  skillforge.registryKey: verdex-analytics
  skillforge.sourceKind: design-system
  skillforge.client: verdex
---

# アナリティクス — Verdex Analytics Dashboard Skill

Produce a read-only **report** describing the Verdex token tiers an analytics
dashboard can bind. This is an `analysis`-kind skill: it reads the client's token
set through the engine-resolved references and returns the report in its envelope.
It writes no file — a persisted report would need a write-class kind
(`transformation`); `analysis` is the read-only discriminator (CC-16).

The title carries Japanese katakana deliberately (CC-29): the engine routes on the
ASCII registry key (`verdex-analytics`) while the human-facing title stays
non-Latin and untouched.

## When this applies

Activate when a request asks to assess or summarise which Verdex tokens an
analytics surface can use, without producing a file artifact.

## What it produces

A `{ report }` envelope: a structured object naming each token tier and its
count. No file, no governed side effect.

## Boundaries

- This skill holds **no client values**: all token data arrives through the
  resolved `tokenHub` reference at run time.
- It emits a report only; it never writes (governance:none).
