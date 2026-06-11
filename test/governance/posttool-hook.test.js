// Tests for the PostToolUse observation hook.
//
// The post-hook fires AFTER a tool returns (docs/13 §enforcement seam) and cannot deny
// retroactively. It observes the RESULT: a secret echoed in output -> alert; a tool that ran
// outside requiredTools -> alert (post-hoc scope violation); an in-scope clean call -> log.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createPostToolUseHook,
  postToolUseHook,
  POST_HOOK_ACTION,
} from '../../src/governance/index.js';

// =====================================================================================
// secret in result -> alert
// =====================================================================================

test('secret-shaped string in tool output -> ALERT', () => {
  const r = postToolUseHook.observe({
    tool: 'Bash',
    requiredTools: ['Bash'],
    toolResult: { stdout: 'AWS_KEY=AKIAIOSFODNN7EXAMPLE' },
  });
  assert.equal(r.action, POST_HOOK_ACTION.ALERT);
  assert.match(r.reason, /secret detected in tool output/);
  assert.ok(r.findings.length > 0);
  assert.equal(r.hookSpecificOutput.hookEventName, 'PostToolUse');
});

test('secret alert wins even when the tool is also out of scope', () => {
  const r = postToolUseHook.observe({
    tool: 'mcp__x__y',
    requiredTools: ['Bash'],
    toolResult: 'ghp_0123456789abcdef0123456789abcdef0123',
  });
  assert.equal(r.action, POST_HOOK_ACTION.ALERT);
  assert.match(r.reason, /secret detected/);
});

// =====================================================================================
// out-of-scope tool -> alert
// =====================================================================================

test('tool that ran outside requiredTools -> ALERT (post-hoc scope violation)', () => {
  const r = postToolUseHook.observe({
    tool: 'mcp__tracker__delete',
    requiredTools: ['Read', 'Write'],
    toolResult: { ok: true },
  });
  assert.equal(r.action, POST_HOOK_ACTION.ALERT);
  assert.match(r.reason, /outside declared requiredTools/);
  assert.deepEqual(r.findings, []);
});

// =====================================================================================
// clean call -> log
// =====================================================================================

test('in-scope tool with clean output -> LOG', () => {
  const r = postToolUseHook.observe({
    tool: 'Read',
    requiredTools: ['Read', 'Write'],
    toolResult: { content: 'just some ordinary file text, nothing secret here' },
  });
  assert.equal(r.action, POST_HOOK_ACTION.LOG);
  assert.match(r.reason, /within scope/);
  assert.deepEqual(r.findings, []);
});

test('missing toolResult is not scanned -> LOG when in scope', () => {
  const r = postToolUseHook.observe({ tool: 'Read', requiredTools: ['Read'] });
  assert.equal(r.action, POST_HOOK_ACTION.LOG);
});

// =====================================================================================
// deny-first edge: a throwing scanner is treated as a finding
// =====================================================================================

test('a throwing scanner is treated as a finding -> ALERT (fail-closed)', () => {
  const hook = createPostToolUseHook({
    scan: () => {
      throw new Error('boom');
    },
  });
  const r = hook.observe({ tool: 'Read', requiredTools: ['Read'], toolResult: 'x' });
  assert.equal(r.action, POST_HOOK_ACTION.ALERT);
  assert.match(r.reason, /secret detected/);
});
