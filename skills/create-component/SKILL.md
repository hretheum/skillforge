---
name: create-component
description: >-
  Create a UI component artifact that conforms to a client's design system. Use
  this when a request asks for a new UI element — a button, a card, a form field,
  or any reusable interface component — that must follow the active client's
  tokens, roles, and target stack. The skill reads the client's design system
  through the configured input adapter, composes a component description bound to
  that client's tokens and roles, and emits the artifact through the configured
  output adapter; it carries no client-specific knowledge itself.
license: SEE LICENSE IN LICENSE
compatibility: >-
  Requires a configured input adapter that produces a design-system source-kind
  and an output adapter that accepts a frontend-component result-kind. Reads
  files; no network access of its own.
metadata:
  skillforge.owner: platform
  skillforge.registryKey: create-component
  skillforge.sourceKind: design-system
  skillforge.resultKind: frontend-component
---

# Create a component

Produce a single UI component as a concrete artifact in the active client's
target stack, conforming to that client's design system. This is the canonical
worked example of a skill: a generic recipe with respect to the *kind* of
artifact and the *kind* of source, made specific only by the data the engine
substitutes at run time. The same mechanics underlie other skills (an API spec
from a tracker, tests from a requirements document) — only the adapters and the
config differ.

## When this applies

Activate when a request asks to create, scaffold, or generate a new UI
component that must follow the active client's design system — for example a new
button, card, badge, or form field. Recognition (`name` + `description`) only
*chooses* this skill; the engine still gates it on the active client having
adopted the skill, the registry enabling it, the adapters typing-checking
against the result it emits, scope, and the deployment profile. Choosing the
skill is necessary but not sufficient; the loader enforces the full predicate.

## What it produces

A finished component artifact in the client's target stack, conforming to the
client's design system: a structure whose parts are bound to the client's
tokens and roles, rendered into the target form by the output adapter. The
result is described in an artifact-independent, normalized form and tagged with
the result-kind `frontend-component`; the output adapter turns that into the
concrete files. Swapping the output adapter changes the *form* of the artifact
(one stack vs. another) without changing the skill or the decision it made.

## What it is composed of

This skill assembles its behavior from generic parts the engine provides; none
of them name a client. Every client-specific value enters from the outside — the
client config and the two adapters — at the moment of execution.

- **Input adapter** — reads the active client's design system from references in
  the config and returns a normalized description (tokens, roles, and any
  component structure). The skill consumes the source-kind `design-system` and
  never learns where the data physically came from.
- **Skill core** — combines the generic "how to build a component" logic with
  the freshly read client knowledge to compose a normalized component
  description: its structure, the tokens and roles each part binds, and its
  states. This is the only step where the recipe meets this client's data, and
  it is why the recipe stays generic.
- **Output adapter** — receives the normalized result (tagged
  `frontend-component`) and renders it into a concrete artifact in the client's
  target stack, honoring any output settings from the config.

## How a single run proceeds

1. **Load the client.** The engine resolves the active client's config and reads
   off which input adapter, which output adapter, and where the client's design
   system lives. The skill reads none of this directly; it is handed the wiring.
2. **Read the design system.** Ask the configured input adapter for a normalized
   description of the client's design system. If the input adapter fails fatally,
   the run aborts — the skill never composes a component from a partial or empty
   design system.
3. **Compose the component.** Combine the generic component recipe with the
   normalized description to produce a normalized component result: the parts,
   the token/role bindings, and the states. Decisions are recorded here as data,
   not rendered yet.
4. **Emit the artifact.** Hand the normalized result to the configured output
   adapter, which renders it into the target stack. The skill does not render the
   artifact itself, so the same composed result can be emitted in different
   stacks by different output adapters.
5. **Return.** The caller receives the finished component artifact, conforming to
   the client's design system and in its target technology.

## Boundaries

- This skill holds **no client knowledge**: no client names, no file paths, no
  colors, no token names. All of that arrives as data through the config and the
  adapters at run time.
- It does **not** read the source again after composition; it works from the
  normalized description it was given, and the output adapter works only from the
  normalized result.
- It decides *what* the component is; the output adapter decides only *how* that
  is rendered. Two output adapters yield two forms of the same component, never
  two different components.
