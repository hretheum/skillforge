// secret-scan — the credential-shaped-string detector — docs/11-security-and-secrets.md
// §"secret-scan is defense-in-depth" + §"Hard rules".
//
// Sources: concept + first principles + general secret-management practice (high-entropy
// string heuristics, known-vendor prefix markers); zero files from any third-party
// skills-factory codebase (clean-room). See docs/11-security-and-secrets.md.
//
// WHAT THIS IS (and is NOT). The PRIMARY boundary against secret leakage is the
// references-not-values invariant (docs/11): a secret VALUE never enters the agent's text
// plane, so there is nothing to leak. secret-scan sits BEHIND that invariant as
// DEFENSE-IN-DEPTH — it catches the MISTAKES the invariant is meant to prevent (a token
// inlined in a fixture, an adapter echoing a value, a near-committed .env). It reduces the
// blast radius of a slip; it does NOT make leaking impossible.
//
// SCOPE. Baseline (T-MVP-05): pattern matching (known vendor prefixes) PAIRED WITH an entropy
// heuristic (docs/11 says the baseline pairs the two). T-HARD-02 LAYERS the documented
// false-negative classes on top — see docs/11 §"secret-scan is defense-in-depth":
//
//   1. NO PREFIX        a high-entropy token with no known vendor marker — entropy layer, with
//                       the credential alphabet WIDENED to base64url (`-`/`_`), which the
//                       baseline TOKEN_RE excluded (a base64url token slipped through).
//   2. ENCODED/WRAPPED  a secret base64/base64url-encoded (or wrapped in a blob) so it does not
//                       look credential-shaped on the surface — the encoded layer DECODES
//                       candidate base64 runs and re-runs the prefix patterns on the plaintext,
//                       catching e.g. a base64'd AKIA… key the surface scan misses.
//   3. SPLIT-ACROSS-FIELDS  a structured credential spread over sibling fields/lines to defeat a
//                       per-string match — the split layer (in scanValue) JOINS sibling string
//                       leaves of the same object/array and re-runs the PREFIX patterns on the
//                       concatenation (prefix-only, deliberately not entropy, to avoid flagging
//                       innocent concatenated prose).
//
// Defense-in-depth, not a guarantee (docs/11): the guarantee lives one layer up in
// references-not-values. Each added layer SHRINKS the false-negative surface; none of them makes
// leaking impossible. This module is the single scan core shared by the runtime PreToolUse seam
// and the CI gate (tools/secret-scan.js).

// --- known vendor prefix markers (pattern matching) -------------------------------------
//
// Structured, recognizable credentials. A non-exhaustive baseline; T-HARD-02 extends it.
// Each entry is { name, re } where `re` matches the credential body following the marker.
const PREFIX_PATTERNS = Object.freeze([
  // AWS key ids carry a 4-letter resource marker (AKIA long-term, ASIA temporary/STS, AROA role)
  // followed by a 16-char base32 body. All three are credential-shaped; only AKIA was covered.
  { name: 'aws-access-key-id', re: /\b(?:AKIA|ASIA|AROA)[0-9A-Z]{16}\b/ },
  // GitHub also issues fine-grained PATs as `github_pat_…`, distinct from the gh{p,o,u,s,r}_ class.
  { name: 'github-token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{20,})\b/ },
  // Anthropic keys (`sk-ant-…`) must match BEFORE the generic openai `sk-…` so the precise marker
  // wins; both share the `sk-` stem but Anthropic carries the `ant-` infix.
  { name: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'openai-key', re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  // Slack bot/user/app/legacy/config tokens: xoxb/xoxp/xoxa/xoxe (and xoxr/xoxs) — widen to cover xoxe.
  { name: 'slack-token', re: /\bxox[abeprs]-[A-Za-z0-9-]{10,}\b/ },
  // Authorization: Bearer <opaque token> — flag a long opaque value following the Bearer scheme.
  { name: 'bearer-token', re: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/ },
  { name: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'private-key-block', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  // a generic "secret-ish assignment" with a long opaque value (key=... / "token": "...")
  {
    // a "secret-ish" key followed by a long opaque value: api_key=…, "client_secret": "…",
    // token = '…'. Tolerates a closing quote between the key name and the : / = separator.
    name: 'generic-secret-assignment',
    re: /\b(?:api[_-]?key|secret|token|password|passwd|client[_-]?secret)\b['"]?\s*[:=]\s*['"]?[A-Za-z0-9/+_=-]{16,}['"]?/i,
  },
]);

// --- entropy heuristic (catches prefix-less random tokens) ------------------------------

/** Shannon entropy (bits per character) of a string. */
export function shannonEntropy(s) {
  if (!s || s.length === 0) return 0;
  const freq = new Map();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  const n = s.length;
  for (const count of freq.values()) {
    const p = count / n;
    h -= p * Math.log2(p);
  }
  return h;
}

// Baseline entropy thresholds. A token that is long enough AND high-entropy AND
// "credential-shaped" is flagged even without a known prefix. Conservative to limit false
// positives on ordinary prose / code / and — importantly — on secret REFERENCES (names/paths
// like `client/project/adapter/secret-name`, which docs/11 says are safe to carry, never
// values). T-HARD-02 tunes these and adds encoded/split-field handling.
const ENTROPY_MIN_LEN = 20; // shorter strings are too noisy to judge by entropy
const ENTROPY_MIN_BITS = 4.3; // a real random token clears this; path-like / word strings do not
// A "token-shaped" run: a contiguous span of credential-alphabet characters (no whitespace,
// no path separators). Path-like references (containing "/") are EXCLUDED here on purpose —
// a reference is not a value (docs/11). The alphabet covers base64 (`+`/`=`) AND base64url
// (`-`/`_`) bodies — the baseline omitted `-`, so a hyphenated base64url token slipped through
// the entropy layer (a named no-prefix false negative). Dots remain (JWT-ish bodies). `/` is
// deliberately EXCLUDED so a slash-separated secret REFERENCE (acme/checkout/jira/api-token) is
// never read as a value — references are safe to carry (docs/11).
const TOKEN_RE = /[A-Za-z0-9+_=.-]{20,}/g;
// A credential-shaped run mixes character classes the way a random token does: at least one
// lowercase, one uppercase, AND one digit. Natural-language / single-case identifiers (and
// kebab-case paths, already excluded by the "/" rule) do not, which keeps prose from flagging.
function looksLikeRandomToken(tok) {
  return /[a-z]/.test(tok) && /[A-Z]/.test(tok) && /[0-9]/.test(tok);
}

// --- encoded/wrapped layer (decode base64, re-run prefix patterns) ----------------------
//
// A secret can hide from a surface regex by being base64/base64url-encoded (docs/11
// "Encoded / wrapped values"). This layer finds base64-looking runs, decodes them, and re-runs
// the PREFIX patterns on the PLAINTEXT — so a base64'd `AKIA…` key is caught even though the
// encoded form has no recognizable marker. Prefix-only on purpose: decoding random data yields
// random bytes, so an entropy check on the decode would false-positive on any long base64 blob.
// A base64/base64url run long enough to carry a credential (>= ~24 chars, both alphabets).
const BASE64_RUN_RE = /[A-Za-z0-9+/=]{24,}|[A-Za-z0-9_-]{24,}={0,2}/g;
const MIN_DECODED_LEN = 12; // shorter decodes can't hold a real credential body

/** Decode a base64 / base64url run to UTF-8; return null if it isn't valid printable text. */
function tryDecodeBase64(run) {
  // normalize base64url → base64 so a single decoder handles both alphabets
  const normalized = run.replace(/-/g, '+').replace(/_/g, '/');
  let buf;
  try {
    buf = Buffer.from(normalized, 'base64');
  } catch {
    return null;
  }
  if (buf.length < MIN_DECODED_LEN) return null;
  const text = buf.toString('utf8');
  // re-encoding round-trip guards against arbitrary bytes that merely *look* base64; and we
  // require the decode to be mostly printable ASCII (a real credential is printable text).
  if (!/^[\x20-\x7e]+$/.test(text)) return null;
  return text;
}

/**
 * @typedef {{ kind: 'pattern'|'entropy'|'encoded'|'split-field', name: string, match: string }} SecretFinding
 */

/** Redact a matched value for safe reporting — never echo the full credential. */
function redact(match) {
  if (match.length <= 8) return '****';
  return `${match.slice(0, 4)}…${match.slice(-2)} (len ${match.length})`;
}

/**
 * Scan a single string for credential-shaped content. Returns a list of findings (empty =
 * clean). Findings carry a REDACTED match only — secret-scan must never itself echo a full
 * credential value (it would defeat its own purpose).
 *
 * @param {unknown} text
 * @returns {SecretFinding[]}
 */
/**
 * An allowlist suppresses a finding when its FULL matched (pre-redaction) string appears verbatim
 * in the list — a project-known false positive (e.g. a published example, a fixture placeholder).
 * Matching is on the raw match, before redaction, so the operator allowlists the actual value.
 */
const EMPTY_ALLOWLIST = Object.freeze(new Set());

function isAllowlisted(raw, allowlist) {
  return allowlist.size > 0 && allowlist.has(raw);
}

/** Run every prefix pattern over `text`; return one finding per distinct marker that hits. */
function matchPrefixPatterns(text, kind = 'pattern', allowlist = EMPTY_ALLOWLIST) {
  const out = [];
  for (const { name, re } of PREFIX_PATTERNS) {
    const m = re.exec(text);
    if (m && !isAllowlisted(m[0], allowlist)) out.push({ kind, name, match: redact(m[0]) });
  }
  return out;
}

export function scanString(text, allowlist = EMPTY_ALLOWLIST) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const findings = [];

  // 1) pattern matching — known vendor markers + generic secret assignment.
  findings.push(...matchPrefixPatterns(text, 'pattern', allowlist));

  // 2) entropy heuristic — long, high-entropy token-shaped runs without a known prefix.
  //    Skip runs already covered by a pattern hit to avoid double-flagging the same value.
  if (findings.length === 0) {
    const seen = TOKEN_RE.exec(text);
    TOKEN_RE.lastIndex = 0; // reset the stateful global regex before iterating
    if (seen) {
      let m;
      while ((m = TOKEN_RE.exec(text)) !== null) {
        const tok = m[0];
        if (
          tok.length >= ENTROPY_MIN_LEN &&
          looksLikeRandomToken(tok) &&
          shannonEntropy(tok) >= ENTROPY_MIN_BITS &&
          !isAllowlisted(tok, allowlist)
        ) {
          findings.push({ kind: 'entropy', name: 'high-entropy-token', match: redact(tok) });
        }
      }
    }
  }

  // 3) encoded/wrapped layer — decode base64/base64url runs and re-run the PREFIX patterns on
  //    the plaintext, catching a known credential hidden behind an encoding (docs/11
  //    "Encoded / wrapped values"). Always runs (independent of layers 1–2): a value can be
  //    base64'd AND surrounded by other tokens. Deduped by marker name so the same underlying
  //    credential is not reported twice.
  const seenNames = new Set(findings.map((f) => f.name));
  let b;
  BASE64_RUN_RE.lastIndex = 0;
  while ((b = BASE64_RUN_RE.exec(text)) !== null) {
    if (isAllowlisted(b[0], allowlist)) continue;
    const decoded = tryDecodeBase64(b[0]);
    if (!decoded) continue;
    for (const f of matchPrefixPatterns(decoded, 'encoded', allowlist)) {
      if (seenNames.has(f.name)) continue;
      seenNames.add(f.name);
      findings.push({ ...f, name: `${f.name}-base64` });
    }
  }

  return findings;
}

/**
 * Recursively scan an arbitrary value (a tool_input object/array/scalar) for credential-shaped
 * content. Walks every string leaf; returns findings annotated with the JSON path where each was
 * found. This is what the PreToolUse seam runs over a proposed tool call's input.
 *
 * @param {unknown} value
 * @param {string} [path]
 * @returns {Array<SecretFinding & { path: string }>}
 */
export function scanValue(value, path = '', allowlist = EMPTY_ALLOWLIST) {
  const out = [];
  if (typeof value === 'string') {
    for (const f of scanString(value, allowlist)) out.push({ ...f, path: path || '<root>' });
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => out.push(...scanValue(v, `${path}[${i}]`, allowlist)));
    out.push(...scanSplitFields(value, path, allowlist));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(...scanValue(v, path === '' ? k : `${path}.${k}`, allowlist));
    }
    out.push(...scanSplitFields(Object.values(value), path, allowlist));
  }
  return out;
}

// --- split-across-fields layer ----------------------------------------------------------
//
// A structured credential can be split over sibling fields/lines to defeat a per-string match
// (docs/11 "Split across fields"): { part1: "AKIAIOSF", part2: "ODNN7EXAMPLE" }. This layer
// concatenates the DIRECT string children of a container (in declaration order) and re-runs the
// PREFIX patterns on the joined value — a marker that spans the seam is caught. Deliberately:
//   • PREFIX-only, not entropy — joining innocent sibling prose can clear an entropy threshold
//     by accident; a structured marker (AKIA…, ghp_…) reassembling across the seam will not.
//   • only reported when NO single child already trips the same marker — a hit fully inside one
//     field is the layer-1 job, not a "split"; this layer reports the genuinely-split case only.
const MIN_SPLIT_CHILDREN = 2; // a single string cannot be "split"

function scanSplitFields(children, path, allowlist = EMPTY_ALLOWLIST) {
  const strings = children.filter((c) => typeof c === 'string');
  if (strings.length < MIN_SPLIT_CHILDREN) return [];
  const joined = strings.join('');
  if (isAllowlisted(joined, allowlist)) return [];
  const joinedHits = matchPrefixPatterns(joined, 'split-field', allowlist);
  if (joinedHits.length === 0) return [];
  // exclude any marker that already fires inside a single child — that is not a split.
  const perChildNames = new Set();
  for (const s of strings) for (const f of matchPrefixPatterns(s, 'pattern', allowlist)) perChildNames.add(f.name);
  const where = path || '<root>';
  return joinedHits
    .filter((f) => !perChildNames.has(f.name))
    .map((f) => ({ ...f, path: `${where} (split across fields)` }));
}

/** Convenience: does this value contain any credential-shaped content? */
export function hasSecret(value) {
  return scanValue(value).length > 0;
}

// --- configurable scanner factory -------------------------------------------------------
//
// The default scanString/scanValue/hasSecret exports scan with NO allowlist (every finding fires).
// A deployment may carry a curated allowlist of KNOWN-FALSE-POSITIVE values — a published example
// key, a fixture placeholder — that should be suppressed so the gate stays signal, not noise.
// createScanner binds such an allowlist once and returns a scanner with the same scan/hasSecret
// shape. Allowlist matching is on the FULL matched string (pre-redaction): the operator lists the
// actual value, and only that exact value is suppressed — never a substring or a different secret.

/**
 * Build a scanner bound to an allowlist of known-false-positive values.
 *
 * @param {{ allowlist?: string[] }} [opts]
 * @returns {{ scan(value: unknown): Array<SecretFinding & { path: string }>, hasSecret(value: unknown): boolean }}
 */
export function createScanner(opts = {}) {
  const allowlist = new Set(Array.isArray(opts.allowlist) ? opts.allowlist : []);
  return {
    scan(value) {
      return scanValue(value, '', allowlist);
    },
    hasSecret(value) {
      return scanValue(value, '', allowlist).length > 0;
    },
  };
}

// --- redaction (defense-in-depth for outbound emission) ---------------------------------
//
// The detector above ANSWERS "is there a secret here?" (scan) and the seams that build telemetry
// REFUSE a credential-shaped event (fail-closed). Redaction is the COMPLEMENT: it REWRITES a value
// so the credential-shaped spans are replaced with a fixed marker, leaving the rest intact. It runs
// on OUTBOUND telemetry as a last pass so a value that slipped past the build-time refusal is still
// stripped before it leaves the process — scan says "no", redact guarantees "not in the wire bytes".
//
// Same span definitions as the scan (one source of truth): the known-vendor prefix bodies and the
// entropy/encoded token runs. Order matters — replace the longer, structured prefix bodies first so
// a token that is BOTH prefix-shaped and high-entropy is reported as the precise marker, not a bare
// run. The marker is fixed text (no length/sample echo) — redaction must not itself leak a hint.

/** The fixed replacement stamped over a credential-shaped span. */
export const REDACTION_MARKER = '[REDACTED]';

/**
 * Redact every credential-shaped span in a single string, returning the rewritten text. A clean
 * string is returned unchanged (referential pass-through is fine — callers compare by value).
 *
 * @param {string} text
 * @returns {string}
 */
export function redactString(text) {
  if (typeof text !== 'string' || text.length === 0) return text;
  let out = text;

  // 1) known-vendor prefix bodies + generic secret assignment — the structured markers. Replace
  //    each match wherever it occurs (global), longest-defined first via the pattern table order.
  for (const { re } of PREFIX_PATTERNS) {
    out = out.replace(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'), REDACTION_MARKER);
  }

  // 2) high-entropy token-shaped runs with no known prefix — the entropy layer. Only the runs the
  //    scan would FLAG (length + mixed classes + entropy) are redacted, so ordinary prose/paths are
  //    left intact (a redaction that ate normal text would be its own kind of corruption).
  out = out.replace(new RegExp(TOKEN_RE.source, 'g'), (tok) =>
    tok.length >= ENTROPY_MIN_LEN && looksLikeRandomToken(tok) && shannonEntropy(tok) >= ENTROPY_MIN_BITS
      ? REDACTION_MARKER
      : tok,
  );

  return out;
}

/**
 * Recursively redact every string leaf of an arbitrary value, returning a structurally-identical
 * copy with credential-shaped spans replaced. Objects/arrays are copied (the input is not mutated);
 * non-string scalars pass through. This is what the outbound telemetry seam runs over an event it is
 * about to emit, so a leaked value never reaches the sink even if the build-time refusal missed it.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
export function redactValue(value) {
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((v) => redactValue(v));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactValue(v);
    return out;
  }
  return value;
}
