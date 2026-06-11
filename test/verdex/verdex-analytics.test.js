// Verdex Financial — verdex-analytics, Sprint 2 (CC-29: katakana title in SKILL.md).
//
// Sources: concept + first principles, zero third-party skills-factory files (clean-room).
//
// WHAT THIS PROVES. An analysis-kind skill titled in Japanese katakana runs through the SAME engine
// on its ASCII registry key, returns a read-only {report} envelope (no artifact, no gate), and
// preserves the non-Latin title in the report. Confirms the analysis kind's read-only discriminator
// (CC-16) and encoding-neutrality (CC-29).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { runSkill } from "../../src/engine/run.js";
import { composeAnalysis, KATAKANA_TITLE } from "../../src/skills/verdex-analytics/compose.js";

const CLIENTS_DIR = fileURLToPath(new URL("../../clients", import.meta.url));
const REGISTRY = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../skillforge.registry.json", import.meta.url)), "utf8"),
);

test("CC-29: verdex-analytics returns a report envelope preserving the katakana title", async () => {
  const out = await runSkill({
    clientsDir: CLIENTS_DIR,
    client: "verdex",
    skillName: "verdex-analytics",
    registry: REGISTRY,
  });

  // The analysis envelope (analysisDescriptor.envelope): {report, activation} — no artifact/gate.
  assert.ok(out.report && typeof out.report === "object", "an analysis skill returns a report object");
  assert.equal(out.report.title, KATAKANA_TITLE, "the katakana title is preserved in the report");
  assert.equal(out.artifact, undefined, "an analysis skill emits no artifact");
  assert.equal(out.gate, undefined, "an analysis skill runs no gate (governance:none)");

  // Activation passed on the ASCII registry key.
  assert.equal(out.activation.skill, "verdex-analytics");
  assert.equal(out.activation.client, "verdex");

  // The compose read the Verdex token set: all three tiers have non-zero counts.
  assert.ok(out.report.tierCounts.primitive > 0, "primitive tier counted (token data reached compose)");
  assert.ok(out.report.tierCounts.semantic > 0, "semantic tier counted");
  assert.ok(out.report.tierCounts.component > 0, "component tier counted");
});

test("CC-29: the SKILL.md title contains the katakana (registry key stays ASCII)", () => {
  const skillMd = readFileSync(
    fileURLToPath(new URL("../../skills/verdex-analytics/SKILL.md", import.meta.url)),
    "utf8",
  );
  assert.match(skillMd, /# アナリティクス — Verdex Analytics Dashboard Skill/, "katakana title present");
  assert.match(skillMd, /^name: verdex-analytics$/m, "the routing key is ASCII");
});

test("verdex-analytics compose returns a {report} object and names no client value of its own", () => {
  const out = composeAnalysis({ references: {} });
  assert.ok(out.report && typeof out.report === "object", "returns {report}");
  assert.equal(out.report.tierCounts.primitive, 0, "no tokens without the reference data");
  assert.equal(out.report.title, KATAKANA_TITLE, "the katakana title is present even with no data");
});
