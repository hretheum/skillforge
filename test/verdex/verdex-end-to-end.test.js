// Verdex Financial — end-to-end pipeline, Sprint 3 (P3 genericity proof).
//
// Sources: concept + first principles, zero third-party skills-factory files (clean-room).
//
// WHAT THIS PROVES. The engine handles the full Verdex multi-skill, multi-KIND client end to end:
// every skill the verdex client adopts runs through runSkill() to a successful envelope, emits a
// PASS skill_result (OBS-04), and throws no error. Three skill kinds are exercised in one client —
// instruction (verdex-create-component, verdex-form-builder), analysis (verdex-analytics), and
// validation (verdex-disclosure-check) — which is the P3 genericity claim: one generic engine,
// swappable per-client data, serving a regulated multi-kind client with no code change.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { runSkill } from "../../src/engine/run.js";
import { SKILL_RESULT } from "../../src/governance/skill-result.js";

const CLIENTS_DIR = fileURLToPath(new URL("../../clients", import.meta.url));
const REGISTRY = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../skillforge.registry.json", import.meta.url)), "utf8"),
);
const CLIENT_CONFIG = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../clients/verdex/config.json", import.meta.url)), "utf8"),
);

// Per-skill request shaping: most Verdex skills read client references and need no request, but the
// validation pairing needs a disclosure to judge. Keep this a DATA map (skill name → request).
const REQUESTS = {
  "verdex-disclosure-check": {
    disclosure:
      "Risk warning: your capital is at risk. A 0.45% platform fee applies. " +
      "Verdex is authorised and regulated by the FCA under MiFID II.",
  },
};

// The kinds we expect each skill's successful envelope to evidence (a discriminating field per kind).
const KIND_EVIDENCE = {
  "verdex-create-component": (out) => out.instructions !== undefined,
  "verdex-form-builder": (out) => out.instructions !== undefined,
  "verdex-analytics": (out) => out.report !== undefined,
  "verdex-disclosure-check": (out) => typeof out.pass === "boolean" && Array.isArray(out.violations),
};

test("every Verdex skill runs end to end, returns a successful envelope, and emits a PASS skill_result", async () => {
  const adopted = CLIENT_CONFIG.skills;
  assert.ok(adopted.length >= 4, `the verdex client adopts the full skill set (got ${adopted.length})`);

  for (const skillName of adopted) {
    const results = [];
    const out = await runSkill({
      clientsDir: CLIENTS_DIR,
      client: "verdex",
      skillName,
      registry: REGISTRY,
      request: REQUESTS[skillName] ?? null,
      skillResultSink: (event) => results.push(event),
    });

    assert.ok(out && typeof out === "object", `${skillName}: returns an envelope`);
    assert.equal(out.activation.skill, skillName, `${skillName}: activated on its own key`);
    assert.equal(out.activation.client, "verdex", `${skillName}: activated on the verdex client`);

    const evidence = KIND_EVIDENCE[skillName];
    assert.ok(evidence, `${skillName}: has expected-kind evidence in the test map`);
    assert.ok(evidence(out), `${skillName}: the envelope evidences its declared kind`);

    // OBS-04: a successful run emits exactly one PASS skill_result, no FAIL.
    const passes = results.filter((e) => e.outcome === SKILL_RESULT.PASS);
    assert.equal(passes.length, 1, `${skillName}: emits exactly one PASS skill_result`);
    assert.ok(
      !results.some((e) => e.outcome === SKILL_RESULT.FAIL),
      `${skillName}: emits no FAIL skill_result`,
    );
    assert.equal(passes[0].skill, skillName, `${skillName}: the PASS event names the skill`);
    assert.equal(passes[0].client, "verdex", `${skillName}: the PASS event names the client`);
  }
});

test("the Verdex client exercises at least three distinct skill kinds (multi-kind genericity)", () => {
  const kinds = new Set(CLIENT_CONFIG.skills.map((name) => REGISTRY.skills[name].skillKind));
  assert.ok(kinds.size >= 3, `expected ≥3 distinct kinds, got ${[...kinds].join(", ")}`);
  assert.ok(kinds.has("validation"), "the compliance pairing adds the validation kind");
});
