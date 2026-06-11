// Per-client scoping end-to-end (T-P3-04 / docs/11 §scoping, docs/13 §resolver, docs/10 §slicing).
//
// Sources: concept + first principles, zero third-party skills-factory files (clean-room).
//
// WHAT THIS PROVES. With TWO clients (Example Studio and the second client, Glasshouse) resident in
// one clients_dir, the (client, project) scope is a real isolation boundary across the three axes
// the security model names:
//
//   1. TOOLS / resolver (docs/13) — a tool affirmatively allowed only in client A's per-client
//      policy layer is DENIED for client B's run. The resolver is deny-first and decides from the
//      layers the run is given; client B's run never sees A's client layer, so A's grant does not
//      leak to B. (The dual: each client's own org/client allow lets its own write through.)
//   2. SECRETS / references (docs/11) — secrets are addressed per (client, project, adapter): the
//      two clients' secretRefs are disjoint namespaces (`example-studio/…` vs `glasshouse/…`), and the
//      loader's subtree-containment (ARCH-06, covered in the loader tests) means neither client's
//      config can even reference the other's resource subtree. So client A cannot resolve B's
//      secret references — they are not in A's config and A cannot reach into B's subtree.
//   3. TELEMETRY (docs/10) — the per-run `skillforge.skill_result` event slices by the client
//      HANDLE without leaking content: each run emits an event stamped with its own client, the
//      events do not cross, and the event carries no client content or secret value.
//
// MEMBRANE-SAFE. Like the e2e keystone, the real token VALUES live in test/fixtures and are
// overlaid into a temp clients_dir at each client's tokenHub address — client data never enters the
// committed engine tree; the genuine run path executes on real data.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { runSkill } from "../src/engine/run.js";
import { HOOK_DECISION } from "../src/governance/index.js";
import { policyResolver } from "../src/governance/policy-resolver.js";
import { loadClientConfig } from "../src/loader/index.js";

const REPO_CLIENTS_DIR = fileURLToPath(new URL("../clients", import.meta.url));
const REGISTRY = JSON.parse(
  readFileSync(fileURLToPath(new URL("../skillforge.registry.json", import.meta.url)), "utf8"),
);
const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

// The two clients under test, co-resident in one clients_dir. They use different membrane
// postures, which the test honors:
//   - example-studio: a REAL brand whose token values are clean-room-confidential, so its committed
//     resource is a PLACEHOLDER — we overlay the real DTCG fixture at its tokenHub address.
//   - glasshouse: a FICTIONAL client whose real (fictional) values live directly in its committed
//     resource — copied verbatim, no overlay (nothing confidential to keep out of the tree).
const OVERLAY = {
  "example-studio": { tokensFile: "example-studio.tokens.json", fixture: "dtcg-example-studio.tokens.json" },
  // glasshouse intentionally has no overlay entry — its committed resource is the source of truth.
};
const CLIENT_NAMES = ["example-studio", "glasshouse"];

let CLIENTS_DIR;
let TMP_ROOT;

before(() => {
  TMP_ROOT = mkdtempSync(join(tmpdir(), "sf-scoping-"));
  CLIENTS_DIR = join(TMP_ROOT, "clients");
  for (const client of CLIENT_NAMES) {
    const dir = join(CLIENTS_DIR, client);
    cpSync(join(REPO_CLIENTS_DIR, client), dir, { recursive: true });
    const overlay = OVERLAY[client];
    if (overlay) {
      mkdirSync(join(dir, "resources"), { recursive: true });
      writeFileSync(join(dir, "resources", overlay.tokensFile), readFileSync(fixture(overlay.fixture), "utf8"));
    }
  }
});

after(() => {
  if (TMP_ROOT) rmSync(TMP_ROOT, { recursive: true, force: true });
});

// Each client's create-component request (its own DS, its own role binding).
function requestFor(client) {
  if (client === "example-studio") {
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
  // Glasshouse — the same request impl-client proved the 2nd client e2e with (T-P3-01).
  return {
    componentName: "Sprout",
    element: "article",
    baseClass: "gh-sprout",
    variants: [
      { prop: "size", value: "s", class: "gh-sprout--sm" },
      { prop: "tone", value: "accent", class: "gh-sprout--accent", role: "color.semantic.accent" },
    ],
    decorations: [{ element: "span", class: "gh-leaf", ariaHidden: true }],
    sourceClasses: ["gh-sprout", "gh-sprout--sm", "gh-sprout--accent", "gh-leaf"],
  };
}

// =====================================================================================
// Axis 1 — TOOLS / resolver: a per-client allow does not leak to the other client
// =====================================================================================

test("resolver: a Write allowed only in client A's per-client layer is denied for client B", async () => {
  // The deployment policy: the affirmative allow for Write lives in the CLIENT layer, scoped to
  // Example Studio only (this is how a per-client grant is expressed — docs/13 Layer 2). Glasshouse's
  // run is given the SAME shaped request but with NO client-layer allow for it.
  const writeAllowedForBC = {
    client: [{ pattern: "Write", decision: "allow" }], // belongs to BC's deployment policy
  };

  // BC: its own client-layer allow lets the artifact write through.
  const bc = await runSkill({
    clientsDir: CLIENTS_DIR,
    client: "example-studio",
    skillName: "create-component",
    request: requestFor("example-studio"),
    registry: REGISTRY,
    policyLayers: writeAllowedForBC,
  });
  assert.notEqual(bc.gate.decision, HOOK_DECISION.DENY, "BC's own client-layer allow permits its write");

  // Glasshouse: BC's per-CLIENT Write allow is not in scope for it (each run is gated only by its
  // own client's layers), so it cannot leak — its run only ever sees its own layers + its own
  // config floor. Glasshouse's deployment here expresses "no Write" with a project-layer deny, which
  // the deny-first meet honours over its config orgBaseline floor; BC's grant is never consulted.
  // (The tight resolver-level isolation proof is the unit test below.)
  await assert.rejects(
    () =>
      runSkill({
        clientsDir: CLIENTS_DIR,
        client: "glasshouse",
        skillName: "create-component",
        request: requestFor("glasshouse"),
        registry: REGISTRY,
        policyLayers: { project: [{ pattern: "Write", decision: "deny" }] },
      }),
    /denied at the PreToolUse gate/,
    "Glasshouse must NOT inherit Example Studio's per-client Write allow",
  );
});

test("resolver (unit): the same tool, same call, flips on the client-scoped layer only", async () => {
  // Tighten the proof at the resolver itself: identical (tool, requiredTools), the ONLY difference
  // is whether the client-scoped layer carries the allow. This is the per-client scope being the
  // deciding axis — not anything global.
  const base = { tool: "Write", requiredTools: ["Write"], profile: "compliance" };
  const allowedForA = policyResolver.resolve({ ...base, layers: { client: [{ pattern: "Write", decision: "allow" }] } });
  const deniedForB = policyResolver.resolve({ ...base, layers: { client: [] } });
  assert.equal(allowedForA, "allow", "client A's client-layer allow → allow");
  assert.equal(deniedForB, "deny", "client B (no client-layer allow) → deny (silence = deny)");
});

// =====================================================================================
// Axis 2 — SECRETS / references: the two clients' secret namespaces are disjoint, and neither
// config can reach the other's subtree (loader containment, ARCH-06 — proven in the loader tests).
// =====================================================================================

test("secrets: the two clients' secretRefs are disjoint per-client namespaces (no shared secret)", async () => {
  const bc = loadClientConfig({ clientsDir: CLIENTS_DIR, client: "example-studio" });
  const gh = loadClientConfig({ clientsDir: CLIENTS_DIR, client: "glasshouse" });

  // Every secret reference is namespaced under its OWN client handle — the (client, project,
  // adapter) addressing of docs/11. So a reference is meaningful for exactly one client.
  assert.ok(bc.secretRefs.length > 0 && gh.secretRefs.length > 0, "both clients declare secret refs");
  assert.ok(bc.secretRefs.every((r) => r.startsWith("example-studio/")), "BC secret refs are BC-namespaced");
  assert.ok(gh.secretRefs.every((r) => r.startsWith("glasshouse/")), "GH secret refs are GH-namespaced");

  // Disjoint: no secret reference is shared across the two clients — client A literally does not
  // hold any reference that resolves client B's secret.
  const shared = bc.secretRefs.filter((r) => gh.secretRefs.includes(r));
  assert.deepEqual(shared, [], "no secret reference is shared between the two clients");
});

test("secrets: a client's references resolve only inside its own subtree (no cross-read)", async () => {
  // The loaded reference for each client resolves under that client's own directory — the
  // containment invariant (ARCH-06). Neither client's config can name the other's resource (the
  // escape case is refused at the references gate — see config-loader tenancy tests).
  const bc = loadClientConfig({ clientsDir: CLIENTS_DIR, client: "example-studio" });
  const gh = loadClientConfig({ clientsDir: CLIENTS_DIR, client: "glasshouse" });
  assert.ok(
    bc.references.tokenHub.resolvedPath.includes(join("clients", "example-studio")),
    "BC's tokenHub resolves inside BC's subtree",
  );
  assert.ok(
    gh.references.tokenHub.resolvedPath.includes(join("clients", "glasshouse")),
    "GH's tokenHub resolves inside GH's subtree",
  );
  assert.ok(
    !bc.references.tokenHub.resolvedPath.includes(join("clients", "glasshouse")),
    "BC cannot resolve into GH's subtree",
  );
});

// =====================================================================================
// Axis 3 — TELEMETRY: skill_result slices by client handle, no content leak, events don't cross
// =====================================================================================

test("telemetry: each run's skill_result is stamped with its own client and carries no content", async () => {
  const events = [];
  const sink = (e) => events.push(e);

  await runSkill({
    clientsDir: CLIENTS_DIR,
    client: "example-studio",
    skillName: "create-component",
    request: requestFor("example-studio"),
    registry: REGISTRY,
    policyLayers: { org: [{ pattern: "Write", decision: "allow" }] },
    skillResultSink: sink,
  });
  await runSkill({
    clientsDir: CLIENTS_DIR,
    client: "glasshouse",
    skillName: "create-component",
    request: requestFor("glasshouse"),
    registry: REGISTRY,
    policyLayers: { org: [{ pattern: "Write", decision: "allow" }] },
    skillResultSink: sink,
  });

  assert.equal(events.length, 2, "one skill_result per run");
  const byClient = Object.fromEntries(events.map((e) => [e.client, e]));
  assert.ok(byClient["example-studio"] && byClient.glasshouse, "events slice by the two client handles");
  // Each is a clean PASS stamped with ITS client — not the other's.
  assert.equal(byClient["example-studio"].outcome, "PASS");
  assert.equal(byClient.glasshouse.outcome, "PASS");
  assert.equal(byClient["example-studio"].skill, "create-component");

  // No content leak: the event is the run-shape facts only — it must NOT carry the artifact source,
  // the design-system payload, token values, or any source class list. (makeSkillResult also
  // fail-closed secret-scans the event; here we assert the structural absence of content.)
  for (const e of events) {
    const serialized = JSON.stringify(e);
    // No DS content, no token values, no class names, no artifact source anywhere in the event.
    assert.doesNotMatch(
      serialized,
      /hbtn|gh-sprout|Sprout|#e5232b|#6fae57|color\.semantic|HTMLElement|customElements/,
      "skill_result must not carry any client content / token values / artifact source",
    );
    // The event's keys are the documented secret-free set — no payload/source/sourceClasses field.
    assert.deepEqual(
      Object.keys(e).sort(),
      ["client", "event", "failure", "hookEventName", "outcome", "project", "skill"].sort(),
      "skill_result carries only the documented secret-free fields (no content)",
    );
    assert.equal(e.event, "skillforge.skill_result");
  }
});

test("telemetry: a client's event never carries the OTHER client's handle", async () => {
  const events = [];
  await runSkill({
    clientsDir: CLIENTS_DIR,
    client: "glasshouse",
    skillName: "create-component",
    request: requestFor("glasshouse"),
    registry: REGISTRY,
    policyLayers: { org: [{ pattern: "Write", decision: "allow" }] },
    skillResultSink: (e) => events.push(e),
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].client, "glasshouse");
  assert.notEqual(events[0].client, "example-studio", "Glasshouse's event is not mislabeled as Example Studio");
});
