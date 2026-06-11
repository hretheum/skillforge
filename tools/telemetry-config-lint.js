#!/usr/bin/env node
// telemetry-config-lint — the CI face of the telemetry config-lint (T-HARD-10(a)).
//
// Sources: concept + first principles + public Claude Code / OpenTelemetry env-var names; zero
// files from any third-party skills-factory codebase (clean-room). See docs/10/11/14 and the
// shared core src/core/telemetry-config.js.
//
// SINGLE CORE, TWO CALL SITES (the secret-scan shape). The lint logic lives ONCE in
// src/core/telemetry-config.js; this tool is the CI face. It walks the shipped telemetry env
// REFERENCE files under deploy/telemetry/ and FAILS the build if any of them, read under the
// PROFILE-A (compliance) posture, would (a) enable prompt/tool-input content logging, or (b)
// carry an INLINE OTLP credential value instead of a secret reference.
//
// WHY PROFILE A. The shipped reference is the strictest posture (EU residency + ZDR). Linting it
// under profile A proves the example an operator copies is content-free and secret-reference-only.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { lintTelemetryConfig } from '../src/core/telemetry-config.js';
import { PROFILES } from '../src/governance/profile-evaluator.js';

const TELEMETRY_DIR = 'deploy/telemetry';
// The shipped telemetry env reference files this gate lints (the canonical safe examples). A
// glob over *.env keeps the gate covering any reference env added later without editing the tool.
const ENV_FILE_RE = /\.env$/;

/**
 * Parse a minimal `.env` file into a { NAME: value } map. Supports `NAME=value`, `#` comment
 * lines, and surrounding whitespace. Does NOT expand placeholders — `${NAME}` stays literal, so
 * the lint sees the REFERENCE shape (exactly what must be verified).
 */
export function parseEnvFile(text) {
  const env = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const name = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (name.length > 0) env[name] = value;
  }
  return env;
}

function listEnvFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const e of entries) {
    if (e.isFile() && ENV_FILE_RE.test(e.name)) files.push(join(dir, e.name));
  }
  return files;
}

function main() {
  const files = listEnvFiles(TELEMETRY_DIR);
  if (files.length === 0) {
    // Fail-loud: the gate's whole point is to lint the shipped reference; if the reference is gone,
    // the gate has silently nothing to do, which is the failure mode the gate runner guards against.
    console.error(
      `telemetry-config-lint: FAIL — no telemetry env reference (*.env) found under ${TELEMETRY_DIR} ` +
        '(the shipped profile-A reference must exist and be linted)',
    );
    process.exit(1);
  }

  const findings = [];
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch (e) {
      findings.push(`${file}: cannot read — ${e.message}`);
      continue;
    }
    const env = parseEnvFile(text);
    // The shipped reference is the profile-A (compliance) posture — the strictest.
    for (const v of lintTelemetryConfig({ env, profile: PROFILES.COMPLIANCE })) {
      findings.push(`${file}: ${v}`);
    }
  }

  if (findings.length > 0) {
    console.error(`telemetry-config-lint: FAIL — ${findings.length} telemetry-config problem(s):`);
    for (const f of findings) console.error(`  - ${f}`);
    console.error(
      '  (under profile A telemetry must carry no prompt/tool-input content and the OTLP header ' +
        'must be a secret reference, not an inline value — docs/10/11/14)',
    );
    process.exit(1);
  }

  console.log(
    `telemetry-config-lint: PASS — ${files.length} telemetry env reference(s) profile-A-safe ` +
      '(no prompt/tool-input logging; OTLP header is a secret reference)',
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
