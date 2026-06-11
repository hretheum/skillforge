#!/usr/bin/env node
// gates — the fail-loud gate runner (docs/07 §Verification, docs/08 CI gates).
//
// Sources: concept + first principles; zero files from any third-party skills-factory
// codebase (clean-room).
//
// WHY A RUNNER INSTEAD OF `a && b && c`. A naive `npm run gate:a && gate:b && …` chain can
// FALSELY PASS: on some npm/node versions a gate whose tool file is MISSING (or that crashes
// before it can signal) does not reliably propagate a non-zero exit, so the chain reports
// green while a gate never actually ran. For a project whose entire value is determinism, a
// gate that silently no-ops is the worst failure mode. This runner removes the ambiguity:
//
//   1. It EXPLICITLY verifies each gate tool file EXISTS before running it — a missing tool is
//      a HARD FAIL, never a skip.
//   2. It runs each gate as a child process and treats ANY non-zero exit (or a spawn failure,
//      or a crash) as a FAIL.
//   3. The runner's own exit is non-zero if ANY gate failed — fail-loud, deterministic,
//      platform-independent.
//
// The negative test (test/gates-fail-loud.test.js) proves this: point a gate at a missing
// tool → the runner exits non-zero (the bug this runner fixes).

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));

// The gate families (docs/07 + docs/08). Each names the tool file the runner asserts.
// determinism = Gate 1 (byte-diff); genericity = Gate 2 (one skill, two output forms, equivalent
// results, zero engine-code change between runs — the leak test). The rest are the guardrail
// gates (open-standard manifest, inventory/scope drift, no-credential, clean-room).
const GATES = [
  { id: "determinism", file: "determinism-gate.js" },
  { id: "genericity", file: "genericity-proof.js" },
  { id: "skills-ref", file: "skills-ref.js" },
  // registry-lint also enforces the gate-per-adapter REGISTRATION rule (T-P4-01): every adapter
  // in the engine catalog must ship its proof (input -> a determinism golden; output -> a
  // genericity-proof pairing). Folding it into registry-lint keeps the catalog-consistency
  // checks under one gate (so the catalog checks stay one family, not two).
  { id: "registry-lint", file: "registry-lint.js" },
  { id: "secret-scan", file: "secret-scan.js" },
  { id: "cleanroom", file: "cleanroom-guards.js" },
  // residency = the profile-A residency/retention posture asserted against backend evidence
  // (SEC-P1-4 / T-HARD-03). It makes the ZDR/EU-residency promise MONITORED by a check rather
  // than by a human re-reading a mutable doc page (docs/15 §"Monitoring the ZDR basis").
  { id: "residency", file: "residency-check.js" },
  // telemetry-config = the telemetry config-lint (SEC-P2-5 / T-HARD-10(a)). It gives the
  // "no secrets / no content in telemetry" rule an enforcement gate (like the repo secret-scan):
  // it lints the shipped profile-A telemetry env reference for prompt/tool-input content logging
  // and an inline OTLP credential (the header must be a secret REFERENCE). docs/10/11/14.
  { id: "telemetry-config", file: "telemetry-config-lint.js" },
  // dependency-audit = the P2 Dependency Audit gate (S2 readiness). It came alive when the repo
  // gained its first third-party dependency (@modelcontextprotocol/sdk, Sprint S12). It runs
  // `npm audit` and FAILS on a HIGH/CRITICAL CVE (low/moderate surfaced but non-blocking for a
  // dev tool). docs/audit/dependency-audit-s2.md + docs/audit/audit-types.md §P2.
  { id: "dependency-audit", file: "dependency-audit.js" },
];

/**
 * Run the configured gates fail-loud.
 * @param {{gates?: Array<{id:string,file:string}>}} [opts]  override the gate list (tests).
 * @returns {number} 0 if every gate passed; non-zero if any failed/missing/crashed.
 */
export function runGates({ gates = GATES } = {}) {
  const results = [];
  for (const g of gates) {
    const toolPath = join(TOOLS_DIR, g.file);
    if (!existsSync(toolPath)) {
      results.push({ id: g.id, ok: false, reason: `tool file missing: tools/${g.file}` });
      continue;
    }
    const r = spawnSync(process.execPath, [toolPath], { stdio: "inherit" });
    if (r.error) {
      results.push({ id: g.id, ok: false, reason: `spawn failed: ${r.error.message}` });
    } else if (r.status !== 0) {
      results.push({ id: g.id, ok: false, reason: `gate exited ${r.status ?? "via signal " + r.signal}` });
    } else {
      results.push({ id: g.id, ok: true });
    }
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(`\ngates: FAIL — ${failed.length}/${results.length} gate(s) did not pass:`);
    for (const f of failed) console.error(`  - ${f.id}: ${f.reason}`);
    return 1;
  }
  console.log(`\ngates: PASS — all ${results.length} gates green`);
  return 0;
}

// Run when invoked directly (not when imported by the negative test).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(runGates());
}
