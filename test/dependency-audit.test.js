// Tests for the dependency-audit gate (P2 / S2). A gate that cannot FAIL is theater
// (docs/07 §Verification) — so we prove both the PASS on the clean committed tree AND that the
// threshold logic FAILS on a planted high/critical advisory.
//
// Sources: concept + first principles; zero files from any third-party skills-factory codebase
// (clean-room). docs/audit/dependency-audit-s2.md.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runDependencyAudit, countBlocking } from "../tools/dependency-audit.js";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const node = process.execPath;

test("dependency-audit PASSES on the committed tree (0 high/critical CVEs)", () => {
  const code = runDependencyAudit({ auditLevel: "high" });
  assert.equal(code, 0, "the clean committed tree must pass the high-threshold audit");
});

test("gate exits 0 when run directly against the committed tree", () => {
  const r = spawnSync(node, [join(REPO, "tools", "dependency-audit.js")], { cwd: REPO, encoding: "utf8" });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(`${r.stdout}\n${r.stderr}`, /dependency-audit: PASS/);
});

test("an unknown --audit-level is a hard FAIL (fail-closed on misconfiguration)", () => {
  const code = runDependencyAudit({ auditLevel: "bogus" });
  assert.notEqual(code, 0);
});

// threshold logic — the part that decides PASS vs FAIL. Proven directly so a high/critical CVE
// CANNOT slip past, without needing a vulnerable package in the real tree.
test("countBlocking sums every severity at or above the threshold", () => {
  const counts = { info: 1, low: 2, moderate: 3, high: 4, critical: 5 };
  assert.equal(countBlocking(counts, "critical"), 5);
  assert.equal(countBlocking(counts, "high"), 9, "high threshold = high + critical");
  assert.equal(countBlocking(counts, "moderate"), 12);
  assert.equal(countBlocking(counts, "low"), 14);
});

test("countBlocking FAILS-the-gate math: a planted high CVE is blocking at the high threshold", () => {
  const plantedHigh = { info: 0, low: 5, moderate: 2, high: 1, critical: 0 };
  // low/moderate are below the high threshold → not blocking; the single high IS blocking.
  assert.equal(countBlocking(plantedHigh, "high"), 1, "a high CVE must be counted as blocking");
  assert.equal(countBlocking({ low: 9, moderate: 9, high: 0, critical: 0 }, "high"), 0, "low/moderate alone do not block at high");
});
