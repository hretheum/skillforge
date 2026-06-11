// content-sanitizer — invisible / confusable character neutralizer for inbound content
// — docs/11-security-and-secrets.md §"Inbound threat: untrusted source content".
//
// Sources: concept + first principles + public Unicode security guidance (UTS #39 confusable
// skeletons, bidi-control classes); zero files from any third-party skills-factory codebase
// (clean-room). See docs/11-security-and-secrets.md, docs/13-tool-governance.md.
//
// WHY THIS EXISTS. The inbound guard (inbound-guard.js) frames untrusted content in a labelled
// fence, but framing is byte-blind: a payload can hide a forged instruction behind characters
// that do not render — zero-width joiners between letters, a right-to-left override that
// reverses how a line reads, or Cyrillic glyphs that look like ASCII letters but compare as
// different code points. None of these survive a human read, but all of them survive into the
// model's text plane. This module strips/normalizes them BEFORE framing, so what gets fenced is
// what a reader would see, and records a finding per neutralized character so the manipulation
// is observable rather than silent.
//
// SCOPE. Character-level hygiene only — defense in depth, not a boundary (docs/11). The boundary
// remains the deny-first resolver, which never reads content at all. This neither parses nor
// trusts the content; it only removes invisible/confusable code points and reports what it did.

// --- zero-width / invisible characters (stripped) ---------------------------------------
// Each renders as nothing (or as a join hint), so it can split a word the eye reads as one
// token or pad a forged marker. Map: code point -> a short human label for the finding.
const ZERO_WIDTH = new Map([
  [0x200b, 'ZERO WIDTH SPACE'],
  [0x200c, 'ZERO WIDTH NON-JOINER'],
  [0x200d, 'ZERO WIDTH JOINER'],
  [0xfeff, 'ZERO WIDTH NO-BREAK SPACE / BOM'],
  [0x00ad, 'SOFT HYPHEN'],
]);

// --- bidirectional control characters (stripped) ----------------------------------------
// RTL overrides/embeddings/isolates can visually reorder text so a line reads differently than
// it is stored (the classic "Trojan Source" reordering). We strip every bidi format control in
// the override/embedding range and the isolate range.
const RTL_OVERRIDE = new Map([
  [0x202a, 'LEFT-TO-RIGHT EMBEDDING'],
  [0x202b, 'RIGHT-TO-LEFT EMBEDDING'],
  [0x202c, 'POP DIRECTIONAL FORMATTING'],
  [0x202d, 'LEFT-TO-RIGHT OVERRIDE'],
  [0x202e, 'RIGHT-TO-LEFT OVERRIDE'],
  [0x2066, 'LEFT-TO-RIGHT ISOLATE'],
  [0x2067, 'RIGHT-TO-LEFT ISOLATE'],
  [0x2068, 'FIRST STRONG ISOLATE'],
  [0x2069, 'POP DIRECTIONAL ISOLATE'],
]);

// --- confusable Cyrillic -> ASCII (replaced) --------------------------------------------
// Cyrillic glyphs that are visually identical (or near-identical) to ASCII Latin letters. A
// payload can spell an instruction or an allow-listed token in mixed scripts so it reads as
// ASCII but does not compare equal. We fold the common offenders to their ASCII look-alike and
// record the substitution. Map: Cyrillic code point -> { ascii, label }.
const CONFUSABLE = new Map([
  [0x0435, { ascii: 'e', label: 'CYRILLIC SMALL LETTER IE' }],
  [0x0430, { ascii: 'a', label: 'CYRILLIC SMALL LETTER A' }],
  [0x043e, { ascii: 'o', label: 'CYRILLIC SMALL LETTER O' }],
  [0x0440, { ascii: 'r', label: 'CYRILLIC SMALL LETTER ER' }],
  [0x0441, { ascii: 'c', label: 'CYRILLIC SMALL LETTER ES' }],
  [0x0445, { ascii: 'x', label: 'CYRILLIC SMALL LETTER HA' }],
  [0x0456, { ascii: 'i', label: 'CYRILLIC SMALL LETTER BYELORUSSIAN-UKRAINIAN I' }],
  [0x0455, { ascii: 's', label: 'CYRILLIC SMALL LETTER DZE' }],
  [0x0443, { ascii: 'y', label: 'CYRILLIC SMALL LETTER U' }],
]);

/** Format a code point as the canonical `U+XXXX` string (>= 4 hex digits, upper-case). */
function cp(codePoint) {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
}

/**
 * @typedef {object} SanitizerFinding
 * @property {'zero-width'|'rtl-override'|'confusable'} type
 * @property {string} description   human-readable note (what was removed/replaced)
 * @property {string} codepoint     the offending code point as `U+XXXX`
 * @property {number} position      index of the character in the ORIGINAL input string
 */

/**
 * Strip invisible characters and fold confusable Cyrillic to ASCII. Returns the cleaned string
 * plus one finding per neutralized character (in input order). Pure: same input -> same output.
 *
 * @param {unknown} str  raw inbound content (coerced to string; non-strings sanitize to '')
 * @returns {{ sanitized: string, findings: SanitizerFinding[] }}
 */
export function sanitizeContent(str) {
  if (typeof str !== 'string') return { sanitized: '', findings: [] };

  const findings = [];
  let out = '';
  // Iterate by code point (the spread/for-of walks full code points, not UTF-16 units), and
  // track the original index so a finding points at where the character actually was.
  let position = 0;
  for (const ch of str) {
    const code = ch.codePointAt(0);

    if (ZERO_WIDTH.has(code)) {
      findings.push({
        type: 'zero-width',
        description: `stripped ${ZERO_WIDTH.get(code)}`,
        codepoint: cp(code),
        position,
      });
      // stripped: contribute nothing to the output
    } else if (RTL_OVERRIDE.has(code)) {
      findings.push({
        type: 'rtl-override',
        description: `stripped ${RTL_OVERRIDE.get(code)}`,
        codepoint: cp(code),
        position,
      });
      // stripped
    } else if (CONFUSABLE.has(code)) {
      const { ascii, label } = CONFUSABLE.get(code);
      findings.push({
        type: 'confusable',
        description: `replaced ${label} with ASCII '${ascii}'`,
        codepoint: cp(code),
        position,
      });
      out += ascii;
    } else {
      out += ch;
    }

    position += ch.length; // advance by UTF-16 units so positions index the original string
  }

  return { sanitized: out, findings };
}
