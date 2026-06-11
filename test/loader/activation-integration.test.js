// Integration test: the activation predicate against the REAL Example Studio config + the REAL
// registry, wired through the loader (T-MVP-11).
//
// Sources: concept + first principles, zero third-party skills-factory files (clean-room).
// Unlike activation.test.js (synthetic contexts), this proves the real seam: loadClientConfig
// returns ctx.skills from clients/example-studio/config.json, the registry on disk carries the
// create-component entry, and activate() ties them together — a recognized skill activates for
// the adopting client, and a non-adopted skill does not.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { loadClientConfig, activate, canActivate, ACTIVATION_GATES } from "../../src/loader/index.js";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CLIENTS_DIR = fileURLToPath(new URL("../../clients", import.meta.url));
const REGISTRY = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../skillforge.registry.json", import.meta.url)), "utf8"),
);

test("real BC config + real registry: create-component activates end-to-end", () => {
  const clientContext = loadClientConfig({ clientsDir: CLIENTS_DIR, client: "example-studio" });
  // The config adoption is real, not synthetic.
  assert.ok(Array.isArray(clientContext.skills), "loader returns ctx.skills");
  assert.ok(clientContext.skills.includes("create-component"), "BC adopts create-component");

  const rec = activate({
    skillName: "create-component",
    clientContext,
    registry: REGISTRY,
  });
  assert.equal(rec.skill, "create-component");
  assert.equal(rec.client, "example-studio");
  assert.deepEqual(rec.entry.requiredAdapters, { input: ["dtcg-tokens"], output: ["react"] });
});

test("real seam: a skill the BC config did not adopt does not activate", () => {
  const clientContext = loadClientConfig({ clientsDir: CLIENTS_DIR, client: "example-studio" });
  assert.throws(
    () => activate({ skillName: "some-unadopted-skill", clientContext, registry: REGISTRY }),
    (e) => e.gate === ACTIVATION_GATES.CLIENT_HAS_SKILL,
  );
  assert.equal(
    canActivate({ skillName: "some-unadopted-skill", clientContext, registry: REGISTRY }),
    false,
  );
});
