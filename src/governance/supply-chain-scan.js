// Supply-chain scanner — pre-adoption threat detection for third-party artifacts
// — docs/13-tool-governance.md §"Tool-pattern matching and subsumption" +
// docs/11-security-and-secrets.md §"Inbound threat: untrusted source content".
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room).
//
// WHY THIS EXISTS. A skill, an MCP config, or a hook descriptor is third-party CODE that wants
// to enter a client's config. Before adoption it must be read for threats the inbound content
// guards do not cover on their own: an injected SKILL.md body, a wildcard tool declaration that
// quietly grants everything, an MCP server scoped to "*", a hook that shells out to fetch from
// the network or that names itself an override of the governance spine. This module is the
// pre-adoption gate that reads each artifact and surfaces those findings.
//
// SCOPE. Detection only — defense in depth, not a boundary. The boundary stays the deny-first
// resolver. Fail-closed: malformed/null input reads as NOT clean, never a silent pass.

import { detectInjection } from './injection-guard.js';
import { INJECTION_CORPUS } from './injection-corpus.js';

/**
 * @typedef {object} Finding
 * @property {string} type    the threat class ("injection", "wildcard-tool", …)
 * @property {string} detail  one-line, human-readable description of the match
 */

/**
 * @typedef {object} ScanResult
 * @property {boolean} clean        true iff findings.length === 0
 * @property {Finding[]} findings   every threat found, in scan order
 */

const TOOL_DECL_RE = /tools\s*:\s*\[([^\]]*)\]/i;
const QUOTED_ENTRY_RE = /["']([^"']*)["']/g;
const URL_RE = /https?:\/\//i;
const EGRESS_RE = /\b(?:curl|wget)\b|fetch\s*\(/i;
const BYPASS_RE = /\b(?:override|bypass)\b/i;

function fail(detail) {
  return { clean: false, findings: [{ type: 'invalid-input', detail }] };
}

/**
 * Scan raw SKILL.md text (frontmatter + body) for adoption threats.
 *
 * @param {unknown} text  raw SKILL.md content
 * @returns {ScanResult}
 */
export function scanSkillManifest(text) {
  if (typeof text !== 'string') return fail('scanSkillManifest expects a string');

  const findings = [];

  const inj = detectInjection(text);
  if (inj.isInjection) {
    findings.push({ type: 'injection', detail: `injection markers: ${inj.patterns.join(', ')}` });
  }

  for (const entry of INJECTION_CORPUS) {
    if (text.includes(entry.content)) {
      findings.push({ type: 'injection', detail: `known injection family '${entry.family}' (${entry.id})` });
    }
  }

  const declared = [];
  const block = TOOL_DECL_RE.exec(text);
  if (block) {
    let m;
    QUOTED_ENTRY_RE.lastIndex = 0;
    while ((m = QUOTED_ENTRY_RE.exec(block[1])) !== null) declared.push(m[1]);
  }
  for (const t of declared) {
    if (t === '*') {
      findings.push({ type: 'wildcard-tool', detail: `tool declaration grants wildcard scope: "${t}"` });
    }
  }

  return { clean: findings.length === 0, findings };
}

/**
 * Scan a parsed .mcp.json config object for wildcard-scoped servers.
 *
 * @param {unknown} config  parsed MCP config ({ mcpServers: { … } } or a flat server map)
 * @returns {ScanResult}
 */
export function scanMcpConfig(config) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    return fail('scanMcpConfig expects a config object');
  }

  const servers = config.mcpServers && typeof config.mcpServers === 'object'
    ? config.mcpServers
    : config;

  const findings = [];

  for (const [name, server] of Object.entries(servers)) {
    if (server === null || typeof server !== 'object') continue;
    for (const field of ['permissions', 'scope']) {
      const value = server[field];
      const items = Array.isArray(value) ? value : value == null ? [] : [value];
      for (const item of items) {
        if (item === '*' || item === 'all') {
          findings.push({
            type: 'wildcard-scope',
            detail: `server "${name}" ${field} grants wildcard scope: "${item}"`,
          });
        }
      }
    }
  }

  return { clean: findings.length === 0, findings };
}

/**
 * Scan a hook descriptor for network egress and governance-bypass intent.
 *
 * @param {unknown} hook  { name, command, event }
 * @returns {ScanResult}
 */
export function scanHookDescriptor(hook) {
  if (hook === null || typeof hook !== 'object' || Array.isArray(hook)) {
    return fail('scanHookDescriptor expects a hook object');
  }

  const name = typeof hook.name === 'string' ? hook.name : '';
  const command = typeof hook.command === 'string' ? hook.command : '';

  const findings = [];

  if (EGRESS_RE.test(command) || URL_RE.test(command)) {
    findings.push({ type: 'egress-hook', detail: `hook command reaches the network: ${command}` });
  }

  if (BYPASS_RE.test(name) || BYPASS_RE.test(command)) {
    findings.push({ type: 'governance-bypass-hook', detail: `hook names an override/bypass: ${name || command}` });
  }

  return { clean: findings.length === 0, findings };
}
