// MCP-risk profiling + hook-injection detection — docs/13-tool-governance.md
// §"Enforcement seam — hooks"; docs/11-security-and-secrets.md §"Inbound threat: untrusted
// source content".
//
// Sources: concept + first principles, zero files from any third-party skills-factory codebase
// (clean-room).
//
// WHY THIS EXISTS. An MCP server manifest and a lifecycle hook descriptor are both inbound
// artifacts an attacker can shape to widen scope or open an egress channel BEFORE any tool call
// reaches the resolver. These two scanners profile those artifacts for consent-abuse and
// governance-bypass patterns so the seam can refuse to install/register them. Like the rest of the
// inbound plane this is detection, not the boundary — the resolver still governs every tool call —
// but a manifest that auto-approves a wildcard scope, or a hook that curls an external URL, is a
// signal worth surfacing loudly and failing closed on.

/**
 * @typedef {object} Finding
 * @property {string} type    a stable, grep-able finding code
 * @property {string} detail  a short human-readable explanation (never echoes a secret value)
 */

/**
 * @typedef {object} ScanResult
 * @property {boolean} safe              true iff findings is empty
 * @property {Finding[]} findings        every pattern matched (empty = clean)
 */

/** Wildcard scope tokens that grant unbounded permission. */
const WILDCARD_SCOPES = new Set(["*", "all"]);

/**
 * Profile an MCP server manifest for consent-abuse patterns (auto-approve, wildcard scope, shadow
 * install, external server). Fail-closed: a null/non-object manifest is NOT safe.
 *
 * @param {object} manifest  the parsed MCP server manifest object
 * @returns {ScanResult}
 */
export function scanMcpManifest(manifest) {
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    return { safe: false, findings: [{ type: "invalid-input", detail: "manifest must be a non-null object" }] };
  }

  const findings = [];

  // 1. AUTO-APPROVE — the manifest pre-consents to its own tool calls, defeating the consent gate.
  if (manifest["auto-approve"] === true || manifest.autoApprove === true) {
    findings.push({ type: "auto-approve", detail: "manifest pre-approves its own tool calls" });
  }

  // 2. WILDCARD-SCOPE — permissions/scope granting everything (string "*"/"all" or an array with "*").
  for (const field of ["permissions", "scope"]) {
    const value = manifest[field];
    if (typeof value === "string" && WILDCARD_SCOPES.has(value.toLowerCase())) {
      findings.push({ type: "wildcard-scope", detail: `${field} grants unbounded scope ("${value}")` });
    } else if (Array.isArray(value) && value.some(v => typeof v === "string" && WILDCARD_SCOPES.has(v.toLowerCase()))) {
      findings.push({ type: "wildcard-scope", detail: `${field} array contains a wildcard token` });
    }
  }

  // 3. SHADOW-INSTALL — the manifest installs itself without an explicit operator action.
  if (manifest.install === true || manifest.autoInstall === true) {
    findings.push({ type: "shadow-install", detail: "manifest requests silent self-install" });
  }

  // 4. EXTERNAL-SERVER — the server endpoint points off-host (anything but localhost/127.0.0.1).
  for (const field of ["serverUrl", "url"]) {
    const value = manifest[field];
    if (typeof value === "string" && value.includes("://") && !isLocalhost(value)) {
      findings.push({ type: "external-server", detail: `${field} points to a non-localhost endpoint` });
    }
  }

  return { safe: findings.length === 0, findings };
}

/**
 * Detect governance-bypass and egress patterns in a hook descriptor (network egress, external URL,
 * governance-bypass naming, dynamic eval). Fail-closed: null/non-object input or a missing command
 * is NOT safe.
 *
 * @param {object} hook  { name: string, command: string, event?: string }
 * @returns {ScanResult}
 */
export function detectHookInjection(hook) {
  if (hook === null || typeof hook !== "object" || Array.isArray(hook)) {
    return { safe: false, findings: [{ type: "invalid-input", detail: "hook must be a non-null object" }] };
  }
  if (typeof hook.command !== "string") {
    return { safe: false, findings: [{ type: "invalid-input", detail: "hook.command must be a string" }] };
  }

  const findings = [];
  const command = hook.command;
  const name = typeof hook.name === "string" ? hook.name : "";

  const cmdLower = command.toLowerCase();

  // 1. NETWORK-EGRESS — the command shells out to a network-fetch tool.
  if (/\b(?:curl|wget|ncat|netcat)\b|\bnc\s/i.test(command)) {
    findings.push({ type: "network-egress", detail: "command invokes a network-fetch tool" });
  }

  // 2. EXTERNAL-URL — the command embeds a URL with a network-reachable scheme.
  if (
    cmdLower.includes("http://") || cmdLower.includes("https://") ||
    cmdLower.includes("ftp://") || cmdLower.includes("gopher://") ||
    cmdLower.includes("dict://") || cmdLower.includes("file://")
  ) {
    findings.push({ type: "external-url", detail: "command embeds a URL with a network-reachable scheme" });
  }

  // 3. GOVERNANCE-BYPASS — name or command names an intent to override/bypass/disable/skip controls.
  if (/override|bypass|disable|skip/i.test(name) || /override|bypass|disable|skip/i.test(command)) {
    findings.push({ type: "governance-bypass", detail: "name/command signals an intent to bypass governance" });
  }

  // 4. DYNAMIC-EVAL — the command interprets arbitrary code at runtime.
  if (cmdLower.includes("eval(") || cmdLower.includes("function(") || cmdLower.includes("exec(")) {
    findings.push({ type: "dynamic-eval", detail: "command evaluates code dynamically" });
  }

  return { safe: findings.length === 0, findings };
}

// --- internals ----------------------------------------------------------------------------

/** True iff a URL's authority is an on-host loopback address (localhost, 127.0.0.1, ::1). */
function isLocalhost(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" ||
           hostname === "[::1]" || hostname === "::1";
  } catch {
    return false; // unparseable → treat as external (fail-closed)
  }
}
