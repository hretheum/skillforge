# The normalized form

> **What you'll find here:** the one data shape the engine's core actually speaks — the **normalized
> form** — defined as a *versioned, open contract* rather than by example. The shared **envelope** that both
> edges carry, the two shapes that ride on it (the input adapter's **normalized description** and the
> skill's **normalized result**, the latter a **tagged union** over the same envelope), the rules for
> versioning it, and *why* writing this shape down is what makes the engine's genericity and determinism
> **testable** instead of merely asserted. Back to the map: [`architecture-overview.md`](architecture-overview.md).
> The contracts that *produce and consume* this shape: [`adapters.md`](adapters.md). Where it sits in
> the data flow (tier 2, the stable client prefix): [`architecture-overview.md`](architecture-overview.md).

---

## Why the core needs exactly one language

The whole architecture rests on a single promise: **the engine's core is unaware of the outside world.**
It does not know what kind of source a client keeps, and it does not know what kind of artifact the result
must become. The two [adapters](adapters.md) absorb all of that variety at the edges, and **between
them the core speaks exclusively in the normalized form** — the internal, fixed shape of data that is
independent of any source kind/format or output artifact.

That sentence appears throughout the spec, but until now the normalized form was described **by example**:
"for a design system it's tokens and roles; for a Jira project it's issues and relations". Description by
example is enough to *understand* the idea and *wrong* to *build* on. If the only language of the core has
no contract, three things the rest of the spec promises cannot actually be delivered:

- **Genericity stops being checkable.** "The same skill, fed by two equivalent sources through two
  different input adapters, assembles the same result" (the genericity proof in
  [`adapters.md`](adapters.md)) is only a *testable* claim if "the same result" has a defined shape to
  compare. Against an undefined shape it is an opinion.
- **Determinism stops being checkable.** "The same source bytes produce the same normalized description"
  (the determinism rule) — and the cost saving that rides on it — needs a shape you can serialize and
  byte-compare across runs. You cannot write a byte-diff gate against a shape that exists only in prose.
- **The two edges drift.** Without a contract, the input adapter's output and the skill's expectations are
  coupled only by convention; a new adapter author has nothing to conform to.

So this document gives the normalized form the same treatment the spec gives every other contract: **a
named, versioned shape with explicit rules.** It is deliberately the architecture-stage analogue of the
"intermediate representation vs. bespoke seam" decision the first client (the example client) made on its own
code↔design pipeline — skillforge resolves it *explicitly*, in favor of a small open contract, rather than
letting one emerge by default.

---

## The shared envelope

Everything that crosses an edge — in either direction — carries the same small **envelope**: a fixed set
of fields that identify *what this is*, independent of *what's inside*. The envelope is the part the core
can reason about without understanding the payload; the payload is the part only the relevant adapter and
skill understand.

| Envelope field | What it is | Why the core needs it |
|---|---|---|
| `kind` | The **source-kind** (input side) or **result-kind** (output side) — a stable name like `design-system`, `jira-project`, `documents` (in) or `frontend-component`, `openapi-spec`, `tickets` (out). | Lets the core and the registry **type-check** the wiring without parsing the payload (which adapter produces/accepts which kind → [`adapters.md`](adapters.md), "skill↔adapter typing"). |
| `identity` | A stable, human-meaningful handle for *which* thing this is (e.g. the source reference it was read from, or the artifact's intended name) — **not** the client's name. | Provenance and addressing; lets telemetry and logs refer to a payload without carrying its content (the client identity rule in [`telemetry.md`](telemetry.md)). |
| `content-hash` | A hash of the **canonical serialization of the payload** (see "byte-stability" below). On the **input** edge this is the **source content-hash** — the first-class "did the source change?" proxy, exposed by `sourceContentHash(description)` (`src/core/normalized-form.js`). | The single value that powers determinism gates, prompt-prefix cache validity, and the "upload-once, reference-many" file optimization — all keyed off "did the bytes change?" ([`adapters.md`](adapters.md), file transport). **One value, all three consumers:** the file-transport upload cache (`src/adapters/file-transport.js`) and the tier-2 cache-hit diagnostic (`src/core/cache-diagnostics.js`) read this *identical* hash — they never compute a second, divergent one (T-HARD-07). |
| `schema-version` | The version of *this* normalized-form contract the payload conforms to (e.g. `1`, `1.1`). | Lets a reader know which rules apply and lets the contract evolve without silently breaking older adapters (see "Versioning" below). |

The envelope is **identical in both directions.** That symmetry is not cosmetic: it is what lets a single
determinism/equivalence harness work on both edges, and it is what lets the core treat "a normalized
description" and "a normalized result" as two instances of one family rather than two unrelated blobs.

```
   ┌─────────────────────────── envelope (same on both edges) ───────────────────────────┐
   │  kind   ·   identity   ·   content-hash   ·   schema-version                          │
   ├──────────────────────────────────────────────────────────────────────────────────────┤
   │  payload  ──  input edge:  a normalized DESCRIPTION  (one shape per source-kind)        │
   │           ──  output edge: a normalized RESULT        (a TAGGED UNION over result-kind)  │
   └──────────────────────────────────────────────────────────────────────────────────────┘
```

---

## The two payloads

The envelope is shared; the payload differs by edge — but both are *the normalized form*.

### Input edge — the normalized description

The **normalized description** is what an [input adapter](adapters.md) returns: a fixed internal view of
a client's source, independent of where it came from. Its `kind` is a **source-kind**. For a design system
the payload is tokens, roles, and (optionally) component structure; for a Jira project it is issues with
their fields and relations; for documents it is structured sections. The core never sees the raw source —
only this uniform view, wrapped in the envelope.

There is **one payload shape per source-kind**, owned by the adapters that read that kind. Two adapters
that read the *same* kind from different transports (say, two ways of reaching a DTCG token file) must
produce the *same* payload shape for the same logical source — that equivalence is exactly what the
genericity proof exercises.

### Output edge — the normalized result (a tagged union)

The **normalized result** is what the skill's core assembles and hands to an [output adapter](adapters.md):
a description of the *intended artifact* in artifact-independent terms. Its `kind` is a **result-kind**.

Here the spec must be honest about something the "by example" framing hid: a component-result, an
OpenAPI-result, and a ticket-result **do not share an internal structure** — "a component with these parts
bound to these roles" has nothing structurally in common with "an API with these endpoints and schemas". So
the normalized result is **not one shape**; it is a **tagged union over the shared envelope**: the envelope's
`kind` field is the *tag*, and it selects which result payload shape applies. The common part is the
envelope (every result-kind carries it); the variable part is the per-kind payload.

This is the shape that makes the **skill↔adapter typing** in [`adapters.md`](adapters.md) work: a
skill declares the result-`kind` it emits, an output adapter declares the result-`kind`s it accepts, and the
loader/`registry-lint` ([`skill-manifest-and-registry.md`](skill-manifest-and-registry.md)) checks the
pairing **on the tag alone** — no need to understand the payload. A skill that emits a `frontend-component`
result wired to an adapter that only accepts `openapi-spec` is a wiring error caught at start-up, not a
malformed artifact discovered at the end.

> **One rule the union must respect:** the envelope is **kind-agnostic** — its four fields mean the same
> thing for every result-kind. Only the payload varies. If a would-be result-kind needs to change the
> *envelope*, that is a change to *this* contract (a version bump), not a new union member.

---

## Byte-stability: the part that makes it testable

The normalized form is not merely "structured data"; it must be **byte-deterministic**. The same logical
input must serialize to the *same bytes* every time. This is the property that turns three separate promises
into mechanical checks:

- **A determinism gate** can serialize a normalized description twice and assert the bytes are identical (or
  diff them when they are not).
- **The prompt-prefix cost saving** (tier 2 in [`architecture-overview.md`](architecture-overview.md))
  only lands when the client prefix is byte-for-byte identical across runs; the normalized description *is*
  that prefix.
- **The `content-hash`** is meaningful only if the serialization it hashes is canonical — otherwise two
  byte-different-but-semantically-equal payloads get two hashes and the file-reuse / cache-validity logic in
  [`adapters.md`](adapters.md) silently misfires.

Byte-stability is therefore a **property of the contract**, not of any one adapter. Concretely it requires:
**stable key ordering**, **stable number and string formatting** (no locale drift, no float jitter), **no
timestamps, run IDs, or absolute machine paths** in the payload, and **no incidental whitespace churn**. The
`content-hash` is computed over this canonical serialization, so an identical hash is the cheap proxy for
"identical bytes" that the gates and the caches both read.

---

## Versioning the contract

Because the normalized form is the *only* language of the core, it will outlive any single adapter — so it
is versioned explicitly via the envelope's `schema-version`, and evolved by rules rather than by edits in
place:

- **Additive changes are minor.** Adding an *optional* payload field, or adding a brand-new `kind` (a new
  source-kind or result-kind / union member), does not break existing readers → bump the minor version. A
  new result-kind is the common case and stays cheap precisely because the envelope does not change.
- **Breaking changes are major.** Removing or renaming a field, changing a field's meaning, or changing the
  **envelope** (the kind-agnostic core) breaks existing readers → bump the major version. Two majors may
  need to coexist during a migration; the `schema-version` is what lets a reader pick the right rules.
- **The canonical serialization is part of the contract.** A change that alters the *bytes* of the same
  logical payload (key order, number format) is a breaking change even if the *fields* are unchanged —
  because it invalidates every `content-hash` and every cached prefix. Such a change is a major bump and is
  made deliberately, never as an incidental refactor.
- **Adapters declare the version they speak**, and the loader rejects a mismatch loudly (the
  "validate before acting" rule in [`loader-and-activation.md`](loader-and-activation.md)) rather than
  feeding the core a payload under rules it does not apply.

---

## Why this is the only language of the core — and how it proves genericity

Pulling the threads together: the core is generic **because** it touches nothing but the envelope and hands
the payload through. It type-checks wiring on `kind`, it validates rules on `schema-version`, it judges
"did anything change?" on `content-hash` — and it never parses a token, an issue, or an endpoint. All
source-/artifact-specific understanding lives in the adapters and the skill payloads. That is the whole
genericity claim, restated as a property of one data shape.

And now it is **testable**, in the two ways the audit asked for (the Verification subsection in
[`adapters.md`](adapters.md) / wires both into CI):

1. **Determinism (byte-diff).** Run the same input adapter on the same fixture twice; assert the two
   normalized descriptions serialize to identical bytes (equivalently, identical `content-hash`). A failure
   localizes to non-canonical serialization.
2. **Genericity (equivalence).** Feed one skill two equivalent sources via two different input adapters of
   the *same* source-kind; assert the assembled normalized **results** are equal **up to the envelope's
   `identity`/`content-hash`** (which legitimately differ) — i.e. the *payloads* match. Mirror on the output
   edge: two output adapters for one result-kind render two artifact *forms* of the **same** normalized
   result. Equality here is well-defined precisely because the result is a tagged union over a fixed
   envelope.

Neither test is writable without this contract. That is the point of writing it down.

---

## Takeaways

- The core speaks **exactly one language** — the **normalized form** — and now it is a *contract*, not an
  example.
- Every payload, on both edges, carries the **same envelope**: `kind`, `identity`, `content-hash`,
  `schema-version`.
- **Input edge** → a **normalized description** (one payload shape per source-kind). **Output edge** → a
  **normalized result**, a **tagged union** over the same envelope, tagged by result-`kind`.
- **Byte-stability** (canonical serialization → `content-hash`) is what makes determinism, cost-saving, and
  cache validity *mechanically checkable*.
- The contract is **versioned** (`schema-version`): additive = minor, field/envelope/serialization change =
  major; adapters declare their version and the loader enforces it.
- This shape is what makes **genericity and determinism testable** — the byte-diff and two-adapter
  equivalence gates in [`adapters.md`](adapters.md) are written against it.

---

## Related documents

- The contracts that **produce and consume** this shape (input/output adapters), runtime-failure semantics, and the skill↔adapter typing that keys off `kind`: [`adapters.md`](adapters.md)
- Where the normalized description sits in the prompt (tier 2, the stable client prefix) and why byte-stability is a cost lever: [`architecture-overview.md`](architecture-overview.md)
- The registry/`registry-lint` that validates the skill↔adapter `kind` pairing as data: [`skill-manifest-and-registry.md`](skill-manifest-and-registry.md)
- "Validate before acting" — the loader rejecting a `schema-version` or wiring mismatch at start-up: [`loader-and-activation.md`](loader-and-activation.md)
- Definitions of the terms used here: [`glossary.md`](glossary.md)
