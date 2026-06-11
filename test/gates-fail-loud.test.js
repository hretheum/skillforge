// Negative tests for the CI gates (T-MVP-14) — the gates must FAIL LOUD on a regression, and
// the runner must hard-fail on a missing/crashing gate (never false-pass).
//
// Sources: concept + first principles; zero files from any third-party skills-factory
// codebase (clean-room). docs/07 §Verification + docs/08.
//
// WHY NEGATIVE TESTS. A gate that cannot FAIL is theater. docs/07's acceptance for the CI
// phase is explicit: "a deliberately introduced regression FAILS the right gate". These tests
// plant each regression class in a throwaway tree and assert the matching gate exits non-zero,
// and that the runner hard-fails on a missing tool (the false-pass bug T-MVP-14 fixes).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const node = process.execPath;

/** Run a tool file with a given cwd; return {status, out}. */
function runTool(toolRelPath, cwd) {
  const r = spawnSync(node, [join(REPO, toolRelPath)], { cwd, encoding: "utf8" });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
}

/** A throwaway copy of just enough of the repo for a gate to run, with cleanup. */
function sandbox(t) {
  const dir = mkdtempSync(join(tmpdir(), "sf-gate-neg-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// =====================================================================================
// The runner hard-fails on a MISSING tool (the false-pass bug fix, caveat 2)
// =====================================================================================

test("gates runner exits non-zero when a gate tool file is MISSING (no false-pass)", async () => {
  const { runGates } = await import("../tools/gates.js");
  const code = runGates({ gates: [{ id: "phantom", file: "__does_not_exist__.js" }] });
  assert.notEqual(code, 0, "a missing gate tool must make the runner FAIL, not silently pass");
});

test("gates runner exits non-zero when a gate FAILS (crash-propagation, real exit code)", (t) => {
  // Run the runner ITSELF from a sandbox cwd where the gates' inputs are absent: registry-lint
  // (no skillforge.registry.json) and skills-ref (no skills/) genuinely exit non-zero there, so
  // the runner must aggregate that into a non-zero exit. This asserts the real propagated status
  // (status !== 0), not a vacuous typeof — a gate that exits 1 makes `gates` exit 1.
  const dir = sandbox(t);
  const r = spawnSync(node, [join(REPO, "tools", "gates.js")], { cwd: dir, encoding: "utf8" });
  assert.notEqual(r.status, 0, "a failing gate must make the runner exit non-zero");
  assert.match(`${r.stdout}\n${r.stderr}`, /gates: FAIL/);
});

// =====================================================================================
// secret-scan FAILS on a planted secret (caveat 6)
// =====================================================================================

test("secret-scan FAILS on a planted credential-shaped string", (t) => {
  const dir = sandbox(t);
  mkdirSync(join(dir, "src"), { recursive: true });
  // A planted AWS-key-shaped value (not the allowlisted canonical example).
  writeFileSync(join(dir, "src", "leak.js"), 'const k = "AKIA1234567890ABCDEF";\n');
  const { status, out } = runTool("tools/secret-scan.js", dir);
  assert.notEqual(status, 0, "a planted secret must fail the gate");
  assert.match(out, /FAIL/);
});

test("secret-scan PASSES on a clean tree (no credential shapes)", (t) => {
  const dir = sandbox(t);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "ok.js"), 'export const greeting = "hello world";\n');
  const { status } = runTool("tools/secret-scan.js", dir);
  assert.equal(status, 0);
});

// =====================================================================================
// cleanroom-guards FAILS on an SF-path leak and an efi-client name (caveat 6)
// =====================================================================================

test("cleanroom-guards FAILS on a foreign skill-factory path (not in a provenance note)", (t) => {
  const dir = sandbox(t);
  mkdirSync(join(dir, "src"), { recursive: true });
  // A real import-shaped reference to a foreign repo, with NO provenance context → a leak.
  writeFileSync(join(dir, "src", "bad.js"), 'import x from "../../dev/skills/thing.js";\n');
  const { status, out } = runTool("tools/cleanroom-guards.js", dir);
  assert.notEqual(status, 0);
  assert.match(out, /guard-no-sf-paths/);
});

// reviewer-b's bypass tests: a real foreign import must FAIL even with a disclaimer word
// nearby/on-the-line, AND the omnipresent top-of-file Sources note must not shield an import
// below it. The earlier ±1-line provenance window let all three slip through (exit 0).

test("cleanroom-guards FAILS: foreign import ONE LINE AFTER a // clean-room comment (bypass-a)", (t) => {
  const dir = sandbox(t);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "src", "bad.js"),
    '// clean-room\nimport stolen from "../../dev/skills/stolen.js";\n',
  );
  const { status, out } = runTool("tools/cleanroom-guards.js", dir);
  assert.notEqual(status, 0, "an import next to a disclaimer word must still FAIL");
  assert.match(out, /guard-no-sf-paths/);
});

test("cleanroom-guards FAILS: foreign import SAME LINE as a // third-party comment (bypass-b)", (t) => {
  const dir = sandbox(t);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "src", "bad.js"),
    'import stolen from "../../dev/skills/x.js"; // third-party reference\n',
  );
  const { status, out } = runTool("tools/cleanroom-guards.js", dir);
  assert.notEqual(status, 0, "an import with a disclaimer word ON THE SAME LINE must still FAIL");
  assert.match(out, /guard-no-sf-paths/);
});

test("cleanroom-guards FAILS: top-of-file Sources note + a foreign import below it (bypass-c)", (t) => {
  const dir = sandbox(t);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "src", "bad.js"),
    "// Sources: concept + first principles, zero files from any third-party skills-factory\n" +
      "// codebase (clean-room).\n" +
      'import stolen from "../../dev/skills/stolen.js";\n',
  );
  const { status, out } = runTool("tools/cleanroom-guards.js", dir);
  assert.notEqual(status, 0, "the omnipresent Sources note must NOT shield an import below it");
  assert.match(out, /guard-no-sf-paths/);
});

test("cleanroom-guards ALLOWS a quoted JS string that is NOT a foreign path but mentions clean-room prose", (t) => {
  // Guard against over-correction: a legit file with ONLY the Sources note (no import) passes.
  const dir = sandbox(t);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "src", "ok.js"),
    "// Sources: concept + first principles, zero files from any third-party skills-factory\n// codebase (clean-room).\nexport const greeting = 'hello';\n",
  );
  const { status } = runTool("tools/cleanroom-guards.js", dir);
  assert.equal(status, 0, "the mandatory Sources note alone (no import) must still PASS");
});

test("cleanroom-guards FAILS on a prior-employer client identifier", (t) => {
  const dir = sandbox(t);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "bad.js"), 'const client = "orlen";\n');
  const { status, out } = runTool("tools/cleanroom-guards.js", dir);
  assert.notEqual(status, 0);
  assert.match(out, /guard-no-efi-clients/);
});

test("cleanroom-guards FAILS on a non-example-studio clients/ subfolder", (t) => {
  const dir = sandbox(t);
  mkdirSync(join(dir, "clients", "someoneelse"), { recursive: true });
  writeFileSync(join(dir, "clients", "someoneelse", "config.json"), "{}\n");
  const { status, out } = runTool("tools/cleanroom-guards.js", dir);
  assert.notEqual(status, 0);
  assert.match(out, /clients\//);
});

test("cleanroom-guards ALLOWS a foreign marker inside a provenance/clean-room note", (t) => {
  const dir = sandbox(t);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "src", "ok.js"),
    "// Sources: concept + first principles, zero files from any third-party skills-factory\n// codebase (clean-room).\nexport const x = 1;\n",
  );
  const { status } = runTool("tools/cleanroom-guards.js", dir);
  assert.equal(status, 0, "a marker inside the mandatory Sources note must NOT fail the gate");
});

// =====================================================================================
// determinism-gate FAILS on a drifted golden (caveat 6: prefix break)
// =====================================================================================

test("determinism-gate PASSES on the committed tree (goldens byte-match)", () => {
  const { status, out } = runTool("tools/determinism-gate.js", REPO);
  assert.equal(status, 0, out);
  assert.match(out, /PASS/);
});

test("determinism-gate FAILS when a golden is drifted (prefix break)", (t) => {
  // The gate resolves fixtures/source relative to its OWN location, so to test drift we mirror
  // the structure it reads — tools/ + src/ + test/fixtures/ — into a sandbox, corrupt one
  // golden there, and run the sandboxed tool. A drifted golden must fail the gate.
  const dir = sandbox(t);
  for (const sub of ["tools", "src", join("test", "fixtures")]) {
    cpSync(join(REPO, sub), join(dir, sub), { recursive: true });
  }
  // Corrupt the prompt-prefix golden (a "prefix break") — append a stray byte.
  const goldenFile = join(dir, "test", "fixtures", "prompt-prefix-golden.txt");
  writeFileSync(goldenFile, readFileSync(goldenFile, "utf8") + "DRIFT");
  const r = spawnSync(node, [join(dir, "tools", "determinism-gate.js")], { cwd: dir, encoding: "utf8" });
  assert.notEqual(r.status, 0, "a drifted golden must FAIL the determinism gate");
  assert.match(`${r.stdout}\n${r.stderr}`, /DRIFT|drifted|prompt-prefix-golden/);
});
