---
name: verdex-create-component
description: >-
  Guide an agent to create a Verdex Financial UI component that conforms to the
  Verdex 3-tier --vx- design system across its four themes (light, dark,
  hc-light, hc-dark) and three locales (en-US, ar-SA, ja-JP). Use this when a
  request asks for a new Verdex interface component — a button, input, data-table
  cell, or any reusable element — that must bind the client's --vx- tokens
  (primitive -> semantic -> component) and honour the regulated-fintech
  constraints (logical CSS properties for RTL, theme-aware token resolution where
  a token may be null in a given theme). The skill reads the active Verdex token
  set through the engine-resolved references and composes instructions bound to
  that token set; it carries no client-specific values of its own.
license: SEE LICENSE IN LICENSE
compatibility: >-
  Instruction-kind skill: no input/output adapter and no governed side effect.
  Reads the client's resolved `tokenHub` reference (the --vx- token set) and the
  `brandRules` reference. Composition is async so the recipe can assemble the
  token guidance without blocking the engine.
metadata:
  skillforge.owner: platform
  skillforge.registryKey: verdex-create-component
  skillforge.sourceKind: design-system
  skillforge.client: verdex
---

# Create a Verdex Financial component

Produce the instructions an agent needs to author a single Verdex UI component
that conforms to the Verdex Financial design system. Verdex is a regulated
fintech with a **3-tier token system** (`primitive` -> `semantic` -> `component`,
all prefixed `--vx-`), **four themes** (`light`, `dark`, `hc-light`, `hc-dark`),
and **three locales** (`en-US` LTR, `ar-SA` RTL, `ja-JP` non-Latin). The skill is
generic with respect to the *kind* of component; it is made specific only by the
Verdex token set the engine substitutes at run time.

## When this applies

Activate when a request asks to create, scaffold, or generate a new Verdex UI
component that must follow the Verdex design system — for example a button, a
form input, a data-table cell, or a disclosure tooltip. Recognition only
*chooses* this skill; the engine still gates it on the active client (verdex)
having adopted the skill, the registry enabling it, scope, and the deployment
profile (`compliance`).

## What it produces

A set of authoring instructions naming the Verdex token tiers the component must
bind and the regulated-fintech constraints it must honour. It does **not** write
a file — it is an instruction-kind skill, so its product is guidance, not a
governed artifact. The component author binds the named `--vx-` tokens; the
craft values live in the client's token set, not in this skill.

## The Verdex constraints the instructions encode

- **Token tier discipline.** A component token (`--vx-btn-*`) resolves through a
  semantic token (`--vx-color-*`), which resolves through a primitive
  (`--vx-palette-*` / `--vx-scale-*`). Never bind a component slot straight to a
  primitive.
- **Theme awareness.** Resolve each bound token for the active theme. A token may
  be `null` in a given theme (for example `--vx-elevation-shadow` is `null` in the
  high-contrast themes, which replace shadow with border) — treat `null` as
  "omit this property", never as a literal value.
- **RTL safety.** Use logical CSS properties (`padding-inline-start`) so the
  component mirrors correctly under `ar-SA`; never physical (`padding-left`).
- **Non-Latin content.** Do not truncate long token names or mangle non-Latin
  strings in any generated copy.

## Boundaries

- This skill holds **no client values**: no colours, no token literals. All of
  that arrives as data through the resolved `tokenHub` reference at run time.
- It decides *what tokens and constraints* the component must honour; it does not
  render the component and emits no file.
