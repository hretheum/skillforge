# Vision and problem

---

## What it is about, in one paragraph

Imagine a team that does the same thing for many brands or many clients: every time
you have to teach the agent (the AI assistant) how to work according to the rules of *that specific* brand —
its design system, its technology stack, its conventions. **skillforge** is the idea of a machine
that does this work once: a single shared engine, into which you plug a **client description**, and it
produces ready-made **skills** — specialized agent capabilities tailored to that client.
Instead of building a separate tool for each brand, you build one factory and only swap out the
"feedstock" in it — the data about the client.

> **skill** = a named, reusable capability of the agent — for example "create a component that conforms
> to this client's design system". Full definition → [`skills-and-commands.md`](skills-and-commands.md),
> glossary → [`glossary.md`](glossary.md).

---

## The problem: what hurts today

When the same type of work is done for many clients, the mechanics are almost identical every time:
read the client's rules (e.g. its design system), assemble a response based on them, hand off the result
in the form the client uses (e.g. a component in a specific technology). **The mechanics are repetitive,
only the client changes.** And yet, without a shared engine, the same work is redone from scratch for
every client.

The cost of the status quo:

- **Duplication.** The same logic ("read the DS → assemble → emit") written many times, once per client.
- **No scale.** The tenth client costs as much effort as the first — nothing accumulates.
- **Quality drift.** Each copy lives its own life; a fix in one does not reach the others.
- **Knowledge in heads, not in the tool.** "How you build a component for brand X" stays in people,
  instead of being a repeatable, executable capability.

---

## The solution: one engine, a swappable client

skillforge separates what is **fixed** from what is **variable**:

- **Fixed — the engine (generic).** All the mechanics of assembling skills. The engine **knows nothing** about any
  specific client. What it does is universal.
- **Variable — the client description (config).** Everything that distinguishes a given client — its brand, its
  design system, the target technology — described as **separate, swappable data**. No logic, just facts.

Thanks to this, a new client is a **new description**, not a new tool. The engine stays the same; a fix
in the engine works for everyone at once. The knowledge "how this is done" lives in the engine as an executable
capability, not in the team's memory.

---

## What "generic engine" means (in plain terms)

"Generic" here means one thing: **the engine has no client baked inside it.** It contains no
brand name, no brand colors, no brand technology. All of that comes from the outside, as a
client description. The test is simple: if you can swap one client's description for another's and the engine
runs with no change to its code — then the engine is truly generic. It is exactly this swappability
that is the heart of the idea and the main criterion by which we will know the project has succeeded.

---

## Who this is for

- **A studio or team serving many clients** — an agency, a software house, an in-house department —
  that reproduces the same work mechanics for each client.
- **An organization with many brands** — where each brand has its own design system, but the process of building
  under it is the same.
- **A single creator running several projects** — who wants to build the factory once and only add
  descriptions of further projects.

The first real client of this factory is the author's own brand — the example client — and it is on it that the
project proves the idea works.

---

## What it is NOT

- **It is not a website builder or a ready-made "build-an-app-by-clicking".** It is a factory of *agent capabilities*,
  not an editor for the end user.
- **It is not a tool tied to one brand.** If anything about a specific client were
  baked into the engine, it would stop being generic — and that would contradict the whole idea.
- **It is not a copy of any existing tool.** It is an **independent implementation of the idea itself**,
  written from scratch — see the provenance note in [`architecture-overview.md`](architecture-overview.md) and
  `docs/security.md`.
- **It is not (at this stage) a public or commercial product.** It is a private development workshop.

---

## Where to go next

- **How the engine realizes all of this** → [`architecture-overview.md`](architecture-overview.md)
- **How a client is described** → [`client-model.md`](client-model.md)
- **What exactly a skill is** → [`skills-and-commands.md`](skills-and-commands.md)
- **How to run the engine** → [`getting-started.md`](getting-started.md)
