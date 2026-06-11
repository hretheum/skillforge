// PreToolUse enforcement hook — docs/13-tool-governance.md §"Enforcement seam — hooks" +
// docs/11-security-and-secrets.md §"secret-scan runs in two places — CI and runtime".
//
// Sources: concept + first principles + public Claude Code hooks documentation (the
// PreToolUse decision shape is cited as one target surface); zero files from any third-party
// skills-factory codebase (clean-room). See docs/13-tool-governance.md.
//
// THE PER-CALL GATE. A resolver decision is only governance if something acts on it BEFORE
// the tool runs. This hook is that seam: it fires before every tool call and returns a
// decision (allow | ask | deny). It hosts BOTH controls docs/13/11 place here, DENY-FIRST:
//
//   1. TOOL SCOPE — calls the policy resolver (T-MVP-04) for (profile, layers, requiredTools,
//      tool); an out-of-scope call is DENIED at the seam, before the side effect.
//   2. secret-scan — inspects the proposed tool_input; a credential-shaped string about to be
//      written/sent is BLOCKED (deny), enforcing hard rules 1–3 at the moment of use, not
//      after the fact.
//
// Either deny wins (deny-first). secret-scan is checked even when the resolver would allow,
// because a permitted tool can still carry a leaked value in its input.
//
// MODEL-INDEPENDENT. The hook is plain logic over data; it does not call a model. It returns
// a vendor-neutral decision AND a Claude-Code-shaped projection (hookSpecificOutput.
// permissionDecision) so the same core can drive the Claude flavour without re-deciding.
//
// SCOPE (T-MVP-05): the seam + a baseline secret-scan. The inbound prompt-injection plane
// (T-HARD-01) and the layered secret-scan defense-in-depth (T-HARD-02) are separate hardening
// tasks that ride after the MVP — this hook is the choke point they will extend, not replace.

import { createPolicyResolver } from './policy-resolver.js';
import { scanValue } from './secret-scan.js';
import { matches } from './tool-patterns.js';

/** Vendor-neutral decisions the hook can return. */
export const HOOK_DECISION = Object.freeze({ ALLOW: 'allow', ASK: 'ask', DENY: 'deny' });

// An MCP tool call is named `mcp__<server>__<action>` (double underscores between the three
// segments). The server segment names the connector the call reaches — a stateful, often universal
// surface the tool-scope resolver's plain pattern rules do not treat as distinct. The MCP-policy
// control isolates that server name so a per-client allowlist can decide it before the resolver
// ever runs. Both server and action may themselves contain single underscores (e.g.
// `mcp__claude_ai_Notion__notion-search`), so the split is on the FIRST `__` after the `mcp__`
// prefix, not a greedy one.
const MCP_PREFIX = 'mcp__';

/** Extract the MCP server name from a tool call name, or null if the tool is not an MCP call. */
export function mcpServerOf(tool) {
  if (typeof tool !== 'string' || !tool.startsWith(MCP_PREFIX)) return null;
  const rest = tool.slice(MCP_PREFIX.length);
  const sep = rest.indexOf('__');
  // A well-formed MCP name has a non-empty server segment AND an action segment after `__`.
  if (sep <= 0 || sep + 2 >= rest.length) return null;
  return rest.slice(0, sep);
}

/**
 * Build a PreToolUse enforcement hook.
 *
 * @param {object} [deps]
 * @param {{resolve: Function}} [deps.resolver] the policy resolver; defaults to a fresh one
 * @param {(value: unknown) => Array} [deps.scan]  the secret scanner; defaults to scanValue
 * @returns {{ check: Function }}
 */
export function createPreToolUseHook(deps = {}) {
  const resolver = deps.resolver ?? createPolicyResolver();
  const scan = deps.scan ?? scanValue;

  /**
   * Decide a proposed tool call, BEFORE it runs.
   *
   * @param {object} call
   * @param {string|null} call.profile  active deployment profile (Layer-0 floor input)
   * @param {object} [call.layers]      org/client/project rule layers (resolver input)
   * @param {string[]} [call.requiredTools]  the active skill's requiredTools (Layer-4 gate)
   * @param {string} call.tool          the concrete tool name being called
   * @param {unknown} [call.toolInput]  the proposed tool input (scanned for secrets)
   * @param {object|null} [call.mcpPolicy]  the client's MCP-connector policy (allowlist + posture)
   * @returns {{
   *   decision: 'allow'|'ask'|'deny',
   *   reason: string,
   *   secretFindings: Array,
   *   hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: string, permissionDecisionReason: string },
   * }}
   */
  function check(call = {}) {
    const { profile = null, layers = {}, requiredTools = [], tool, toolInput, mcpPolicy = null } = call;
    // Inventory check (startup-time): validateRequiredToolsInventory() in this module.
    // TODO CC-37: compose runs BEFORE this gate and is unsandboxed trusted code — a recipe that opens
    //   a socket or shells out is invisible here; this gate governs DECLARED side-effect intents, not
    //   arbitrary compose behaviour. The clean-room contract assumes compose is pure/local. See.

    // --- control 2 (run first so a leak is reported even under an allow): secret-scan ---
    // A credential-shaped string in the proposed input is a hard DENY before the side effect.
    // Deny-first: this cannot be downgraded by a permissive resolver decision.
    const secretFindings = toolInput === undefined ? [] : safeScan(scan, toolInput);
    if (secretFindings.length > 0) {
      const where = secretFindings.map((f) => `${f.path} (${f.name})`).join(', ');
      return decision(
        HOOK_DECISION.DENY,
        `blocked: a credential-shaped string is about to be written/sent in tool input at ${where}; ` +
          `secrets must never enter an artifact/repo/network (references not values)`,
        secretFindings,
      );
    }

    // --- control 1b: MCP-connector policy (deny-first, runs before the tool-scope resolver) ---
    // An MCP tool reaches an external connector; a plain pattern rule cannot tell a trusted server
    // apart from an arbitrary one, so the per-client allowlist decides it here. A call to an
    // unknown server with NO policy, or to a server absent from a deny-posture allowlist, is denied
    // before the resolver ever sees it. Non-MCP tools fall straight through to the resolver.
    const mcpServer = mcpServerOf(tool);
    if (mcpServer !== null) {
      const mcpVerdict = decideMcp(mcpServer, mcpPolicy);
      if (mcpVerdict) return mcpVerdict;
    }

    // --- control 1: tool-scope resolver ---
    // A malformed resolver (throws) is itself a defect -> deny (fail-closed), never allow.
    let scopeDecision;
    try {
      scopeDecision = resolver.resolve({ profile, layers, requiredTools, tool });
    } catch {
      return decision(
        HOOK_DECISION.DENY,
        `blocked: the policy resolver failed while deciding tool "${tool}"; treating as denied (fail-closed)`,
        [],
      );
    }
    if (scopeDecision !== HOOK_DECISION.ALLOW && scopeDecision !== HOOK_DECISION.ASK) {
      // deny (or any unexpected value) -> deny at the seam.
      return decision(
        HOOK_DECISION.DENY,
        `blocked: tool "${tool}" is out of scope for this (profile, skill, client, project) — denied by the policy resolver`,
        [],
      );
    }

    // allow or ask: the call may proceed (ask = prompt the operator first).
    return decision(
      scopeDecision,
      scopeDecision === HOOK_DECISION.ASK
        ? `tool "${tool}" requires confirmation (resolver: ask)`
        : `tool "${tool}" permitted (resolver: allow; no secret in input)`,
      [],
    );
  }

  return { check };
}

// --- helpers ----------------------------------------------------------------------------

/**
 * Decide an MCP-server call against the client's MCP policy. Returns a DENY decision to short
 * circuit the gate, or null to fall through to the tool-scope resolver (allow path).
 *
 * Deny-first:
 *   - no policy at all                              -> DENY (fail-closed: unknown MCP is denied)
 *   - server in `allowedServers`                    -> fall through (allow)
 *   - defaultPosture === 'allow' (server not listed)-> fall through (allow, logged via reason)
 *   - otherwise (deny posture, or unknown posture)  -> DENY
 */
function decideMcp(server, mcpPolicy) {
  if (!mcpPolicy || typeof mcpPolicy !== 'object') {
    return decision(
      HOOK_DECISION.DENY,
      `blocked: MCP tool reaches connector "${server}" but this client declares no MCP policy; ` +
        `an unknown MCP connector is denied (fail-closed)`,
      [],
    );
  }
  const allowed = Array.isArray(mcpPolicy.allowedServers) ? mcpPolicy.allowedServers : [];
  if (allowed.includes(server)) return null; // explicitly trusted -> resolver decides the rest
  if (mcpPolicy.defaultPosture === 'allow') return null; // open posture -> allow (reason logged)
  return decision(
    HOOK_DECISION.DENY,
    `blocked: MCP connector "${server}" is not in this client's allowlist and the MCP policy ` +
      `posture is deny (mcp-server-not-in-policy)`,
    [],
  );
}

/** A scanner that throws is a defect; treat a scan failure as "found something" (fail-closed). */
function safeScan(scan, value) {
  try {
    const r = scan(value);
    return Array.isArray(r) ? r : [];
  } catch {
    return [{ path: '<scan-error>', name: 'scanner-failed', match: '****', kind: 'pattern' }];
  }
}

/** Build the dual-shaped result: vendor-neutral fields + the Claude-flavour projection. */
function decision(d, reason, secretFindings) {
  return {
    decision: d,
    reason,
    secretFindings,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: d,
      permissionDecisionReason: reason,
    },
  };
}

// --- startup-time inventory check (CC-36) -----------------------------------------------
//
// The per-call gate above (control 1) DENIES a tool the active skill never declared in
// requiredTools (the Layer-4 clamp). It does NOT verify the reverse: that every tool the skill
// DECLARES is one the deployment actually exposes. A skill that requires Bash under a 4-tool
// skillforge MCP surface will never reach the gate — the call simply never arrives — so the
// mismatch is silent. This is a deployment misconfiguration to flag at emit/startup time, not a
// per-call decision: it is the same for every call, so the engine checks it once before running.

/**
 * Validate that every tool in requiredTools is present in toolInventory.
 * Uses the shared pattern matcher so an `mcp__*` entry in the inventory covers `mcp__figma__foo`.
 * When toolInventory is empty/not provided, returns valid (no inventory = no constraint declared).
 *
 * @param {string[]} requiredTools  tools the skill declares it needs
 * @param {string[]} toolInventory  tools the deployment actually exposes
 * @returns {{ valid: boolean, missing: string[] }}
 */
export function validateRequiredToolsInventory(requiredTools, toolInventory) {
  if (!Array.isArray(toolInventory) || toolInventory.length === 0) {
    return { valid: true, missing: [] };
  }
  const required = Array.isArray(requiredTools) ? requiredTools : [];
  const missing = required.filter((t) => !toolInventory.some((inv) => matches(inv, t)));
  return { valid: missing.length === 0, missing };
}

/** A ready-to-use hook backed by a fresh resolver + the default scanner. */
export const preToolUseHook = createPreToolUseHook();
