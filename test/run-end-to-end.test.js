// The MVP keystone — the full end-to-end run (T-MVP-12).
//
// Sources: concept + first principles, zero third-party skills-factory files (clean-room).
// docs/05 §life-cycle + docs/02 §the-path. Asserts: a "create a component" request for the
// Example Studio client produces a correct React artifact compliant with the DS, having passed
// BOTH the activation predicate (T-MVP-11) AND the PreToolUse tool gate (T-MVP-05).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { runSkill } from "../src/engine/run.js";
import { createPreToolUseHook, HOOK_DECISION } from "../src/governance/index.js";

const REPO_CLIENTS_DIR = fileURLToPath(new URL("../clients", import.meta.url));
const FIXTURE_TOKENS = fileURLToPath(new URL("./fixtures/dtcg-example-studio.tokens.json", import.meta.url));
const REGISTRY = JSON.parse(
  readFileSync(fileURLToPath(new URL("../skillforge.registry.json", import.meta.url)), "utf8"),
);
const GOLDEN_ARTIFACT = readFileSync(
  fileURLToPath(new URL("./fixtures/react-golden-Button.tsx", import.meta.url)),
  "utf8",
);

// The committed BC client resource (clients/example-studio/resources/example-studio.tokens.json) is a
// PLACEHOLDER by design — the real brand values are CLIENT DATA that lives in the input-adapter
// fixture, not in the engine repo (clean-room: client knowledge stays out of the generic
// engine). To exercise the real end-to-end path with real tokens, we build a TEMP clients dir
// that copies the BC config but points its tokenHub reference at the real DTCG fixture. This
// tests the full chain (loader → input adapter → compose → output adapter → gate) on real data
// without writing client values into the committed engine tree.
let CLIENTS_DIR;
let TMP_ROOT;

before(() => {
  TMP_ROOT = mkdtempSync(join(tmpdir(), "sf-e2e-"));
  CLIENTS_DIR = join(TMP_ROOT, "clients");
  const bcDir = join(CLIENTS_DIR, "example-studio");
  // Copy the committed BC client subtree, then overlay real tokens at the tokenHub address.
  cpSync(join(REPO_CLIENTS_DIR, "example-studio"), bcDir, { recursive: true });
  mkdirSync(join(bcDir, "resources"), { recursive: true });
  // The BC config's tokenHub is "./resources/example-studio.tokens.json" — overwrite that target
  // with the real DTCG fixture so the input adapter reads genuine roles/tokens.
  writeFileSync(join(bcDir, "resources", "example-studio.tokens.json"), readFileSync(FIXTURE_TOKENS, "utf8"));
});

after(() => {
  if (TMP_ROOT) rmSync(TMP_ROOT, { recursive: true, force: true });
});

// The deployment's tool policy: the org baseline authorizes the engine to WRITE component
// artifacts (docs/13 Layer 1). The resolver is deny-first — a legitimate write needs this
// affirmative allow; the skill's requiredTools is only a clamp (T-HARD-11). This is deployment
// policy DATA, supplied by the run's caller, not engine code.
const POLICY_LAYERS = { org: [{ pattern: "Write", decision: "allow" }] };

// The Button request that, against the BC design system, yields the golden artifact.
function buttonRequest() {
  return {
    componentName: "Button",
    element: "button",
    baseClass: "hbtn",
    variants: [
      { prop: "size", value: "s", class: "hbtn--sm" },
      { prop: "variant", value: "acc", class: "hbtn--acc", role: "color.semantic.accent" },
    ],
    decorations: [{ element: "span", class: "sq", ariaHidden: true }],
    sourceClasses: ["hbtn", "hbtn--acc", "hbtn--sm", "sq"],
  };
}

test("KEYSTONE: BC 'create a component' produces the golden React artifact through activation + tool gate", async () => {
  const out = await runSkill({
    clientsDir: CLIENTS_DIR,
    client: "example-studio",
    skillName: "create-component",
    request: buttonRequest(),
    registry: REGISTRY,
    policyLayers: POLICY_LAYERS,
  });

  // The artifact is correct and DS-compliant (byte-identical to the golden).
  assert.equal(out.artifact.filename, "Button.tsx");
  assert.equal(out.artifact.language, "tsx");
  assert.equal(out.artifact.source, GOLDEN_ARTIFACT, "end-to-end artifact drifted from the golden React wrapper");
  assert.deepEqual(out.artifact.sourceClasses, ["hbtn", "hbtn--acc", "hbtn--sm", "sq"]);

  // It passed the activation predicate (T-MVP-11).
  assert.equal(out.activation.skill, "create-component");
  assert.equal(out.activation.client, "example-studio");

  // It passed the tool gate (T-MVP-05) — the artifact write was allowed (not denied).
  assert.notEqual(out.gate.decision, HOOK_DECISION.DENY);

  // The normalized result is tagged frontend-component (the skill↔adapter pairing).
  assert.equal(out.result.envelope.kind, "frontend-component");
  // The design system was actually read (input adapter ran): roles present.
  assert.equal(out.description.envelope.kind, "design-system");
  assert.ok(out.description.payload.roles.some((r) => r.name === "color.semantic.accent"));
});

test("a skill the client has not adopted does not run (activation deny, no artifact)", async () => {
  await assert.rejects(
    () =>
      runSkill({
        clientsDir: CLIENTS_DIR,
        client: "example-studio",
        skillName: "not-adopted-skill",
        request: buttonRequest(),
        registry: REGISTRY,
      }),
    (e) => e.gate === "client-has-skill",
  );
});

test("a DS-non-compliant request (role the DS lacks) fails before any artifact", async () => {
  const req = buttonRequest();
  req.variants[1].role = "color.semantic.does-not-exist";
  await assert.rejects(
    () => runSkill({ clientsDir: CLIENTS_DIR, client: "example-studio", skillName: "create-component", request: req, registry: REGISTRY }),
    /does not define|not DS-compliant/,
  );
});

test("the tool gate is in the loop: a deny hook blocks the run (no artifact)", async () => {
  // A hook that denies every Write — proves governance is on the happy path, not bypassed.
  const denyHook = createPreToolUseHook({
    resolver: { resolve: () => "deny" },
  });
  await assert.rejects(
    () =>
      runSkill({
        clientsDir: CLIENTS_DIR,
        client: "example-studio",
        skillName: "create-component",
        request: buttonRequest(),
        registry: REGISTRY,
        preToolUseHook: denyHook,
        policyLayers: POLICY_LAYERS,
      }),
    /denied at the PreToolUse gate/,
  );
});

test("DENY-FIRST: a project-layer deny overrides the org-baseline allow (deny-first meet)", async () => {
  // The skill requires Write and the client's config orgBaseline allows it, but an explicit
  // project-layer deny wins under the deny-first meet (deny ⊓ allow = deny). Proves the run does
  // not permit a write a higher-precedence layer forbids — the gate is the enforcement boundary.
  await assert.rejects(
    () =>
      runSkill({
        clientsDir: CLIENTS_DIR,
        client: "example-studio",
        skillName: "create-component",
        request: buttonRequest(),
        registry: REGISTRY,
        policyLayers: { project: [{ pattern: "Write", decision: "deny" }] },
      }),
    /denied at the PreToolUse gate/,
  );
});

test("a clean artifact carries no secret findings at the gate", async () => {
  const out = await runSkill({
    clientsDir: CLIENTS_DIR,
    client: "example-studio",
    skillName: "create-component",
    request: buttonRequest(),
    registry: REGISTRY,
    policyLayers: POLICY_LAYERS,
  });
  assert.equal(out.gate.secretFindings.length, 0, "clean artifact must carry no secret findings");
});

test("exposes the stability-tiers seam (tier1 engine/skill, tier2 description, tier3 request) for T-MVP-13", async () => {
  const out = await runSkill({
    clientsDir: CLIENTS_DIR,
    client: "example-studio",
    skillName: "create-component",
    request: buttonRequest(),
    registry: REGISTRY,
    policyLayers: POLICY_LAYERS,
  });
  assert.ok(out.promptTiers, "run exposes promptTiers");
  // tier 1 = ENGINE/SKILL (most stable) — identical across runs/clients.
  assert.deepEqual(out.promptTiers.tier1, { engine: "skillforge", skill: "create-component" });
  // tier 2 = CLIENT — the normalized description from the input adapter (same object).
  assert.equal(out.promptTiers.tier2, out.description);
  assert.equal(out.promptTiers.tier2.envelope.kind, "design-system");
  // tier 3 = REQUEST — the specific, variable ask.
  assert.equal(out.promptTiers.tier3.request.componentName, "Button");
  assert.equal(out.promptTiers.tier3.project, null);
});
