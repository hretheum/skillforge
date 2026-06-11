#!/usr/bin/env node
// dependency-audit — the P2 Dependency Audit gate (S2 readiness; docs/audit/audit-types.md §P2,
// docs/audit/dependency-audit-s2.md). It came alive when the repo gained its first third-party
// dependency (@modelcontextprotocol/sdk, Sprint S12) — the stage transition S1 → S2.
//
// Sources: concept + first principles; zero files from any third-party skills-factory codebase
// (clean-room).
//
// WHAT THIS DOES. It runs `npm audit` over the committed dependency tree and FAILS the gate when a
// HIGH or CRITICAL CVE is present. low/moderate advisories are surfaced (printed) but do NOT fail —
// for a developer-facing tool the proportionate posture is to block only on the severities that
// warrant blocking a release, while still making the lower-severity ones visible. The threshold is
// the single tunable knob (auditLevel).
//
// FAIL-CLOSED on the AUDIT itself, not on advisories. npm audit exits 0 when nothing at/above the
// level is found, and non-zero when something is. But a non-zero exit can ALSO mean the audit could
// not run (no lockfile, registry unreachable). We distinguish: a clean parse with zero
// at-or-above-level vulnerabilities is the ONLY PASS; anything else (vulnerabilities found, OR the
// audit could not produce a parseable report) is a FAIL. A gate that passed because the audit
// crashed would re-create the silent window this closes.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(TOOLS_DIR);

const SEVERITY_ORDER = ["info", "low", "moderate", "high", "critical"];

function parseArgs(argv) {
  const args = { auditLevel: "high" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--audit-level") {
      args.auditLevel = String(argv[++i] ?? "").toLowerCase();
    } else if (argv[i] === "--ci") {
      args.ci = true; // accepted for symmetry with the other gates; behavior is identical
    }
  }
  return args;
}

/**
 * Run `npm audit --json` in the given cwd and return the parsed metadata, or an error.
 * Exported so a test can drive it without re-shelling. Never throws.
 * @param {{cwd?: string}} [opts]
 * @returns {{ counts: Record<string, number> } | { error: string }}
 */
export function runNpmAudit({ cwd = ROOT } = {}) {
  const r = spawnSync("npm", ["audit", "--json"], { cwd, encoding: "utf8" });
  if (r.error) {
    return { error: `could not run npm audit: ${r.error.message} (fail-closed)` };
  }
  // npm audit exits non-zero when advisories are found — that is EXPECTED and not an error.
  // The real error is an unparseable report (no lockfile, registry failure, npm crash).
  let parsed;
  try {
    parsed = JSON.parse(r.stdout);
  } catch (e) {
    const detail = (r.stderr || r.stdout || "").trim().split("\n").slice(0, 3).join(" ");
    return { error: `npm audit produced no parseable JSON report: ${e.message}${detail ? ` — ${detail}` : ""} (fail-closed)` };
  }
  const counts = parsed?.metadata?.vulnerabilities;
  if (!counts || typeof counts !== "object") {
    return { error: "npm audit report missing metadata.vulnerabilities (fail-closed)" };
  }
  return { counts };
}

/** Sum every severity at or above `level`. Exported so a test can prove the FAIL math directly. */
export function countBlocking(counts, level) {
  const floor = SEVERITY_ORDER.indexOf(level);
  return SEVERITY_ORDER.slice(floor).reduce((n, sev) => n + (counts[sev] ?? 0), 0);
}

/**
 * Run the dependency-audit gate. Returns 0 when no CVE at/above the threshold is present and the
 * audit ran cleanly; non-zero on any blocking CVE or audit failure.
 * @param {{auditLevel?: string, cwd?: string}} [opts]
 * @returns {number}
 */
export function runDependencyAudit({ auditLevel = "high", cwd = ROOT } = {}) {
  if (!SEVERITY_ORDER.includes(auditLevel)) {
    console.error(`dependency-audit: FAIL — unknown --audit-level "${auditLevel}" (expected one of ${SEVERITY_ORDER.join(", ")})`);
    return 1;
  }

  const res = runNpmAudit({ cwd });
  if (res.error) {
    console.error(`dependency-audit: FAIL — ${res.error}`);
    return 1;
  }

  const { counts } = res;
  const blocking = countBlocking(counts, auditLevel);
  const total = SEVERITY_ORDER.reduce((n, sev) => n + (counts[sev] ?? 0), 0);

  if (blocking > 0) {
    console.error(
      `dependency-audit: FAIL — ${blocking} vulnerabilit${blocking === 1 ? "y" : "ies"} at/above "${auditLevel}" ` +
        `(critical: ${counts.critical ?? 0}, high: ${counts.high ?? 0}, moderate: ${counts.moderate ?? 0}, low: ${counts.low ?? 0}). ` +
        `Run \`npm audit\` for detail, then \`npm audit fix\` or bump the affected dependency.`,
    );
    return 1;
  }

  const belowThreshold = total - blocking;
  console.log(
    `dependency-audit: PASS — 0 vulnerabilities at/above "${auditLevel}"` +
      (belowThreshold > 0
        ? ` (${belowThreshold} below-threshold advisor${belowThreshold === 1 ? "y" : "ies"} surfaced but not blocking: ` +
          `moderate ${counts.moderate ?? 0}, low ${counts.low ?? 0}, info ${counts.info ?? 0}).`
        : " (clean tree)."),
  );
  return 0;
}

// Run when invoked directly.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = parseArgs(process.argv.slice(2));
  process.exit(runDependencyAudit(args));
}
