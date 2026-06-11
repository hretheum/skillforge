---
name: sync-example
description: >-
  Bidirectionally synchronize a client's design system between two sides (e.g.
  code and design), writing BOTH directions through the gated apply path. Use
  this when a request asks to reconcile or mirror a design system across two
  representations that can each drift. The skill reads the client's design system
  through the configured input adapter, composes the write intents for both sides,
  and every intent passes the PreToolUse gate and is recorded on the audit trail
  before anything is applied; it carries no client-specific knowledge itself.
license: SEE LICENSE IN LICENSE
compatibility: >-
  Requires a configured input adapter that produces a design-system source-kind
  and an output adapter that accepts a frontend-component result-kind. Writes
  files on both sides; no network access of its own.
metadata:
  skillforge.owner: platform
  skillforge.registryKey: sync-example
  skillforge.skillKind: sync
  skillforge.sourceKind: design-system
  skillforge.resultKind: frontend-component
---

# Sync (bidirectional, example)

Reconcile a client's design system across two sides, writing each side through
the same gated apply path the artifact and transformation kinds use. This is the
worked example of the `sync` skill kind: a `bidirectional`-governance recipe whose
compose step returns a non-empty array of write intents — one per direction — that
the executor fans out to the PreToolUse gate. A deny on either side aborts the run
(deny-first), and every gated intent is recorded on the audit trail so a two-way
sync is fully attributable.

## When this applies

Activate when a request asks to sync, mirror, or reconcile a design system between
two representations that can independently drift. Recognition only *chooses* this
skill; the engine still gates it on the active client having adopted the skill, the
registry enabling it, the adapters typing-checking, scope, and the deployment
profile.

## What it produces

The write intents for BOTH sides of the sync, each a `{tool, toolInput}` the gate
checks before it is applied. The bidirectional governance class names that the
writes flow in two directions; the audit trail records the resource name and the
gate verdict for each (never a value).

## Boundaries

- This skill holds **no client knowledge**: the client handle and the two side
  paths arrive as request data; the design system arrives normalized through the
  input adapter.
- It does **not** apply the writes itself; it composes the intents, and the engine
  gates + audits them. A denied intent on either side aborts the whole sync.
