// Tests for the content sanitizer — docs/11-security-and-secrets.md §"Inbound threat:
// untrusted source content".
//
// Adversarial coverage for each neutralization category: zero-width / invisible characters
// (stripped), bidi RTL overrides/isolates (stripped), confusable Cyrillic (folded to ASCII).
// Also pins the integration: frameUntrustedContent sanitizes BEFORE fencing.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeContent, frameUntrustedContent } from '../../src/governance/index.js';

// =====================================================================================
// zero-width / invisible characters -> stripped
// =====================================================================================

test('zero-width space (U+200B) is stripped and recorded', () => {
  const { sanitized, findings } = sanitizeContent('ad​min');
  assert.equal(sanitized, 'admin');
  assert.ok(!sanitized.includes('​'));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'zero-width');
  assert.equal(findings[0].codepoint, 'U+200B');
  assert.equal(findings[0].position, 2);
});

test('every zero-width class (ZWNJ, ZWJ, BOM, SHY) is stripped', () => {
  const input = 'a‌b‍c﻿d­e';
  const { sanitized, findings } = sanitizeContent(input);
  assert.equal(sanitized, 'abcde');
  assert.equal(findings.length, 4);
  assert.deepEqual(
    findings.map((f) => f.codepoint),
    ['U+200C', 'U+200D', 'U+FEFF', 'U+00AD'],
  );
  assert.ok(findings.every((f) => f.type === 'zero-width'));
});

// =====================================================================================
// bidi RTL override / isolate -> stripped
// =====================================================================================

test('RTL override (U+202E) is stripped and recorded', () => {
  const { sanitized, findings } = sanitizeContent('safe‮elif.txt');
  assert.ok(!sanitized.includes('‮'));
  assert.equal(sanitized, 'safeelif.txt');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'rtl-override');
  assert.equal(findings[0].codepoint, 'U+202E');
});

test('the full bidi control range (embeddings, overrides, isolates) is stripped', () => {
  const input = '‪‫‬‭‮⁦⁧⁨⁩X';
  const { sanitized, findings } = sanitizeContent(input);
  assert.equal(sanitized, 'X');
  assert.equal(findings.length, 9);
  assert.ok(findings.every((f) => f.type === 'rtl-override'));
});

// =====================================================================================
// confusable Cyrillic -> folded to ASCII
// =====================================================================================

test('confusable Cyrillic small a (U+0430) is replaced with ASCII a', () => {
  const { sanitized, findings } = sanitizeContent('аdmin');
  assert.equal(sanitized, 'admin');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'confusable');
  assert.equal(findings[0].codepoint, 'U+0430');
  assert.match(findings[0].description, /ASCII 'a'/);
});

test('Cyrillic look-alikes fold to ASCII; unmapped Cyrillic passes through', () => {
  // "хакер": х→x, а→a, к(U+043A, not in the map)→unchanged, е→e, р→r.
  const { sanitized, findings } = sanitizeContent('хакер');
  assert.equal(sanitized, 'xaкer');
  assert.equal(findings.length, 4);
  assert.ok(findings.every((f) => f.type === 'confusable'));
  assert.deepEqual(
    findings.map((f) => f.codepoint),
    ['U+0445', 'U+0430', 'U+0435', 'U+0440'],
  );
});

// =====================================================================================
// mixed payload + ordering + non-string input
// =====================================================================================

test('mixed invisible + confusable payload: all neutralized, findings in input order', () => {
  const { sanitized, findings } = sanitizeContent('‮a​р');
  assert.equal(sanitized, 'ar'); // RTL stripped, ZWSP stripped, Cyrillic р -> r
  assert.deepEqual(
    findings.map((f) => f.type),
    ['rtl-override', 'zero-width', 'confusable'],
  );
});

test('clean ASCII content is unchanged with zero findings', () => {
  const { sanitized, findings } = sanitizeContent('plain ascii text 123');
  assert.equal(sanitized, 'plain ascii text 123');
  assert.equal(findings.length, 0);
});

test('non-string input sanitizes to empty string, no findings', () => {
  assert.deepEqual(sanitizeContent(null), { sanitized: '', findings: [] });
  assert.deepEqual(sanitizeContent(undefined), { sanitized: '', findings: [] });
  assert.deepEqual(sanitizeContent(42), { sanitized: '', findings: [] });
});

// =====================================================================================
// integration: frameUntrustedContent sanitizes BEFORE fencing
// =====================================================================================

test('frameUntrustedContent strips invisible chars before fencing', () => {
  const framed = frameUntrustedContent('ad​min‮txt');
  assert.ok(!framed.includes('​'));
  assert.ok(!framed.includes('‮'));
  assert.ok(framed.includes('admintxt'));
});

test('frameUntrustedContent surfaces sanitizer findings via the opts.findings sink', () => {
  const findings = [];
  frameUntrustedContent('a​р', { findings });
  assert.equal(findings.length, 2);
  assert.deepEqual(
    findings.map((f) => f.type),
    ['zero-width', 'confusable'],
  );
});
