#!/usr/bin/env node
// secret-scan — the CI side of the credential-shaped-string gate (docs/11 §"secret-scan runs
// in two places — CI and runtime").
//
// Sources: concept + first principles + general secret-management practice; zero files from
// any third-party skills-factory codebase (clean-room). See docs/11-security-and-secrets.md.
//
// SINGLE CORE, TWO CALL SITES. The detection logic lives ONCE in src/governance/secret-scan.js
// (the runtime PreToolUse seam uses the same module, T-MVP-05). This tool is the CI face: it
// walks the working tree and FAILS the build if any tracked file carries a credential-shaped
// string. The primary boundary is references-not-values (a secret value never enters the tree
// in the first place); this gate is defense-in-depth that catches the mistake.
//
// SYNTHETIC-FIXTURE ALLOWLIST (tight). The runtime secret-scan's OWN test corpus contains
// deliberately SYNTHETIC tokens (the AWS-docs canonical example, repeated-character bodies)
// so the detector can be tested. Those are not real credentials, so this gate would otherwise
// false-positive on its own tests. We allowlist exactly the known test-fixture files that
// carry synthetic tokens — kept narrow (named files, not a blanket "ignore tests/"), so a real
// secret accidentally added to a test still fails.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, basename } from "node:path";

import { scanValue } from "../src/governance/secret-scan.js";

const ROOT = process.cwd();
const SKIP_DIRS = new Set([".git", "node_modules", "private", ".claude"]);

// Tight allowlist: the specific test files that legitimately contain synthetic credential
// shapes to exercise the detector. NOT a blanket tests/ skip — anything outside this list is
// still scanned, so a real secret pasted into another test fails the gate.
const SYNTHETIC_FIXTURE_ALLOWLIST = new Set([
  "test/governance/secret-scan.test.js",  // pattern/entropy detector unit tests (synthetic tokens)
  "test/governance/pretool-hook.test.js",  // gate tests feed synthetic tokens through the hook
  "test/governance/posttool-hook.test.js", // PostToolUse hook tests feed synthetic tokens
  "test/gates-fail-loud.test.js",          // negative tests PLANT a synthetic secret to prove the gate fails
  "test/governance/injection-guard.test.js", // synthetic base64 attack payloads (not secrets) for the base64-instruction detector
  "test/governance/mcp-policy.test.js",    // MCP-policy gate tests feed a synthetic token to prove secret-scan still wins
  "package-lock.json",                     // npm integrity hashes (SHA-512 digests) are not credentials
  "clients/verdex/resources/tokens.json",  // design tokens: base64-encoded SVG icons, not credentials
  "test/engine/large-compose.test.js",     // uses AWS docs canonical example key as synthetic large-input payload
]);

// Third-party vendored content directories exempt from credential scanning.
// ECC skills are published by an external community; they may contain example
// credential strings in documentation/tutorials (bearer token examples, etc.).
const SKIP_DIRS_CONTENT = new Set(["packages"]);

const SCANNABLE_RE = /\.(js|mjs|cjs|ts|tsx|json|md|txt|env|ya?ml)$/;

function walk(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      if (SKIP_DIRS_CONTENT.has(e.name)) continue;
      walk(join(dir, e.name), acc);
    } else if (e.isFile()) {
      acc.push(join(dir, e.name));
    }
  }
  return acc;
}

function main() {
  const files = walk(ROOT);
  const findings = [];

  for (const path of files) {
    if (!SCANNABLE_RE.test(path)) continue;
    const rel = relative(ROOT, path);
    if (SYNTHETIC_FIXTURE_ALLOWLIST.has(rel)) continue;
    let text;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    // scanValue walks strings; here the whole file is one string to scan.
    const hits = scanValue(text);
    for (const h of hits) {
      findings.push(`${rel}: ${h.name} (${h.match})`);
    }
  }

  if (findings.length > 0) {
    console.error(`secret-scan: FAIL — ${findings.length} credential-shaped string(s) in the tree:`);
    for (const f of findings) console.error(`  - ${f}`);
    console.error(
      "  (the primary boundary is references-not-values; a value must never enter the tree — " +
        "if this is a false positive on a synthetic test token, add the file to the tight allowlist)",
    );
    process.exit(1);
  }

  console.log(`secret-scan: PASS — no credential-shaped strings in the tracked tree`);
}

main();
