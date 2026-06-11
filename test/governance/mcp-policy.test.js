// Tests for the MCP-connector policy control in the PreToolUse hook.
//
// An MCP tool call (`mcp__<server>__<action>`) reaches an external connector. A plain tool-scope
// pattern rule cannot tell a trusted server apart from an arbitrary one, so the per-client MCP
// policy (allowlist + default posture) decides it BEFORE the resolver runs. Deny-first: a call
// with no policy, or to a server absent from a deny-posture allowlist, is denied at the seam.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createPreToolUseHook,
  preToolUseHook,
  HOOK_DECISION,
  PROFILES,
  mcpServerOf,
} from '../../src/governance/index.js';

// A resolver layer that would allow ANY tool, so the MCP control is the only thing that can deny
// an MCP call (isolating the control under test from the tool-scope resolver). The wildcard rule
// also covers the bare server-name resolution the resolver applies to the full mcp__ tool name.
const permissiveCall = (over = {}) => ({
  profile: PROFILES.CONVENIENCE,
  layers: { org: [{ pattern: '*', decision: 'allow' }] },
  requiredTools: ['*'],
  toolInput: { ok: true },
  ...over,
});

// =====================================================================================
// mcpServerOf — extracting the server segment from an MCP tool name
// =====================================================================================

test('mcpServerOf extracts the server name (single-segment and multi-underscore servers)', () => {
  assert.equal(mcpServerOf('mcp__tracker__delete'), 'tracker');
  assert.equal(mcpServerOf('mcp__claude_ai_Notion__notion-search'), 'claude_ai_Notion');
});

test('mcpServerOf returns null for non-MCP and malformed names', () => {
  assert.equal(mcpServerOf('Write'), null);
  assert.equal(mcpServerOf('Bash'), null);
  assert.equal(mcpServerOf('mcp__only-server'), null); // no action segment
  assert.equal(mcpServerOf('mcp____action'), null); // empty server segment
  assert.equal(mcpServerOf('mcp__server__'), null); // empty action segment
  assert.equal(mcpServerOf(undefined), null);
});

// =====================================================================================
// criterion 1 — no mcpPolicy config -> deny unknown MCP tool (fail-closed)
// =====================================================================================

test('MCP call with NO mcpPolicy -> DENY (fail-closed, unknown connector)', () => {
  const r = preToolUseHook.check(
    permissiveCall({ tool: 'mcp__tracker__delete', mcpPolicy: null }),
  );
  assert.equal(r.decision, HOOK_DECISION.DENY);
  assert.match(r.reason, /no MCP policy|fail-closed/);
});

test('MCP call with a non-object mcpPolicy -> DENY (fail-closed)', () => {
  const r = preToolUseHook.check(
    permissiveCall({ tool: 'mcp__tracker__delete', mcpPolicy: 'deny-everything' }),
  );
  assert.equal(r.decision, HOOK_DECISION.DENY);
});

// =====================================================================================
// criterion 2 — server in allowedServers -> allow
// =====================================================================================

test('MCP server in allowedServers -> ALLOW (resolver permits the rest)', () => {
  const r = preToolUseHook.check(
    permissiveCall({
      tool: 'mcp__figma__use_figma',
      mcpPolicy: { defaultPosture: 'deny', allowedServers: ['figma'] },
    }),
  );
  assert.equal(r.decision, HOOK_DECISION.ALLOW);
});

test('multi-underscore server name matched against allowlist -> ALLOW', () => {
  const r = preToolUseHook.check(
    permissiveCall({
      tool: 'mcp__claude_ai_Notion__notion-search',
      mcpPolicy: { defaultPosture: 'deny', allowedServers: ['claude_ai_Notion'] },
    }),
  );
  assert.equal(r.decision, HOOK_DECISION.ALLOW);
});

// =====================================================================================
// criterion 3 — server NOT listed, defaultPosture=deny -> deny
// =====================================================================================

test('MCP server NOT in allowlist, defaultPosture=deny -> DENY (mcp-server-not-in-policy)', () => {
  const r = preToolUseHook.check(
    permissiveCall({
      tool: 'mcp__tracker__delete',
      mcpPolicy: { defaultPosture: 'deny', allowedServers: ['figma'] },
    }),
  );
  assert.equal(r.decision, HOOK_DECISION.DENY);
  assert.match(r.reason, /mcp-server-not-in-policy/);
});

test('unknown/absent defaultPosture (not "allow") with empty allowlist -> DENY', () => {
  const r = preToolUseHook.check(
    permissiveCall({
      tool: 'mcp__tracker__delete',
      mcpPolicy: { allowedServers: [] },
    }),
  );
  assert.equal(r.decision, HOOK_DECISION.DENY);
});

// =====================================================================================
// criterion 4 — defaultPosture=allow, server not listed -> allow
// =====================================================================================

test('defaultPosture=allow with server not listed -> ALLOW (open posture)', () => {
  const r = preToolUseHook.check(
    permissiveCall({
      tool: 'mcp__tracker__delete',
      mcpPolicy: { defaultPosture: 'allow', allowedServers: [] },
    }),
  );
  assert.equal(r.decision, HOOK_DECISION.ALLOW);
});

// =====================================================================================
// criterion 5 — non-MCP tool unaffected (gate proceeds to the resolver normally)
// =====================================================================================

test('non-MCP tool is unaffected by the MCP control (resolver decides)', () => {
  // With NO mcpPolicy, a plain tool must still be decided by the resolver — proving the MCP
  // control does not fail-close non-MCP traffic.
  const allow = preToolUseHook.check(
    permissiveCall({ tool: 'Write', mcpPolicy: null, toolInput: { path: 'a.txt', text: 'hi' } }),
  );
  assert.equal(allow.decision, HOOK_DECISION.ALLOW);

  // And a non-MCP tool the resolver does NOT permit is denied by the resolver, not the MCP control.
  const deny = createPreToolUseHook().check({
    profile: PROFILES.CONVENIENCE,
    layers: {},
    requiredTools: [],
    tool: 'Bash',
    toolInput: { command: 'ls' },
    mcpPolicy: { defaultPosture: 'deny', allowedServers: [] },
  });
  assert.equal(deny.decision, HOOK_DECISION.DENY);
  assert.match(deny.reason, /out of scope/);
});

// =====================================================================================
// deny-first ordering — secret-scan still wins over the MCP control
// =====================================================================================

test('a credential-shaped input on an allowed MCP server -> DENY (secret-scan wins)', () => {
  const r = preToolUseHook.check(
    permissiveCall({
      tool: 'mcp__figma__use_figma',
      mcpPolicy: { defaultPosture: 'allow', allowedServers: ['figma'] },
      toolInput: { token: 'AKIAIOSFODNN7EXAMPLE' },
    }),
  );
  assert.equal(r.decision, HOOK_DECISION.DENY);
  assert.match(r.reason, /credential-shaped/);
});
