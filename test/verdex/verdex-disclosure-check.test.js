// Verdex Financial — verdex-disclosure-check, Sprint 3 (MiFID II compliance pairing).
//
// Sources: concept + first principles, zero third-party skills-factory files (clean-room).
//
// WHAT THIS PROVES. A validation-kind skill runs through the SAME engine on the verdex client,
// returns a read-only {pass, violations} verdict (no artifact, no gate, governance:none), and
// correctly distinguishes a MiFID-II-complete disclosure (PASS) from one missing a required section
// (FAIL). This is the compliance pairing docs/p3-client-concept.md §4 requires for a ⚖ disclosure.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { runSkill } from "../../src/engine/run.js";
import { composeValidation, REQUIRED_SECTIONS } from "../../src/skills/verdex-disclosure-check/compose.js";

const CLIENTS_DIR = fileURLToPath(new URL("../../clients", import.meta.url));
const REGISTRY = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../skillforge.registry.json", import.meta.url)), "utf8"),
);

const COMPLIANT_DISCLOSURE =
  "Risk warning: your capital is at risk and the value of investments may go down. " +
  "Costs and charges: a 0.45% annual platform fee applies. " +
  "Verdex Holdings PLC is authorised and regulated by the FCA under MiFID II.";

test("verdex-disclosure-check runs via runSkill and returns a {pass, violations} verdict", async () => {
  const out = await runSkill({
    clientsDir: CLIENTS_DIR,
    client: "verdex",
    skillName: "verdex-disclosure-check",
    registry: REGISTRY,
    request: { disclosure: COMPLIANT_DISCLOSURE },
  });

  // The validation envelope (validationDescriptor.envelope): {pass, violations, activation}.
  assert.equal(typeof out.pass, "boolean", "a validation skill returns a boolean verdict");
  assert.ok(Array.isArray(out.violations), "a validation skill returns a violations array");
  assert.equal(out.artifact, undefined, "a validation skill emits no artifact");
  assert.equal(out.gate, undefined, "a validation skill runs no gate (governance:none)");
  assert.equal(out.activation.skill, "verdex-disclosure-check");
  assert.equal(out.activation.client, "verdex");
});

test("a MiFID-II-complete disclosure PASSES with no violations", async () => {
  const out = await runSkill({
    clientsDir: CLIENTS_DIR,
    client: "verdex",
    skillName: "verdex-disclosure-check",
    registry: REGISTRY,
    request: { disclosure: COMPLIANT_DISCLOSURE },
  });
  assert.equal(out.pass, true, "all three required sections present → PASS");
  assert.deepEqual(out.violations, [], "no missing-section violations");
});

test("a disclosure missing the cost section FAILS, naming the missing section", async () => {
  const out = await runSkill({
    clientsDir: CLIENTS_DIR,
    client: "verdex",
    skillName: "verdex-disclosure-check",
    registry: REGISTRY,
    request: {
      disclosure:
        "Risk warning: capital at risk. Verdex is regulated by the FCA under MiFID II.",
    },
  });
  assert.equal(out.pass, false, "a missing required section → FAIL");
  assert.ok(
    out.violations.some((v) => /cost disclosure/.test(v)),
    `the missing cost-disclosure section is named — got: ${JSON.stringify(out.violations)}`,
  );
});

test("compose: an empty disclosure fails every required section", () => {
  const out = composeValidation({ request: { disclosure: "" } });
  assert.equal(out.pass, false);
  assert.equal(out.violations.length, REQUIRED_SECTIONS.length, "one violation per required section");
});

test("compose: a structured (object) disclosure has its string leaves searched", () => {
  const out = composeValidation({
    request: {
      disclosure: {
        riskBlock: "Risk warning: your capital may go down.",
        costBlock: "A platform fee of 0.45% applies.",
        legalBlock: "Authorised and regulated by the FCA (MiFID II).",
      },
    },
  });
  assert.equal(out.pass, true, "object leaves are concatenated and searched → PASS");
});
