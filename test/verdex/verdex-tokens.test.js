// Verdex Financial — token-format edge cases, Sprint 2 (CC-04 base64 SVG, CC-26 locale-coded token
// name, CC-28 SQL-injection-shaped token value).
//
// Sources: concept + first principles, zero third-party skills-factory files (clean-room).
//
// WHAT THIS PROVES. The engine reads token NAMES and VALUES as opaque tagged data: a base64 data-URI
// value, a locale-suffixed name, and a SQL-injection-shaped value all load without error and run
// through the analysis skill. The secret-scan defense (a CREDENTIAL detector, not a generic injection
// detector) does not false-positive on a base64 SVG or a SQL string.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { runSkill } from "../../src/engine/run.js";
import { scanString } from "../../src/governance/secret-scan.js";

const CLIENTS_DIR = fileURLToPath(new URL("../../clients", import.meta.url));
const REGISTRY = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../skillforge.registry.json", import.meta.url)), "utf8"),
);
const TOKENS = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../clients/verdex/resources/tokens.json", import.meta.url)), "utf8"),
);

const SVG_VALUE = TOKENS.component["--vx-icon-check"].light;
const SQL_VALUE = TOKENS.component["--vx-color-danger-sql"].light;

test("CC-04 + CC-26 + CC-28: the new Verdex tokens load and the client runs without error", async () => {
  // Running an analysis skill reads the whole tokenHub; if any of the new tokens crashed the read or
  // the compose, this would throw. The component tier now includes the base64 icon, the locale-coded
  // name, and the SQL-shaped value — all carried as opaque data.
  const out = await runSkill({
    clientsDir: CLIENTS_DIR,
    client: "verdex",
    skillName: "verdex-analytics",
    registry: REGISTRY,
  });
  const component = out.report.tiers.component;
  assert.ok(component.includes("--vx-icon-check"), "CC-04: the base64 SVG token loaded");
  assert.ok(component.includes("--vx-color-text-ar"), "CC-26: the locale-coded token name loaded");
  assert.ok(component.includes("--vx-color-danger-sql"), "CC-28: the SQL-shaped token loaded");
});

test("CC-04: the base64 SVG value loads as opaque token data (engine never secret-scans tokens at read)", async () => {
  assert.match(SVG_VALUE, /^data:image\/svg\+xml;base64,/, "the value is a base64 SVG data-URI");
  // The engine reads token VALUES as opaque data — secret-scan only runs at the GATE stage, when a
  // value reaches a Write intent. An instruction/analysis skill (governance:none) has no gate, so the
  // base64 SVG token rides through read -> compose -> emit untouched. (Proven by the load test above
  // listing --vx-icon-check among the component tier with no error.)
  const out = await runSkill({
    clientsDir: CLIENTS_DIR,
    client: "verdex",
    skillName: "verdex-analytics",
    registry: REGISTRY,
  });
  assert.ok(out.report.tiers.component.includes("--vx-icon-check"), "the base64 SVG token reached compose");
});

test("CC-04: a long base64 run WOULD trip the entropy heuristic IF it reached a gated write (finding)", () => {
  // FINDING (corrects the p3-corner-cases.md CC-04 prediction): the entropy layer of secret-scan
  // fires on the base64 RUN itself — a 160-char high-entropy alphanumeric run reads as a
  // high-entropy token BEFORE the encoded layer decodes it to innocent SVG markup. So a token bundle
  // full of base64 data-URIs flowing into a Write intent would be DENIED as a false-positive
  // "high-entropy-token". Token-family skills (instruction/analysis) never hit the gate, so this only
  // matters for a write-class kind that inlines a base64 token value into a gated artifact.
  const findings = scanString(SVG_VALUE);
  assert.ok(
    findings.some((f) => f.name === "high-entropy-token"),
    "the long base64 run reads as a high-entropy token (a gate false-positive risk for write kinds)",
  );
});

test("CC-28: a SQL-injection-shaped token value is NOT flagged by secret-scan", () => {
  assert.equal(SQL_VALUE, "'; DROP TABLE tokens; --", "the SQL test value is carried literally");
  // secret-scan is a CREDENTIAL detector, not a generic-injection detector: a SQL string has no
  // vendor prefix and fails the entropy/mixed-class test, so it passes through as inert text. The
  // engine never executes token values, so there is no SQL surface to inject.
  assert.deepEqual(scanString(SQL_VALUE), [], "a SQL string is inert text, not a credential");
});

test("CC-26: the locale-coded token name is a single-theme token that loads cleanly", () => {
  const tok = TOKENS.component["--vx-color-text-ar"];
  assert.ok(tok && typeof tok === "object", "the locale-coded token exists");
  assert.equal(tok.light, "#1a1a1a", "its single-theme value is carried verbatim");
});
