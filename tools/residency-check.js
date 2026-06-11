#!/usr/bin/env node
// residency-check — the CHECK that makes the profile-A residency/retention promise MONITORED, not
// hoped (SEC-P1-4 / T-HARD-03; docs/15 §"Monitoring the ZDR basis", docs/14 §profile A).
//
// Sources: concept + first principles, zero files from any third-party skills-factory codebase
// (clean-room).
//
// WHAT THIS DOES. It asserts the profile-A residency/retention posture AGAINST BACKEND EVIDENCE —
// the facts the model backend reports about itself (the EU-available model list and the
// retention-exception list) — rather than trusting that a human re-read a mutable doc page. A
// residency/retention REGRESSION (the active model dropped from the EU list, or appearing on the
// retention-exception list, or the endpoint no longer EU-regional, or the exception list widening)
// makes this check exit NON-ZERO. That is the AC: the regression is caught by a tool, not by a
// human noticing docs/15 changed.
//
// TWO MODES, ONE EVALUATOR (docs/15 "scheduled re-check"):
//   * DEFAULT — read the committed evidence SNAPSHOT (test/fixtures/residency-evidence-snapshot.json).
//     Deterministic, offline, CI-runnable: it proves the asserted posture is internally consistent
//     and bites when the snapshot (or the asserted contract) regresses.
//   * --evidence <path> — read a FRESH evidence file produced by a live fetch of the backend pages
//     (the scheduled re-check writes the live facts to a JSON in this shape, then runs this check
//     over it). The SAME assertResidencyPosture() runs; a divergence between live and asserted = the
//     regression alerted on.
//
// FAIL-CLOSED. Missing/unreadable/malformed evidence is a HARD FAIL (unproven → the promise cannot
// be proven). A check that passed on a fetch error would re-create the silent window this closes.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { assertResidencyPosture, FINDING } from "../src/governance/residency-posture.js";

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(TOOLS_DIR);
const DEFAULT_EVIDENCE = join(ROOT, "test", "fixtures", "residency-evidence-snapshot.json");

function parseArgs(argv) {
  const args = { evidence: DEFAULT_EVIDENCE };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--evidence") {
      args.evidence = resolve(argv[++i] ?? "");
    } else if (argv[i] === "--ci") {
      args.ci = true; // accepted for symmetry with the other gates; behavior is identical
    }
  }
  return args;
}

/** Load backend evidence from a JSON file. Returns {evidence} or {error} — never throws. */
function loadEvidence(path) {
  if (!path || !existsSync(path)) {
    return { error: `evidence file not found: ${path} (fail-closed — the posture cannot be proven without it)` };
  }
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    return { error: `could not read evidence file ${path}: ${e.message}` };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { error: `evidence file ${path} is not valid JSON: ${e.message} (fail-closed)` };
  }
  return { evidence: parsed };
}

/**
 * Run the residency check. Returns 0 when the posture is PROVEN; non-zero on any regression /
 * unproven finding / load error. Exported so a test can drive it without spawning a process.
 * @param {{evidence?: string}} [opts]
 * @returns {number}
 */
export function runResidencyCheck({ evidence: evidencePath = DEFAULT_EVIDENCE } = {}) {
  const loaded = loadEvidence(evidencePath);
  if (loaded.error) {
    console.error(`residency-check: FAIL — ${loaded.error}`);
    return 1;
  }

  const report = assertResidencyPosture(loaded.evidence);

  if (report.ok) {
    console.log(
      `residency-check: PASS — profile-A residency/retention posture proven against backend evidence ` +
        `(${report.source ?? evidencePath}${report.evidenceAsOf ? `, as-of ${report.evidenceAsOf}` : ""}). ` +
        `Invariants proven: ${report.checked.join(", ")}.`,
    );
    return 0;
  }

  const regressions = report.findings.filter((f) => f.finding === FINDING.REGRESSION);
  const unproven = report.findings.filter((f) => f.finding === FINDING.UNPROVEN);
  console.error(
    `residency-check: FAIL — residency/retention posture NOT proven ` +
      `(${regressions.length} regression(s), ${unproven.length} unproven) against ` +
      `${report.source ?? evidencePath}${report.evidenceAsOf ? `, as-of ${report.evidenceAsOf}` : ""}:`,
  );
  for (const f of report.findings) {
    console.error(`  - [${f.finding}] ${f.invariant}: ${f.detail}`);
  }
  console.error(
    "  If this reflects a DELIBERATE, confirmed backend change, refresh the evidence snapshot AND " +
      "the asserted posture/scope in src/governance/residency-posture.js in one reviewed change; " +
      "otherwise this is a live residency/retention regression to escalate.",
  );
  return 1;
}

// Run when invoked directly.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = parseArgs(process.argv.slice(2));
  process.exit(runResidencyCheck(args));
}
