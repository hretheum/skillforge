// Per-session telemetry resource attributes — the `skillforge.skill` + `skillforge.client`
// injection seam (OBS-01).
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room). Realizes docs/10-telemetry-and-grafana.md §"Where the `skill` and
// `client` dimensions come from" (path 1, the chosen path) + §architecture, and respects
// docs/11-security-and-secrets.md (no secret VALUES in telemetry) and docs/03-client-model.md
// (telemetry is an engine-environment concern, never client data).
//
// WHY THIS EXISTS (OBS-01). The headline cost / cache-hit KPIs slice BY SKILL and BY CLIENT, but
// the attributes the Claude Code runtime emits natively (session.id, model, app.version, org id)
// carry NO `skill` or `client` dimension. The factory's build model makes the missing dimensions
// exact: one Claude Code session = one client + one skill (a run IS "this client's config, this
// skill, one artifact"). So stamping the SESSION once with `skillforge.skill` and
// `skillforge.client` as OTEL RESOURCE ATTRIBUTES correctly labels EVERY metric and event that
// session emits — including the native cost/token metrics — with no per-metric work.
//
// HONEST INFRA BOUNDARY. This module is the ENGINE-SIDE EMISSION only: it computes the per-session
// resource-attribute string in the standard OTEL form (`key=value,key=value`, the wire shape of
// `OTEL_RESOURCE_ATTRIBUTES`). The runtime that launches the session reads that env var via the
// OpenTelemetry SDK; the collector / Prometheus / Loki / Grafana that store and draw the signals
// are the DEPLOY stack (deploy/ — docker-compose + config + dashboards), not this code. We DO NOT
// stand up a live pipeline here; we produce the label the pipeline groups by.
//
// OPT-IN / NO-OP. Telemetry is off until deliberately enabled (docs/10 §"Turning it on"). When the
// caller signals no collector is configured, `resourceAttributesEnv()` returns null and the run is
// unaffected — exactly like the skill_result sink, telemetry is additive and never the reason a
// generation changes shape or fails.
//
// SECRET-FREE BY CONSTRUCTION (docs/10 privacy + docs/11). The only values stamped are the SKILL
// name and the CLIENT HANDLE — the same low-cardinality grouping handle docs/03 already uses
// (`example-studio`), never client content, never a secret value. The builder fail-closed secret-scans
// the attributes it is about to emit and refuses any credential-shaped value (a telemetry leak is a
// leak), the same discipline as the skill_result event.

import { hasSecret } from "../governance/secret-scan.js";

/** The skillforge-namespaced resource-attribute keys (custom, alongside the runtime's native ones). */
export const TELEMETRY_ATTR = Object.freeze({
  SKILL: "skillforge.skill",
  CLIENT: "skillforge.client",
});

/**
 * The OTEL env var the runtime reads resource attributes from (docs/10, path 1). Named here so the
 * deploy/runner that launches a session sets exactly this key — the engine decides WHAT the
 * attributes are, the environment decides that they are applied.
 */
export const OTEL_RESOURCE_ATTRIBUTES_ENV = "OTEL_RESOURCE_ATTRIBUTES";

// A resource-attribute value must not carry the OTEL list/pair delimiters or it would corrupt the
// `key=value,key=value` envelope. Handles are low-cardinality slugs; anything with these is refused
// (validate before acting) rather than silently mangling the telemetry stream.
const FORBIDDEN_IN_VALUE = /[,=]/;

function assert(cond, msg) {
  if (!cond) throw new TypeError(msg);
}

/**
 * Build the per-session skillforge resource attributes as a plain object. PURE — it constructs and
 * validates the attributes but does not apply them (the runner sets the env var). Refuses a
 * secret-bearing or delimiter-bearing value (fail-closed).
 *
 * @param {object} session
 * @param {string} session.skill   the skill this session runs (e.g. "create-component")
 * @param {string} session.client  the client HANDLE (a grouping label, never client content)
 * @returns {{ "skillforge.skill": string, "skillforge.client": string }}
 * @throws {TypeError} on a missing/non-string skill or client, a delimiter in a value, or a
 *   credential-shaped value detected in the attributes
 */
export function sessionResourceAttributes({ skill, client } = {}) {
  assert(typeof skill === "string" && skill.length > 0, "telemetry resource attributes require a non-empty skill");
  assert(typeof client === "string" && client.length > 0, "telemetry resource attributes require a non-empty client handle");
  assert(!FORBIDDEN_IN_VALUE.test(skill), `skill attribute value must not contain ',' or '=' (got ${JSON.stringify(skill)})`);
  assert(!FORBIDDEN_IN_VALUE.test(client), `client attribute value must not contain ',' or '=' (got ${JSON.stringify(client)})`);

  const attrs = {
    [TELEMETRY_ATTR.SKILL]: skill,
    [TELEMETRY_ATTR.CLIENT]: client,
  };

  // Telemetry must not become a secret-leak surface (docs/10 + docs/11). Scan the attributes we are
  // about to stamp onto every signal; if a value is credential-shaped, refuse — fail-closed, the
  // same posture as the skill_result event and the PreToolUse secret-scan.
  if (hasSecret(attrs)) {
    throw new TypeError(
      "refusing to build telemetry resource attributes: a value is credential-shaped " +
        "(telemetry carries the skill + client handle only — never a secret value)",
    );
  }
  return attrs;
}

/**
 * Serialize per-session attributes into the standard OTEL `OTEL_RESOURCE_ATTRIBUTES` string
 * (`key=value,key=value`). Deterministic key order (the contract order: skill, then client) so the
 * env value is byte-stable for a given session.
 *
 * @param {object} session  { skill, client } — see sessionResourceAttributes.
 * @returns {string} e.g. `skillforge.skill=create-component,skillforge.client=example-studio`
 */
export function resourceAttributesString(session) {
  const attrs = sessionResourceAttributes(session);
  // Fixed order — skill before client — independent of object-key iteration, so the string is a
  // pure function of the inputs (the byte-stability the prefix/cache discipline values everywhere).
  return `${TELEMETRY_ATTR.SKILL}=${attrs[TELEMETRY_ATTR.SKILL]},${TELEMETRY_ATTR.CLIENT}=${attrs[TELEMETRY_ATTR.CLIENT]}`;
}

/**
 * The opt-in/no-op env injection helper. Returns the `{ OTEL_RESOURCE_ATTRIBUTES: "<string>" }`
 * fragment a session runner MERGES into the launched process env — but ONLY when telemetry is
 * enabled; otherwise null, so a run with no collector configured is completely unaffected.
 *
 * Enablement mirrors docs/10 §"Turning it on": telemetry is on iff the master switch
 * `CLAUDE_CODE_ENABLE_TELEMETRY` is truthy in the provided environment. The engine reads the switch
 * but never sets it — enabling telemetry is the deployment's deliberate act.
 *
 * If an existing `OTEL_RESOURCE_ATTRIBUTES` is present in the environment, the skillforge attributes
 * are APPENDED (the runtime's native attributes and any operator-set ones are preserved); the
 * skillforge keys are added, never silently dropped.
 *
 * @param {object} session  { skill, client }
 * @param {object} [env]    the environment to read the switch / existing attrs from (default: process.env)
 * @returns {{ OTEL_RESOURCE_ATTRIBUTES: string } | null} the env fragment to merge, or null when off
 */
export function resourceAttributesEnv(session, env = process.env) {
  const master = env?.CLAUDE_CODE_ENABLE_TELEMETRY;
  const enabled = master === "1" || master === "true";
  if (!enabled) return null; // opt-in: no collector / telemetry off → no-op, the run is untouched

  const skillforgeAttrs = resourceAttributesString(session);
  const existing = typeof env?.[OTEL_RESOURCE_ATTRIBUTES_ENV] === "string"
    ? env[OTEL_RESOURCE_ATTRIBUTES_ENV].trim()
    : "";
  const value = existing.length > 0 ? `${existing},${skillforgeAttrs}` : skillforgeAttrs;
  return { [OTEL_RESOURCE_ATTRIBUTES_ENV]: value };
}
