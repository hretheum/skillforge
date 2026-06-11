// Telemetry resource attributes — the skill+client session injection (T-P4-03 / OBS-01,
// docs/10 §"Where the `skill` and `client` dimensions come from", path 1).
//
// Sources: concept + first principles, zero third-party skills-factory files (clean-room).
//
// WHAT THIS PROVES.
//   1. sessionResourceAttributes stamps exactly `skillforge.skill` + `skillforge.client` — the two
//      missing slicing dimensions the native runtime metrics lack.
//   2. The serialization is the standard OTEL `OTEL_RESOURCE_ATTRIBUTES` string, byte-stable.
//   3. resourceAttributesEnv is OPT-IN: a no-op (null) unless the master switch is on, and it
//      APPENDS to any existing attributes (never clobbers the runtime's native ones).
//   4. SECRET-FREE: a credential-shaped value is refused (fail-closed) — telemetry never leaks.
//   5. The run-level telemetrySink emits the attributes per run, secret-free, best-effort.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  TELEMETRY_ATTR,
  OTEL_RESOURCE_ATTRIBUTES_ENV,
  sessionResourceAttributes,
  resourceAttributesString,
  resourceAttributesEnv,
} from "../src/core/telemetry.js";
import { hasSecret } from "../src/governance/secret-scan.js";
import { runSkill } from "../src/engine/run.js";

// --- unit: the attribute builder ----------------------------------------------------------

test("sessionResourceAttributes stamps exactly skillforge.skill + skillforge.client", () => {
  const attrs = sessionResourceAttributes({ skill: "create-component", client: "example-studio" });
  assert.deepEqual(attrs, {
    [TELEMETRY_ATTR.SKILL]: "create-component",
    [TELEMETRY_ATTR.CLIENT]: "example-studio",
  });
  assert.equal(TELEMETRY_ATTR.SKILL, "skillforge.skill");
  assert.equal(TELEMETRY_ATTR.CLIENT, "skillforge.client");
});

test("sessionResourceAttributes requires a non-empty skill and client", () => {
  assert.throws(() => sessionResourceAttributes({ skill: "", client: "example-studio" }), /non-empty skill/);
  assert.throws(() => sessionResourceAttributes({ skill: "create-component", client: "" }), /non-empty client/);
});

test("sessionResourceAttributes refuses delimiters that would corrupt the OTEL envelope", () => {
  assert.throws(() => sessionResourceAttributes({ skill: "a,b", client: "example-studio" }), /must not contain/);
  assert.throws(() => sessionResourceAttributes({ skill: "create-component", client: "a=b" }), /must not contain/);
});

test("sessionResourceAttributes is SECRET-FREE: a credential-shaped value is refused (fail-closed)", () => {
  // A long, high-entropy token-shaped value in the client handle must be refused — telemetry is
  // never a secret-leak surface (docs/10 + docs/11), the same posture as the skill_result event.
  //
  // CLEAN-ROOM NOTE (why this is synthesized, not a literal). Proving the refusal genuinely needs a
  // value the secret-scan heuristic FLAGS — an "obviously fake" low-entropy string like
  // "fake-token" would NOT be flagged, so the assertion would be a tautology. So the value is
  // GENERATED at runtime from harmless character classes; NO credential-shaped literal sits in the
  // tracked tree (the secret-scan gate stays green on this file), yet the test exercises a REAL
  // refusal. We first assert the generated value is actually secret-scan-flagged, so the test
  // self-documents that it is not testing an inert string.
  const secretish = makeFlaggableTokenShapedValue();
  assert.ok(hasSecret(secretish), "guard: the synthesized value must be one secret-scan actually flags (not an inert string)");
  assert.throws(() => sessionResourceAttributes({ skill: "create-component", client: secretish }), /credential-shaped/);
});

// Build a long, mixed-case, high-entropy token-shaped string AT RUNTIME (never a source literal), so
// this test exercises the secret-scan refusal without planting a credential-shaped value in the repo
// (which the secret-scan gate would, correctly, flag). The shape — length, mixed case + digits, high
// entropy — is what the secret-scan heuristic keys on; the bytes are deterministic but not a literal.
function makeFlaggableTokenShapedValue() {
  const lowers = "abcdefghijklmnopqrstuvwxyz";
  const uppers = lowers.toUpperCase();
  const digits = "0123456789";
  let out = "";
  for (let i = 0; i < 14; i++) {
    out += lowers[(i * 7 + 3) % 26];
    out += uppers[(i * 5 + 1) % 26];
    out += digits[(i * 3) % 10];
  }
  return out; // 42 chars, all three classes, high entropy → token-shaped, NOT a real secret
}

test("resourceAttributesString is the standard OTEL string, byte-stable + fixed key order", () => {
  const s = resourceAttributesString({ skill: "create-component", client: "example-studio" });
  assert.equal(s, "skillforge.skill=create-component,skillforge.client=example-studio");
  // Deterministic: same inputs → same bytes (skill before client, independent of object iteration).
  assert.equal(s, resourceAttributesString({ client: "example-studio", skill: "create-component" }));
});

// --- unit: opt-in / no-op env injection ---------------------------------------------------

test("resourceAttributesEnv is a NO-OP unless the master switch is on (opt-in)", () => {
  const session = { skill: "create-component", client: "example-studio" };
  assert.equal(resourceAttributesEnv(session, {}), null, "telemetry off → null (run untouched)");
  assert.equal(resourceAttributesEnv(session, { CLAUDE_CODE_ENABLE_TELEMETRY: "0" }), null);
  const on = resourceAttributesEnv(session, { CLAUDE_CODE_ENABLE_TELEMETRY: "1" });
  assert.deepEqual(on, { [OTEL_RESOURCE_ATTRIBUTES_ENV]: "skillforge.skill=create-component,skillforge.client=example-studio" });
});

test("resourceAttributesEnv APPENDS to existing attributes (preserves the runtime's native ones)", () => {
  const env = {
    CLAUDE_CODE_ENABLE_TELEMETRY: "true",
    [OTEL_RESOURCE_ATTRIBUTES_ENV]: "service.name=claude-code,deployment.environment=ci",
  };
  const out = resourceAttributesEnv({ skill: "create-component", client: "example-studio" }, env);
  assert.equal(
    out[OTEL_RESOURCE_ATTRIBUTES_ENV],
    "service.name=claude-code,deployment.environment=ci,skillforge.skill=create-component,skillforge.client=example-studio",
    "skillforge attrs are appended; the existing ones are not clobbered",
  );
});

// --- integration: the run emits the attributes through the telemetrySink -------------------

const REPO_CLIENTS_DIR = fileURLToPath(new URL("../clients", import.meta.url));
const REGISTRY = JSON.parse(
  readFileSync(fileURLToPath(new URL("../skillforge.registry.json", import.meta.url)), "utf8"),
);
const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

function makeClientsDir() {
  const root = mkdtempSync(join(tmpdir(), "sf-telemetry-"));
  const dir = join(root, "clients");
  cpSync(join(REPO_CLIENTS_DIR, "example-studio"), join(dir, "example-studio"), { recursive: true });
  mkdirSync(join(dir, "example-studio", "resources"), { recursive: true });
  writeFileSync(
    join(dir, "example-studio", "resources", "example-studio.tokens.json"),
    readFileSync(fixture("dtcg-example-studio.tokens.json"), "utf8"),
  );
  return { root, dir };
}

const BC_REQUEST = {
  componentName: "Button",
  element: "button",
  baseClass: "hbtn",
  variants: [{ prop: "size", value: "s", class: "hbtn--sm" }],
  decorations: [{ element: "span", class: "sq", ariaHidden: true }],
  sourceClasses: ["hbtn", "hbtn--sm", "sq"],
};

test("run emits the per-session resource attributes through the telemetrySink (secret-free)", async () => {
  const { root, dir } = makeClientsDir();
  try {
    const emitted = [];
    await runSkill({
      clientsDir: dir,
      client: "example-studio",
      skillName: "create-component",
      request: BC_REQUEST,
      registry: REGISTRY,
      policyLayers: { org: [{ pattern: "Write", decision: "allow" }] },
      telemetrySink: (a) => emitted.push(a),
    });
    assert.equal(emitted.length, 1, "one telemetry emission per run");
    const { resourceAttributes } = emitted[0];
    assert.equal(resourceAttributes[TELEMETRY_ATTR.SKILL], "create-component");
    assert.equal(resourceAttributes[TELEMETRY_ATTR.CLIENT], "example-studio");

    // No content leak: the emission carries the skill + client HANDLE + opaque hashes only — never
    // token values, class names, or artifact source.
    const serialized = JSON.stringify(emitted[0]);
    assert.doesNotMatch(serialized, /hbtn|#e5232b|color\.semantic|HTMLElement|forwardRef/, "no client content in telemetry");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("run with NO telemetrySink does not change behavior (opt-in / no-op)", async () => {
  const { root, dir } = makeClientsDir();
  try {
    // No sink: the run completes normally and returns its artifact (telemetry is additive).
    const out = await runSkill({
      clientsDir: dir,
      client: "example-studio",
      skillName: "create-component",
      request: BC_REQUEST,
      registry: REGISTRY,
      policyLayers: { org: [{ pattern: "Write", decision: "allow" }] },
    });
    assert.equal(out.artifact.filename, "Button.tsx");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a throwing telemetrySink never fails the run (best-effort)", async () => {
  const { root, dir } = makeClientsDir();
  try {
    const out = await runSkill({
      clientsDir: dir,
      client: "example-studio",
      skillName: "create-component",
      request: BC_REQUEST,
      registry: REGISTRY,
      policyLayers: { org: [{ pattern: "Write", decision: "allow" }] },
      telemetrySink: () => { throw new Error("collector is down"); },
    });
    assert.equal(out.artifact.filename, "Button.tsx", "a broken telemetry sink does not take down the generation");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
