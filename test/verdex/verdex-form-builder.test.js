// Verdex Financial — verdex-form-builder, Sprint 2 (CC-25: RTL/Arabic prose preservation).
//
// Sources: concept + first principles, zero third-party skills-factory files (clean-room).
//
// WHAT THIS PROVES. An instruction-kind skill whose SKILL.md description AND composed output carry
// Arabic (RTL) prose runs through the SAME engine, on its ASCII registry key, with the non-Latin
// text preserved verbatim. The engine is encoding-neutral: it routes on the key, never parses or
// transliterates the prose.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { runSkill } from "../../src/engine/run.js";
import { composeInstruction, ARABIC_TITLE } from "../../src/skills/verdex-form-builder/compose.js";

const CLIENTS_DIR = fileURLToPath(new URL("../../clients", import.meta.url));
const REGISTRY = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../skillforge.registry.json", import.meta.url)), "utf8"),
);

test("CC-25: verdex-form-builder composes and preserves the Arabic title in its output", async () => {
  const out = await runSkill({
    clientsDir: CLIENTS_DIR,
    client: "verdex",
    skillName: "verdex-form-builder",
    request: { formName: "Login" },
    registry: REGISTRY,
  });

  assert.equal(typeof out.instructions, "string");
  assert.ok(out.instructions.length > 0, "instructions must be non-empty");
  // The Arabic title survives the full pipeline byte-for-byte.
  assert.ok(out.instructions.includes(ARABIC_TITLE), "the Arabic title is preserved in the output");
  assert.match(out.instructions, /نموذج بناء/, "the literal Arabic prose round-trips unchanged");
  assert.match(out.instructions, /Verdex "Login" form/, "the request form name is woven in");

  // Instruction envelope — no artifact, no gate (governance:none).
  assert.equal(out.artifact, undefined, "an instruction skill emits no artifact");
  assert.equal(out.gate, undefined, "an instruction skill runs no gate (governance:none)");

  // Activation passed for the verdex client on the ASCII registry key.
  assert.equal(out.activation.skill, "verdex-form-builder");
  assert.equal(out.activation.client, "verdex");

  // The compose read the Verdex token set through the resolved tokenHub reference.
  assert.match(out.instructions, /--vx-/, "Verdex --vx- tokens are listed (token data reached compose)");
});

test("CC-25: the SKILL.md description contains the Arabic prose (registry key stays ASCII)", () => {
  const skillMd = readFileSync(
    fileURLToPath(new URL("../../skills/verdex-form-builder/SKILL.md", import.meta.url)),
    "utf8",
  );
  assert.match(skillMd, /نموذج بناء — يساعد في إنشاء نماذج ويب متوافقة مع معايير WCAG/, "Arabic description present");
  assert.match(skillMd, /^name: verdex-form-builder$/m, "the routing key is ASCII");
});

test("verdex-form-builder compose is synchronous and names no client value of its own", () => {
  // No async assembly needed; the executor awaits either shape. With no references every tier is
  // empty — proving the token literals arrive as DATA, not from the compose source (clean-room).
  const resolved = composeInstruction({ references: {}, request: { formName: "Empty" } });
  assert.ok(!(resolved instanceof Promise), "compose is a plain synchronous function");
  assert.match(resolved.instructions, /component tier, 0/, "no tokens without the reference data");
  assert.ok(resolved.instructions.includes(ARABIC_TITLE), "the Arabic title is present even with no data");
});
