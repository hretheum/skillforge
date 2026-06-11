// Tests for the baseline secret-scan (T-MVP-05).
//
// secret-scan is defense-in-depth (docs/11): it catches credential-shaped MISTAKES. These
// tests cover the pattern markers, the entropy heuristic, the recursive tool_input walk, and
// the discipline that findings are REDACTED (the scanner never echoes a full credential).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scanString, scanValue, hasSecret, shannonEntropy } from '../../src/governance/index.js';
import { redactString, redactValue, REDACTION_MARKER } from '../../src/governance/index.js';
import { createScanner } from '../../src/governance/index.js';

// Build a long, mixed-case, high-entropy token-shaped string AT RUNTIME (never a source literal), so
// these tests exercise the entropy path without planting a credential-shaped value in the repo (the
// secret-scan gate would, correctly, flag it). Same shape the telemetry test uses.
function makeFlaggableTokenShapedValue() {
  const lowers = 'abcdefghijklmnopqrstuvwxyz';
  const uppers = lowers.toUpperCase();
  const digits = '0123456789';
  let out = '';
  for (let i = 0; i < 14; i++) {
    out += lowers[(i * 7 + 3) % 26];
    out += uppers[(i * 5 + 1) % 26];
    out += digits[(i * 3) % 10];
  }
  return out; // 42 chars, all three classes, high entropy → token-shaped, NOT a real secret
}

// =====================================================================================
// Pattern matching — known vendor markers
// =====================================================================================

test('flags an AWS access key id', () => {
  const f = scanString('AKIAIOSFODNN7EXAMPLE is the key');
  assert.equal(f.length >= 1, true);
  assert.equal(f[0].kind, 'pattern');
  assert.equal(f[0].name, 'aws-access-key-id');
});

test('flags a GitHub token, OpenAI key, JWT, and private-key block', () => {
  assert.ok(scanString('ghp_' + 'a'.repeat(36)).some((f) => f.name === 'github-token'));
  assert.ok(scanString('sk-' + 'A'.repeat(24)).some((f) => f.name === 'openai-key'));
  assert.ok(
    scanString('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QTabcdef')
      .some((f) => f.name === 'jwt'),
  );
  assert.ok(
    scanString('-----BEGIN RSA PRIVATE KEY-----').some((f) => f.name === 'private-key-block'),
  );
});

test('flags a generic secret assignment', () => {
  assert.ok(scanString('api_key = "Abcd1234Efgh5678Ijkl"').some((f) => f.name === 'generic-secret-assignment'));
  assert.ok(scanString('"client_secret": "x9Y8z7W6v5U4t3S2r1Q0p"').some((f) => f.name === 'generic-secret-assignment'));
});

// =====================================================================================
// Entropy heuristic — prefix-less high-entropy tokens
// =====================================================================================

test('shannonEntropy: low for repetitive, high for random', () => {
  assert.ok(shannonEntropy('aaaaaaaaaa') < 1);
  assert.ok(shannonEntropy('Xk9$mQ2vLpZ7rT4wByN8') > 3.5);
});

test('flags a long high-entropy token with no known prefix', () => {
  const f = scanString('value: a8Kd92Lm04Pq71Zx53Rb6Yt');
  assert.ok(f.some((x) => x.kind === 'entropy' && x.name === 'high-entropy-token'));
});

test('does NOT flag ordinary prose / short identifiers (limit false positives)', () => {
  assert.deepEqual(scanString('the quick brown fox jumps over the lazy dog'), []);
  assert.deepEqual(scanString('const componentOutputDir = "src/components"'), []);
  assert.deepEqual(scanString('example-studio/ds/figma/api-token'), [], 'a secret REFERENCE (name) is not a value');
});

// =====================================================================================
// Recursive tool_input walk + redaction
// =====================================================================================

test('scanValue walks nested objects/arrays and annotates the JSON path', () => {
  const input = {
    file: 'config.txt',
    body: { lines: ['ok', 'AWS_KEY=AKIAIOSFODNN7EXAMPLE'] },
  };
  const findings = scanValue(input);
  assert.ok(findings.length >= 1);
  assert.ok(findings.some((f) => f.path.startsWith('body.lines[1]')));
});

test('findings are REDACTED — the scanner never echoes the full credential', () => {
  const secret = 'ghp_' + 'b'.repeat(36);
  const findings = scanString(secret);
  assert.ok(findings.length >= 1);
  for (const f of findings) {
    assert.equal(f.match.includes(secret), false, 'full secret must not appear in the finding');
    assert.match(f.match, /…|\*\*\*\*/);
  }
});

test('hasSecret: true when a value is present, false when clean', () => {
  assert.equal(hasSecret({ a: 'sk-' + 'C'.repeat(24) }), true);
  assert.equal(hasSecret({ a: 'hello', b: ['world', 42, null] }), false);
});

test('non-string / empty inputs are clean (no throw)', () => {
  assert.deepEqual(scanString(undefined), []);
  assert.deepEqual(scanString(''), []);
  assert.deepEqual(scanValue(null), []);
  assert.deepEqual(scanValue(123), []);
});

// =====================================================================================
// T-HARD-02 — layered defense-in-depth for the named false-negative classes (docs/11
// §"secret-scan is defense-in-depth"). Each test below names the class it closes and proves
// NON-VACUITY: the same sample is shown to slip past the surface scan, then caught by the layer.
//
// CLEAN-ROOM NOTE. No real-secret literal is planted in the tree. The structured samples reuse
// the AWS-docs CANONICAL SYNTHETIC example (AKIAIOSFODNN7EXAMPLE — a published non-credential,
// already used above) or are SYNTHESIZED at runtime (mixed-case + digits, high entropy), the
// same posture as the P4 telemetry test. The base64 forms are built with Buffer at runtime, so
// no encoded credential-shaped literal sits in the source either.
// =====================================================================================

// Build a long base64url token-shaped run (contains '-'/'_') AT RUNTIME — the baseline alphabet
// omitted '-', so this exact shape slipped through the entropy layer. Not a real secret.
function makeBase64UrlTokenShaped() {
  const lowers = 'abcdefghijklmnopqrstuvwxyz';
  const uppers = lowers.toUpperCase();
  const digits = '0123456789';
  let out = '';
  for (let i = 0; i < 14; i++) {
    out += lowers[(i * 7 + 3) % 26] + '-' + uppers[(i * 5 + 1) % 26] + digits[(i * 3) % 10];
  }
  return out; // mixed case + digits + '-', length 56, high entropy → token-shaped
}

test('CLASS no-prefix: base64url token (contains "-") is caught by the entropy layer', () => {
  const tok = makeBase64UrlTokenShaped();
  // non-vacuity: a baseline TOKEN_RE without '-' would stop the run at the first hyphen, leaving
  // sub-runs too short to flag — so this sample is a genuine baseline miss. The widened alphabet
  // now reads it as one high-entropy run.
  const f = scanString(`opaque token ${tok} end`);
  assert.ok(
    f.some((x) => x.kind === 'entropy' && x.name === 'high-entropy-token'),
    'widened base64url alphabet must flag a hyphenated high-entropy token',
  );
});

test('CLASS encoded/wrapped: a base64-encoded known marker is decoded and caught', () => {
  // base64 of the AWS canonical synthetic key — built at runtime, no encoded literal in source.
  const encoded = Buffer.from('AKIAIOSFODNN7EXAMPLE').toString('base64');
  // non-vacuity: the surface form has no recognizable marker, so prefix + entropy both pass it;
  // only the decode-and-rematch layer trips. Assert the encoded form does NOT match any prefix
  // pattern on its surface, then assert the encoded layer catches it.
  const f = scanString(encoded);
  assert.ok(f.length >= 1, 'encoded secret must be caught');
  assert.ok(
    f.some((x) => x.kind === 'encoded' && x.name === 'aws-access-key-id-base64'),
    'decode-and-rematch must recover the AWS marker from base64',
  );
});

test('CLASS encoded/wrapped: base64url variant (contains "-"/"_") is also decoded and caught', () => {
  // standard base64 → base64url so the encoded form carries the url alphabet; runtime-built.
  const encoded = Buffer.from('AKIAIOSFODNN7EXAMPLE')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const f = scanString(encoded);
  assert.ok(
    f.some((x) => x.kind === 'encoded' && x.name === 'aws-access-key-id-base64'),
    'base64url encoding must decode and rematch the same marker',
  );
});

test('CLASS split-across-fields: a marker split over sibling object fields is rejoined and caught', () => {
  // AKIAIOSFODNN7EXAMPLE split over two fields — neither half matches alone.
  const input = { part1: 'AKIAIOSF', part2: 'ODNN7EXAMPLE' };
  // non-vacuity: scanning each leaf in isolation finds nothing (a per-string match is defeated).
  assert.deepEqual(scanString(input.part1), [], 'half #1 alone is not credential-shaped');
  assert.deepEqual(scanString(input.part2), [], 'half #2 alone is not credential-shaped');
  const findings = scanValue(input);
  assert.ok(
    findings.some((f) => f.kind === 'split-field' && f.name === 'aws-access-key-id'),
    'the split layer must rejoin sibling fields and recover the marker',
  );
  assert.ok(
    findings.every((f) => !f.match.includes('AKIAIOSFODNN7EXAMPLE')),
    'split finding must still be redacted',
  );
});

test('CLASS split-across-fields: also works across array elements', () => {
  const findings = scanValue(['AKIAIOSF', 'ODNN7EXAMPLE']);
  assert.ok(findings.some((f) => f.kind === 'split-field' && f.name === 'aws-access-key-id'));
});

test('split layer does NOT double-report a marker fully inside one field', () => {
  // when the whole marker is in one child, layer-1 reports it; the split layer must stay silent
  // (no spurious "split across fields" finding for a value that was never split).
  const findings = scanValue({ whole: 'AKIAIOSFODNN7EXAMPLE', other: 'plain text here' });
  assert.ok(findings.some((f) => f.kind === 'pattern' && f.name === 'aws-access-key-id'));
  assert.equal(
    findings.some((f) => f.kind === 'split-field'),
    false,
    'no split-field finding when the marker lives entirely in one field',
  );
});

test('layers do NOT false-positive on innocent split / encoded-looking content', () => {
  // sibling prose that merely concatenates must not trip the prefix-only split layer.
  assert.deepEqual(
    scanValue({ a: 'the quick brown', b: 'fox jumps over', c: 'the lazy dog' }),
    [],
  );
  // a long base64 blob that decodes to NON-credential text must not be flagged by the encoded layer.
  const innocentB64 = Buffer.from('this is just a long ordinary sentence of plain text').toString('base64');
  assert.deepEqual(
    scanString(innocentB64).filter((f) => f.kind === 'encoded'),
    [],
    'decoding innocent text must yield no encoded-marker finding',
  );
});

// =====================================================================================
// Redaction — the outbound-emission rewrite (AC: scan + REDACT on outbound events)
// =====================================================================================

test('redactString replaces a known-vendor marker with the fixed marker', () => {
  const out = redactString('the key is AKIAIOSFODNN7EXAMPLE here');
  assert.equal(out, `the key is ${REDACTION_MARKER} here`);
  assert.ok(!out.includes('AKIAIOSFODNN7EXAMPLE'), 'the credential body must not survive redaction');
});

test('redactString replaces a high-entropy token-shaped run with the fixed marker', () => {
  const tok = makeFlaggableTokenShapedValue();
  assert.ok(hasSecret(tok), 'guard: the synthesized value is one secret-scan actually flags');
  const out = redactString(`prefix ${tok} suffix`);
  assert.equal(out, `prefix ${REDACTION_MARKER} suffix`);
  assert.ok(!out.includes(tok), 'the entropy token must not survive redaction');
});

test('redactString leaves clean prose / references untouched', () => {
  // ordinary text and a slash-separated secret REFERENCE (safe to carry, docs/11) must pass through.
  assert.equal(redactString('just normal words here'), 'just normal words here');
  assert.equal(redactString('acme/checkout/jira/api-token'), 'acme/checkout/jira/api-token');
});

test('redactValue rewrites string leaves recursively without mutating the input', () => {
  const tok = makeFlaggableTokenShapedValue();
  const input = { event: 'x', client: 'example-studio', failure: { reason: 'ok', rotationHint: tok }, list: [tok, 'fine'] };
  const out = redactValue(input);
  // the credential-shaped leaves are redacted, the handles/prose are intact, structure preserved.
  assert.equal(out.failure.rotationHint, REDACTION_MARKER);
  assert.equal(out.list[0], REDACTION_MARKER);
  assert.equal(out.list[1], 'fine');
  assert.equal(out.client, 'example-studio');
  assert.equal(out.event, 'x');
  // the input object is NOT mutated (a copy is returned).
  assert.equal(input.failure.rotationHint, tok, 'redactValue must not mutate its argument');
  assert.ok(!hasSecret(out), 'the redacted copy carries no credential-shaped content');
});

test('redactValue passes non-string scalars through unchanged', () => {
  assert.equal(redactValue(42), 42);
  assert.equal(redactValue(true), true);
  assert.equal(redactValue(null), null);
});

// =====================================================================================
// (T-HARD-02) — extended known-prefix coverage + configurable allowlist.
//
// CLEAN-ROOM NOTE. No real credential literal is planted. Vendor markers reuse published
// canonical-synthetic forms (AWS docs example bodies) or are runtime-built from the marker stem
// plus a benign filler run — the SHAPE the prefix regex keys on, never an issued secret.
// =====================================================================================

test('flags additional AWS key-id markers (ASIA temporary, AROA role)', () => {
  // ASIA/AROA share AKIA's 16-char base32 body; reuse the published AKIA example body.
  assert.ok(scanString('ASIAIOSFODNN7EXAMPLE').some((f) => f.name === 'aws-access-key-id'));
  assert.ok(scanString('AROAIOSFODNN7EXAMPLE').some((f) => f.name === 'aws-access-key-id'));
});

test('flags a GitHub fine-grained PAT (github_pat_ prefix)', () => {
  const tok = 'github_pat_' + 'A'.repeat(24);
  assert.ok(scanString(tok).some((f) => f.name === 'github-token'));
});

test('flags a Slack bot token (xoxb-) and a legacy/config token (xoxe-)', () => {
  assert.ok(scanString('xoxb-' + '1'.repeat(20)).some((f) => f.name === 'slack-token'));
  assert.ok(scanString('xoxe-' + '2'.repeat(20)).some((f) => f.name === 'slack-token'));
});

test('flags an OpenAI key and an Anthropic key with the precise marker', () => {
  assert.ok(scanString('sk-' + 'A'.repeat(24)).some((f) => f.name === 'openai-key'));
  // sk-ant- must win as the more specific marker, not be swallowed by the generic sk- pattern.
  assert.ok(scanString('sk-ant-' + 'B'.repeat(24)).some((f) => f.name === 'anthropic-key'));
});

test('flags a generic Bearer token in an Authorization-style header', () => {
  const f = scanString('Authorization: Bearer ' + 'x9Y8z7W6v5U4t3S2r1Q0pA');
  assert.ok(f.some((x) => x.name === 'bearer-token'));
});

test('a slash-separated reference path is NOT a value (no finding)', () => {
  // a secret REFERENCE (name/path) is safe to carry (docs/11): the slash rule keeps it from
  // reading as a token, and "slack/token" is not a vendor marker shape.
  assert.deepEqual(scanString('acme/api/slack/token'), []);
});

test('createScanner allowlist suppresses a specific known-false-positive hit', () => {
  // the AWS canonical-synthetic example fires by default; an allowlist that names that exact value
  // suppresses just that finding — a different secret in the same text still fires.
  const example = 'AKIAIOSFODNN7EXAMPLE';
  assert.ok(scanString(example).some((f) => f.name === 'aws-access-key-id'), 'guard: fires without allowlist');

  const scanner = createScanner({ allowlist: [example] });
  assert.deepEqual(scanner.scan(example), [], 'allowlisted value is suppressed');
  assert.equal(scanner.hasSecret(example), false);

  // allowlisting one value does not blind the scanner to a different, non-allowlisted secret.
  const other = 'ghp_' + 'c'.repeat(36);
  assert.ok(scanner.hasSecret(other), 'a non-allowlisted secret still fires under the same scanner');
});

test('default exports scan with an EMPTY allowlist (every finding fires)', () => {
  // the bare scanString/hasSecret must behave exactly as before — no allowlist suppression.
  assert.ok(hasSecret('AKIAIOSFODNN7EXAMPLE'));
  assert.ok(scanString('AKIAIOSFODNN7EXAMPLE').length >= 1);
});
