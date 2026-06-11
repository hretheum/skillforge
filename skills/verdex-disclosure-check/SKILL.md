---
name: verdex-disclosure-check
description: >-
  Validate that a generated Verdex Financial disclosure meets MiFID II
  requirements. A validation-kind skill: it reads a disclosure artifact (the
  output of a sibling disclosure-producing skill, passed on the request) and
  returns a read-only PASS/FAIL verdict asserting the required sections are
  present — risk warnings, cost disclosure, and regulatory references. Use this
  as the mandatory compliance pairing for any Verdex skill that produces a
  financial disclosure: under the strict `compliance` profile, a disclosure
  artifact is not "done" until this check passes. The skill writes no file
  (governance:none); the verdict is its result.
license: SEE LICENSE IN LICENSE
compatibility: >-
  Validation-kind skill: no input/output adapter and no governed side effect
  (governance:none). Reads the disclosure under test from the request and
  returns a {pass:boolean, violations:string[]} verdict. Composition is
  synchronous.
metadata:
  skillforge.owner: platform
  skillforge.registryKey: verdex-disclosure-check
  skillforge.sourceKind: design-system
  skillforge.client: verdex
---

# Verdex disclosure check (MiFID II compliance pairing)

Validate that a generated Verdex Financial disclosure carries the sections
**MiFID II** requires before it may ship. This is a `validation`-kind skill: it
reads the disclosure artifact under test (produced by a sibling
disclosure-producing skill and passed on the request) and returns a read-only
PASS/FAIL verdict. It writes no file — the verdict is the result.

## Why this skill exists (the compliance gate)

Verdex's deployment profile is `compliance` (strict). The defining rule: a
disclosure artifact is **not done** when it is produced — it is done only when
its paired compliance check has also passed. This skill is that paired check.
A disclosure that omits a required regulatory section must fail here, blocking
the artifact from being treated as compliant.

## When this applies

Activate after a Verdex skill produces a financial disclosure (for example a
disclosure tooltip or a regulatory provenance banner). Run this validation
against that disclosure to confirm it meets MiFID II before it is surfaced.

## What it checks

The verdict reports a violation for each MiFID II section the disclosure omits:

- **Risk warnings** — the disclosure must state that capital is at risk.
- **Cost disclosure** — the disclosure must name its costs, fees, or charges.
- **Regulatory references** — the disclosure must cite its regulatory basis
  (FCA authorisation / MiFID II).

A disclosure carrying all three sections PASSES (`{pass:true, violations:[]}`);
any omission produces a FAIL verdict naming the missing section.

## Boundaries

- This skill holds **no client values**: the disclosure under test arrives as
  data on the request. The required-section vocabulary is the regulatory
  contract, the same for any MiFID II disclosure — not a client secret.
- It returns a verdict only; it never writes (governance:none). Persisting a
  verdict would need a write-class kind.
