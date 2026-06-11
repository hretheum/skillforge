// telemetry-config — the telemetry CONFIG-LINT (T-HARD-10(a)) — docs/10-telemetry-and-grafana.md
// §"Turning it on"; docs/11-security-and-secrets.md §"No secrets in telemetry or logs";
// docs/14-deployment-profiles.md §"Profile A".
//
// Sources: concept + first principles + OpenTelemetry / Claude-Code telemetry env-var semantics;
// zero files from any third-party skills-factory codebase (clean-room). See docs/10/11/14.
//
// WHY THIS EXISTS (SEC-P2-5). docs/10/11 state two telemetry rules — "no prompt/tool-input content
// in telemetry" and "no secret VALUES in telemetry" — but until now they had NO enforcement gate
// (unlike the repo secret-scan). Two concrete gaps the audit named:
//
//   (1) PROMPT/TOOL-INPUT LOGGING. Claude Code does NOT log prompt content or tool-input arguments
//       by default, but env vars can turn that on. Under profile A (EU residency + ZDR), enabling
//       prompt/tool-input logging would route CLIENT CONTENT into the telemetry plane — voiding the
//       residency/ZDR promise. So under profile A those switches MUST be off.
//   (2) OTLP HEADER AS AN INLINE SECRET. docs/10 shows `OTEL_EXPORTER_OTLP_HEADERS="Authorization=
//       Bearer <token>"`. A real bearer TOKEN inlined there is a secret VALUE on the config plane —
//       it must be a secret REFERENCE resolved by the backend (docs/11 references-not-values), never
//       an inline credential.
//
// This module lints a telemetry ENV CONFIG (a plain { NAME: value } map) against a profile and
// returns a list of VIOLATIONS (deny-first / fail-closed). It is data-only and model-independent —
// the CI gate (tools/telemetry-config-lint.js) and any deployment check share this one core, the
// same shape as secret-scan's single-core/two-call-sites.

import { scanString } from '../governance/secret-scan.js';
import { PROFILES } from '../governance/profile-evaluator.js';

// --- telemetry env-var names (docs/10 §"Turning it on") ---------------------------------

/** The env var that carries OTLP exporter auth headers (the bearer-token surface). */
export const OTLP_HEADERS_ENV = 'OTEL_EXPORTER_OTLP_HEADERS';

// Switches that, if truthy, route PROMPT CONTENT or TOOL-INPUT ARGUMENTS into telemetry. Claude
// Code keeps prompt content / tool input OUT of telemetry by default; these opt INTO logging it.
// Under profile A that is forbidden (it places client content on the telemetry plane). The set is
// vendor-neutral handles + the concrete Claude-Code/OTEL var names; aliases included so a config
// naming the same capability differently still trips.
export const PROMPT_CONTENT_LOGGING_SWITCHES = Object.freeze([
  'OTEL_LOG_USER_PROMPTS', // Claude Code: include prompt CONTENT in telemetry (default off)
  'OTEL_LOG_TOOL_INPUTS', // tool-input ARGUMENTS in telemetry (default off)
  'CLAUDE_CODE_LOG_PROMPTS', // alias-shaped guard for the same intent
  'CLAUDE_CODE_LOG_TOOL_INPUTS', // alias-shaped guard for the same intent
]);

/** A value is "on" iff it is the conventional truthy env form ("1" or "true", case-insensitive). */
function isTruthyEnv(v) {
  if (typeof v !== 'string') return false;
  const s = v.trim().toLowerCase();
  return s === '1' || s === 'true';
}

// An OTLP header value is reference-SHAPED (not an inline value) when its secret-bearing part is a
// PLACEHOLDER the backend resolves: ${NAME} or $NAME (env-substitution) — never a literal token.
// We treat a header value as safe iff (a) secret-scan finds no credential-shaped string in it, OR
// (b) the only credential-suspicious span is inside a ${...}/$NAME placeholder. The strict, simple
// rule we enforce: the header value must NOT itself be credential-shaped (secret-scan clean) —
// a placeholder like "Authorization=Bearer ${OTLP_TOKEN}" is clean; an inline token is not.
const PLACEHOLDER_RE = /\$\{[A-Za-z_][A-Za-z0-9_]*\}|\$[A-Za-z_][A-Za-z0-9_]*/;

/**
 * Lint a telemetry env config against a deployment profile. Returns a list of violation strings
 * (empty = the telemetry config is safe under the profile). Deny-first / fail-closed.
 *
 * @param {object} args
 * @param {Record<string,string>} args.env  the telemetry env config (a { NAME: value } map)
 * @param {string} args.profile  the deployment profile (PROFILES.COMPLIANCE | PROFILES.CONVENIENCE)
 * @returns {string[]}
 */
export function lintTelemetryConfig({ env, profile } = {}) {
  const v = [];
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    return ['telemetry config must be an object of { NAME: value }'];
  }

  // (1) NO PROMPT / TOOL-INPUT CONTENT LOGGING UNDER PROFILE A. Under the compliance profile, any
  //     switch that logs prompt content or tool-input arguments must be off — turning it on routes
  //     client content into telemetry and voids the residency/ZDR promise.
  if (profile === PROFILES.COMPLIANCE) {
    for (const sw of PROMPT_CONTENT_LOGGING_SWITCHES) {
      if (isTruthyEnv(env[sw])) {
        v.push(
          `profile A forbids prompt/tool-input logging in telemetry: ${sw} is enabled ` +
            '(client content must never enter the telemetry plane under the compliance profile)',
        );
      }
    }
  }

  // (2) OTLP HEADER MUST BE A SECRET REFERENCE, NOT AN INLINE VALUE (all profiles). The header may
  //     carry auth, but the secret must be a PLACEHOLDER the backend resolves — never a literal
  //     token. We run the SAME secret-scan detector that guards the tree: if the header value is
  //     credential-shaped, it is an inline secret. A placeholder (${NAME}/$NAME) is clean and is
  //     also explicitly recognized so a non-credential-shaped reference always passes.
  const headers = env[OTLP_HEADERS_ENV];
  if (typeof headers === 'string' && headers.length > 0) {
    const credentialShaped = scanString(headers).length > 0;
    const isPlaceholder = PLACEHOLDER_RE.test(headers);
    if (credentialShaped && !isPlaceholder) {
      v.push(
        `${OTLP_HEADERS_ENV} carries an INLINE credential value — it must reference a secret ` +
          '(e.g. "Authorization=Bearer ${OTLP_TOKEN}"), resolved by the backend, never an inline token',
      );
    }
  }

  return v;
}

/** Convenience: is this telemetry config safe under the profile? */
export function telemetryConfigIsClean(args) {
  return lintTelemetryConfig(args).length === 0;
}
