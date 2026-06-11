// Verdex Advisor — Sprint 3 (CC-47: a sub-brand is a separate client config, not an engine change).
//
// Sources: concept + first principles, zero third-party skills-factory files (clean-room).
//
// WHAT THIS PROVES. The Verdex Advisor B2B sub-brand is onboarded by adding a SEPARATE client config
// + a small token override — NO engine code changes. The advisor client loads without error, runs a
// Verdex skill on its own resources, and its action-primary token DIFFERS from the base verdex token
// (a re-themed indigo for the data-dense advisor surface). This is the genericity model: one engine,
// swappable per-client data (docs/p3-client-concept.md §1 sub-brands).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { runSkill } from "../../src/engine/run.js";
import { loadClientConfig } from "../../src/loader/index.js";

const CLIENTS_DIR = fileURLToPath(new URL("../../clients", import.meta.url));
const REGISTRY = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../skillforge.registry.json", import.meta.url)), "utf8"),
);

function readTokens(client) {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(`../../clients/${client}/resources/tokens.json`, import.meta.url)), "utf8"),
  );
}

test("CC-47: the verdex-advisor sub-brand client loads without error", () => {
  const ctx = loadClientConfig({ clientsDir: CLIENTS_DIR, client: "verdex-advisor" });
  assert.equal(ctx.identifier, "verdex-advisor", "the advisor client resolves its identity");
  assert.ok(Array.isArray(ctx.skills) && ctx.skills.includes("verdex-analytics"), "it adopts a Verdex skill");
});

test("CC-47: a Verdex skill runs on the advisor client via runSkill (no engine change)", async () => {
  const out = await runSkill({
    clientsDir: CLIENTS_DIR,
    client: "verdex-advisor",
    skillName: "verdex-analytics",
    registry: REGISTRY,
  });
  // The analysis envelope reads the advisor's OWN token resources.
  assert.ok(out.report && typeof out.report === "object", "the skill returns a report on the advisor client");
  assert.equal(out.activation.client, "verdex-advisor", "activation bound to the sub-brand client");
  assert.ok(out.report.tierCounts.semantic > 0, "the advisor's own semantic tokens reached compose");
});

test("CC-47: the advisor's action-primary token DIFFERS from the base verdex token", () => {
  const base = readTokens("verdex");
  const advisor = readTokens("verdex-advisor");

  const baseAction = base.semantic["--vx-color-action-primary"].light;
  const advisorAction = advisor.semantic["--vx-color-action-primary"].light;

  assert.ok(baseAction, "base verdex defines an action-primary token");
  assert.ok(advisorAction, "advisor defines an action-primary token");
  assert.notEqual(
    advisorAction,
    baseAction,
    `the sub-brand re-themes the action hue (base=${baseAction}, advisor=${advisorAction})`,
  );
});
