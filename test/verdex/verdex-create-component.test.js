// Verdex Financial — the P3 genericity client, Sprint 1 (/128/129).
//
// Sources: concept + first principles, zero third-party skills-factory files (clean-room).
// See docs/p3-client-concept.md (Verdex) and docs/p3-corner-cases.md (CC-09 async compose).
//
// WHAT THIS PROVES. A third client (verdex) runs through the SAME engine with NO engine-code change
// beyond the two corner-case fixes (CC-09 async compose, CC-19 no silent default). verdex-create-
// component is an INSTRUCTION-kind skill whose compose is GENUINELY ASYNC — so this test exercises
// the awaited-compose path end-to-end. Verdex is a fictional client (no confidential token VALUES),
// so it runs against the committed clients/ directory verbatim, like glasshouse (no fixture overlay).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { runSkill } from "../../src/engine/run.js";
import { composeInstruction } from "../../src/skills/verdex-create-component/compose.js";

const CLIENTS_DIR = fileURLToPath(new URL("../../clients", import.meta.url));
const REGISTRY = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../skillforge.registry.json", import.meta.url)), "utf8"),
);

test("runSkill (verdex): verdex-create-component activates and composes the instruction envelope", async () => {
  const out = await runSkill({
    clientsDir: CLIENTS_DIR,
    client: "verdex",
    skillName: "verdex-create-component",
    request: { componentName: "Button" },
    registry: REGISTRY,
  });

  // The instruction envelope (instructionDescriptor.envelope) — no artifact/gate (governance:none).
  assert.equal(typeof out.instructions, "string");
  assert.ok(out.instructions.length > 0, "instructions must be non-empty");
  assert.match(out.instructions, /Verdex "Button"/, "the request component name is woven in");
  assert.equal(out.artifact, undefined, "an instruction skill emits no artifact");
  assert.equal(out.gate, undefined, "an instruction skill runs no gate (governance:none)");

  // Activation passed for the verdex client.
  assert.equal(out.activation.skill, "verdex-create-component");
  assert.equal(out.activation.client, "verdex");

  // The compose read the Verdex --vx- token set through the resolved tokenHub reference and listed
  // all three tiers (proves the client's real token data reached compose).
  assert.match(out.instructions, /--vx-btn-bg-default/, "a component-tier token is listed");
  assert.match(out.instructions, /--vx-color-action-primary/, "a semantic-tier token is listed");
  assert.match(out.instructions, /--vx-palette-blue-500/, "a primitive-tier token is listed");
});

test("CC-09: the verdex compose is GENUINELY ASYNC and the engine awaits it", async () => {
  // The compose returns a Promise; if the executor did not await it, validateOutput would see a
  // Promise (no `instructions` string) and the run would fail the contract. A clean run proves the
  // awaited-compose path. Also assert the compose function is async at the source.
  const direct = composeInstruction({ references: {}, request: { componentName: "X" } });
  assert.ok(direct instanceof Promise, "compose returns a Promise (it is async)");
  const resolved = await direct;
  assert.equal(typeof resolved.instructions, "string");

  // End-to-end: the awaited compose produces a valid instruction envelope (no Promise leak).
  const out = await runSkill({
    clientsDir: CLIENTS_DIR,
    client: "verdex",
    skillName: "verdex-create-component",
    registry: REGISTRY,
  });
  assert.equal(typeof out.instructions, "string", "the awaited compose resolved to a real envelope");
});

test("CC-05: a token that is null in a theme is reported as an omitted property, not a value", async () => {
  // The Verdex token set has --vx-color-overlay null in dark/hc-dark and --vx-elevation-shadow null
  // in the hc-* themes. The compose reports these as "omit this property" per theme — a legal state.
  const out = await runSkill({
    clientsDir: CLIENTS_DIR,
    client: "verdex",
    skillName: "verdex-create-component",
    registry: REGISTRY,
  });
  assert.match(out.instructions, /omit "--vx-color-overlay"/, "a null-in-theme token is reported as omitted");
  assert.match(out.instructions, /omit "--vx-elevation-shadow"/, "the hc-theme null shadow is reported as omitted");
  // The literal "null" must NOT be emitted as a token value anywhere in the guidance.
  assert.doesNotMatch(out.instructions, /:\s*null/, "null is never emitted as a value");
});

test("the verdex compose names no client value of its own (clean-room: data arrives via references)", async () => {
  // With NO references, every tier is empty — proving the token literals come from the resolved
  // reference DATA, not from the compose source. (CC-42-adjacent: missing data degrades cleanly.)
  const resolved = await composeInstruction({ references: {}, request: { componentName: "Empty" } });
  assert.match(resolved.instructions, /Component tokens \(0\)/, "no tokens without the reference data");
  assert.match(resolved.instructions, /Semantic tokens \(0\)/);
  assert.match(resolved.instructions, /Primitive tokens \(0\)/);
});
