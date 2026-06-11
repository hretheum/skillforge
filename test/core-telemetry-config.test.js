// Tests for the telemetry config-lint (T-HARD-10(a)) — docs/10 §"Turning it on", docs/11
// §"No secrets in telemetry or logs", docs/14 §"Profile A".
//
// AC (docs/16 L170): the telemetry config-lint is green AND bites — (1) no prompt/tool-input
// logging under profile A; (2) the OTLP header is a secret REFERENCE, not an inline value. Both
// clauses are proven non-vacuous (a config that violates each is rejected).
//
// CLEAN-ROOM: no real secret literal — the inline-credential samples are synthesized at runtime
// (the same posture as the P4 telemetry test), so nothing credential-shaped sits in the tree.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  lintTelemetryConfig,
  telemetryConfigIsClean,
  OTLP_HEADERS_ENV,
  PROMPT_CONTENT_LOGGING_SWITCHES,
} from '../src/core/telemetry-config.js';
import { PROFILES } from '../src/governance/profile-evaluator.js';
import { parseEnvFile } from '../tools/telemetry-config-lint.js';

// Build a credential-shaped bearer token AT RUNTIME (never a literal in the tree).
function makeInlineToken() {
  const lowers = 'abcdefghijklmnopqrstuvwxyz';
  const uppers = lowers.toUpperCase();
  const digits = '0123456789';
  let out = '';
  for (let i = 0; i < 14; i++) out += lowers[(i * 7 + 3) % 26] + uppers[(i * 5 + 1) % 26] + digits[(i * 3) % 10];
  return out; // 42 chars, mixed case + digits, high entropy → secret-scan flags it
}

// =====================================================================================
// Clause 1 — no prompt/tool-input content logging under profile A
// =====================================================================================

test('profile A: a config with no prompt-logging switches is clean', () => {
  const env = {
    CLAUDE_CODE_ENABLE_TELEMETRY: '1',
    OTEL_METRICS_EXPORTER: 'otlp',
    OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4317',
  };
  assert.deepEqual(lintTelemetryConfig({ env, profile: PROFILES.COMPLIANCE }), []);
  assert.equal(telemetryConfigIsClean({ env, profile: PROFILES.COMPLIANCE }), true);
});

test('NON-VACUITY clause 1: each prompt/tool-input switch enabled under profile A is rejected', () => {
  for (const sw of PROMPT_CONTENT_LOGGING_SWITCHES) {
    const env = { CLAUDE_CODE_ENABLE_TELEMETRY: '1', [sw]: '1' };
    const v = lintTelemetryConfig({ env, profile: PROFILES.COMPLIANCE });
    assert.ok(
      v.some((m) => m.includes(sw) && m.includes('prompt/tool-input')),
      `enabling ${sw} under profile A must be a violation`,
    );
  }
  // "true" is also truthy
  assert.ok(
    lintTelemetryConfig({ env: { OTEL_LOG_USER_PROMPTS: 'true' }, profile: PROFILES.COMPLIANCE }).length > 0,
  );
});

test('clause 1 is profile-A-scoped: prompt logging under profile B is NOT a config-lint violation', () => {
  // profile B (convenience) makes no residency/ZDR promise, so this lint does not forbid it there.
  const env = { OTEL_LOG_USER_PROMPTS: '1' };
  assert.deepEqual(
    lintTelemetryConfig({ env, profile: PROFILES.CONVENIENCE }).filter((m) => m.includes('prompt/tool-input')),
    [],
  );
});

test('clause 1: a disabled switch (0/false/absent) is clean under profile A', () => {
  assert.deepEqual(lintTelemetryConfig({ env: { OTEL_LOG_USER_PROMPTS: '0' }, profile: PROFILES.COMPLIANCE }), []);
  assert.deepEqual(lintTelemetryConfig({ env: { OTEL_LOG_USER_PROMPTS: 'false' }, profile: PROFILES.COMPLIANCE }), []);
  assert.deepEqual(lintTelemetryConfig({ env: {}, profile: PROFILES.COMPLIANCE }), []);
});

// =====================================================================================
// Clause 2 — the OTLP header must be a secret REFERENCE, not an inline value
// =====================================================================================

test('clause 2: a placeholder OTLP header (${NAME}) is a reference and is clean', () => {
  const env = { [OTLP_HEADERS_ENV]: 'Authorization=Bearer ${OTLP_BEARER_TOKEN}' };
  assert.deepEqual(lintTelemetryConfig({ env, profile: PROFILES.COMPLIANCE }), []);
  // $NAME form too
  assert.deepEqual(
    lintTelemetryConfig({ env: { [OTLP_HEADERS_ENV]: 'Authorization=Bearer $OTLP_BEARER_TOKEN' }, profile: PROFILES.COMPLIANCE }),
    [],
  );
});

test('NON-VACUITY clause 2: an INLINE credential in the OTLP header is rejected', () => {
  const env = { [OTLP_HEADERS_ENV]: `Authorization=Bearer ${makeInlineToken()}` };
  const v = lintTelemetryConfig({ env, profile: PROFILES.COMPLIANCE });
  assert.ok(
    v.some((m) => m.includes(OTLP_HEADERS_ENV) && m.includes('INLINE')),
    'an inline bearer token in the OTLP header must be a violation',
  );
  // clause 2 holds under BOTH profiles (a secret value is a leak regardless of residency posture)
  assert.ok(lintTelemetryConfig({ env, profile: PROFILES.CONVENIENCE }).some((m) => m.includes('INLINE')));
});

test('clause 2: an absent / empty OTLP header is clean', () => {
  assert.deepEqual(lintTelemetryConfig({ env: {}, profile: PROFILES.COMPLIANCE }), []);
  assert.deepEqual(lintTelemetryConfig({ env: { [OTLP_HEADERS_ENV]: '' }, profile: PROFILES.COMPLIANCE }), []);
});

// =====================================================================================
// Fail-closed + the shipped reference
// =====================================================================================

test('fail-closed: a malformed config object is rejected', () => {
  assert.ok(lintTelemetryConfig({ env: null, profile: PROFILES.COMPLIANCE }).length > 0);
  assert.ok(lintTelemetryConfig({ env: 'nope', profile: PROFILES.COMPLIANCE }).length > 0);
  assert.ok(lintTelemetryConfig({}).length > 0);
});

test('the shipped profile-A reference env is profile-A-safe (the gate fixture)', () => {
  const text = readFileSync('deploy/telemetry/telemetry.profile-a.reference.env', 'utf8');
  const env = parseEnvFile(text);
  // sanity: the reference actually exercises the header path with a placeholder
  assert.ok(env[OTLP_HEADERS_ENV].includes('${'), 'reference uses a placeholder OTLP header');
  assert.deepEqual(
    lintTelemetryConfig({ env, profile: PROFILES.COMPLIANCE }),
    [],
    'the shipped reference must lint clean under profile A',
  );
});

test('parseEnvFile: skips comments/blank lines, keeps ${...} literal', () => {
  const env = parseEnvFile('# c\n\nA=1\nB=Bearer ${T}\n');
  assert.deepEqual(env, { A: '1', B: 'Bearer ${T}' });
});
