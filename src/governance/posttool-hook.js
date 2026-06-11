// PostToolUse observation hook — docs/13-tool-governance.md §"Enforcement seam — hooks" +
// docs/11-security-and-secrets.md §"secret-scan runs in two places — CI and runtime".
//
// Sources: concept + first principles + public Claude Code hooks documentation (the
// PostToolUse event shape is cited as one target surface); zero files from any third-party
// skills-factory codebase (clean-room). See docs/13-tool-governance.md.
//
// THE POST-CALL OBSERVER. PreToolUse is the per-call GATE: it decides before a tool runs and
// can deny the side effect. PostToolUse is the per-call WITNESS: it fires AFTER the tool has
// returned, when the side effect already happened, so it cannot deny retroactively. What it
// CAN do is observe the RESULT — the surface a pre-hook never sees — and:
//
//   1. secret-scan THE OUTPUT — a tool can ECHO a credential it received or surface one from
//      the environment (a command dumping an env var, an API returning a key). The pre-hook
//      scans the input; only the post-hook can scan what came back. A leak here is an ALERT
//      (the value is already out; the record + the operator response are the mitigation).
//   2. SCOPE DRIFT — confirm the tool that actually ran was in requiredTools. A pre-hook that
//      denied out-of-scope calls should make this impossible, but the post-hook records it as
//      a post-hoc VIOLATION (defense-in-depth: the gate could be bypassed or misconfigured).
//
// DENY-FIRST, RETROACTIVELY. The post-hook cannot un-run a tool, so its strongest verdict is
// 'alert' (surface + record) and, for a future call, 'block-next' (a signal the orchestrator
// may use to tighten the next PreToolUse decision). A clean call is 'log'. Like the pre-hook
// it is plain logic over data — it never calls a model.

import { scanValue } from './secret-scan.js';

/** What the observer asks the orchestrator to do with an already-completed call. */
export const POST_HOOK_ACTION = Object.freeze({
  LOG: 'log', // nothing notable — record and move on
  ALERT: 'alert', // notable (leak / scope drift) — surface + record, but the call already ran
  BLOCK_NEXT: 'block-next', // a signal to deny the NEXT call (reserved for escalation)
});

/**
 * Build a PostToolUse observation hook.
 *
 * @param {object} [deps]
 * @param {(value: unknown) => Array} [deps.scan] the secret scanner; defaults to scanValue
 * @returns {{ observe: Function }}
 */
export function createPostToolUseHook(deps = {}) {
  const scan = deps.scan ?? scanValue;

  /**
   * Observe a tool call AFTER it has returned.
   *
   * @param {object} call
   * @param {string} call.tool          the concrete tool name that ran
   * @param {unknown} [call.toolInput]  the input the tool ran with
   * @param {unknown} [call.toolResult] what the tool returned (scanned for secrets)
   * @param {string|null} [call.profile]  active deployment profile (carried for context)
   * @param {string[]} [call.requiredTools]  the active skill's requiredTools (scope check)
   * @param {object} [call.layers]      org/client/project rule layers (carried for context)
   * @returns {{
   *   action: 'log'|'alert'|'block-next',
   *   reason: string,
   *   findings: Array,
   *   hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: string },
   * }}
   */
  function observe(call = {}) {
    const { tool, toolResult, requiredTools = [] } = call;

    // --- control 1 (run first so a leak is reported even when scope also drifts): secret-scan
    // the RESULT. A credential-shaped string in tool output is already out — we cannot undo it,
    // so the strongest honest verdict is ALERT (surface + record), never a false "blocked".
    const findings = toolResult === undefined ? [] : safeScan(scan, toolResult);
    if (findings.length > 0) {
      const where = findings.map((f) => `${f.path} (${f.name})`).join(', ');
      return result(
        POST_HOOK_ACTION.ALERT,
        `secret detected in tool output at ${where}; the value has already left the tool — ` +
          `record + rotate (references not values)`,
        findings,
      );
    }

    // --- control 2: scope drift. The tool that ran should have been in requiredTools; a pre-hook
    // should have denied otherwise. Observing it here is post-hoc and cannot be undone, so it is
    // an ALERT logging the violation (defense-in-depth against a bypassed/misconfigured gate).
    if (!requiredTools.includes(tool)) {
      return result(
        POST_HOOK_ACTION.ALERT,
        `tool used outside declared requiredTools: "${tool}" is not in [${requiredTools.join(', ')}]; ` +
          `cannot be undone post-hoc — recorded as a scope violation`,
        [],
      );
    }

    // clean call, in scope: just log.
    return result(
      POST_HOOK_ACTION.LOG,
      `tool completed within scope: "${tool}" returned no secret-shaped output and was in requiredTools`,
      [],
    );
  }

  return { observe };
}

// --- helpers ----------------------------------------------------------------------------

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
function result(action, reason, findings) {
  return {
    action,
    reason,
    findings,
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: reason,
    },
  };
}

/** A ready-to-use hook backed by the default scanner. */
export const postToolUseHook = createPostToolUseHook();
