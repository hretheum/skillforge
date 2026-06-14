// Hygiene tests for packages/ecc-bundle/skills.
//
// Two suites:
//   CONCRETE — one assertion per mechanically-fixed defect (TDD: written before the fix).
//   SAFETY-NET — structural invariants for every skill edited this sprint.
//
// Stack: node:test + node:assert, zero runtime deps.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SKILLS = join(import.meta.dirname, '../../packages/ecc-bundle/skills');

function skill(name) {
  return join(SKILLS, name, 'SKILL.md');
}

function read(name) {
  return readFileSync(skill(name), 'utf8');
}

// ---------------------------------------------------------------------------
// CONCRETE defect fixes
// ---------------------------------------------------------------------------

describe('CONCRETE', () => {
  test('1 — motion-ui dir does NOT exist (merged into motion-patterns)', () => {
    assert.ok(
      !existsSync(join(SKILLS, 'motion-ui')),
      'motion-ui directory should have been deleted after merge into motion-patterns',
    );
  });

  test('1 — motion-patterns SKILL.md has valid frontmatter after merge', () => {
    const content = read('motion-patterns');
    assert.ok(content.startsWith('---\n'), 'motion-patterns/SKILL.md must start with YAML front matter');
    assert.ok(content.includes('name:'), 'front matter must contain name:');
    assert.ok(content.includes('description:'), 'front matter must contain description:');
  });

  test('1 — motion-patterns contains device-adaptation content from motion-ui', () => {
    const content = read('motion-patterns');
    // The unique device-adaptation heuristic from motion-ui must have been folded in.
    assert.ok(
      content.includes('deviceMemory') || content.includes('hardwareConcurrency') || content.includes('device adapt'),
      'motion-patterns must contain device-adaptation content folded in from motion-ui',
    );
  });

  test('2a — security-scan: no stale "Opus 4.6" model reference', () => {
    const content = read('security-scan');
    assert.ok(
      !content.includes('Opus 4.6') && !content.includes('opus-4.6') && !content.includes('claude-opus-4-6'),
      'security-scan must not contain stale "Opus 4.6" model reference',
    );
  });

  test('2b — security-scan: ecc-agentshield install note is present', () => {
    const content = read('security-scan');
    assert.ok(
      content.includes('ecc-agentshield'),
      'security-scan must still reference ecc-agentshield',
    );
  });

  test('3 — browser-qa: no garbled mChild__ MCP namespace', () => {
    const content = read('browser-qa');
    assert.ok(
      !content.includes('mChild__'),
      'browser-qa must not contain garbled "mChild__" MCP namespace',
    );
  });

  test('4 — brand-voice: no author-personal "Affaan" name in skill body', () => {
    const content = read('brand-voice');
    assert.ok(
      !content.includes('Affaan'),
      'brand-voice must not contain author-personal name "Affaan"',
    );
  });

  test('5 — jira-integration: no hard-pinned ==0.21.0 version', () => {
    const content = read('jira-integration');
    assert.ok(
      !content.includes('==0.21.0'),
      'jira-integration must not contain hard-pinned version "==0.21.0"',
    );
  });

  test('6 — remotion-video-creation: frontmatter contains origin:', () => {
    const content = read('remotion-video-creation');
    // Extract the front matter block
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(fmMatch, 'remotion-video-creation must have YAML front matter');
    assert.ok(
      fmMatch[1].includes('origin:'),
      'remotion-video-creation front matter must contain origin:',
    );
  });

  test('6 — remotion-video-creation: description contains Use-when trigger', () => {
    const content = read('remotion-video-creation');
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(fmMatch, 'remotion-video-creation must have YAML front matter');
    assert.ok(
      fmMatch[1].includes('Use when') || fmMatch[1].includes('use when') || fmMatch[1].includes('Use-when'),
      'remotion-video-creation description must include a "Use when" trigger clause',
    );
  });

  test('7 — visa-doc-translate: frontmatter contains origin:', () => {
    const content = read('visa-doc-translate');
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(fmMatch, 'visa-doc-translate must have YAML front matter');
    assert.ok(
      fmMatch[1].includes('origin:'),
      'visa-doc-translate front matter must contain origin:',
    );
  });

  test('8 — blueprint: no "Vendored" install boilerplate section', () => {
    const content = read('blueprint');
    assert.ok(
      !content.includes('Vendored'),
      'blueprint must not contain bulky "Vendored" install boilerplate section',
    );
  });

  test('8 — blueprint: shorter than original 106-line version', () => {
    const content = read('blueprint');
    const lines = content.split('\n').length;
    assert.ok(
      lines < 90,
      `blueprint must be meaningfully shorter after trimming boilerplate (got ${lines} lines, want < 90)`,
    );
  });

  test('9 — safety-guard: contains PreToolUse hook snippet', () => {
    const content = read('safety-guard');
    assert.ok(
      content.includes('PreToolUse'),
      'safety-guard must contain a PreToolUse hook snippet',
    );
  });

  test('9 — safety-guard: contains settings.json code block', () => {
    const content = read('safety-guard');
    assert.ok(
      content.includes('settings.json'),
      'safety-guard must contain a settings.json reference in a hook snippet',
    );
  });
});

// ---------------------------------------------------------------------------
// SAFETY-NET — structural invariants for all skills edited this sprint
// ---------------------------------------------------------------------------

// All skills edited this sprint (9 concrete + 16 editorial).
// motion-ui is intentionally absent from this list (it was deleted).
const EDITED_SKILLS = [
  // 9 concrete fixes
  'motion-patterns',
  'security-scan',
  'browser-qa',
  'brand-voice',
  'jira-integration',
  'remotion-video-creation',
  'visa-doc-translate',
  'blueprint',
  'safety-guard',
  // 16 editorial skills
  'agentic-engineering',
  'api-design',
  'agent-eval',
  'continuous-agent-loop',
  'deep-research',
  'design-system',
  'documentation-lookup',
  'enterprise-agent-ops',
  'frontend-patterns',
  'hipaa-compliance',
  'configure-ecc',
  'ralphinho-rfc-pipeline',
  'strategic-compact',
  'team-agent-orchestration',
  'verification-loop',
  'workspace-surface-audit',
];

describe('SAFETY-NET', () => {
  for (const name of EDITED_SKILLS) {
    test(`${name} — SKILL.md exists`, () => {
      assert.ok(
        existsSync(skill(name)),
        `packages/ecc-bundle/skills/${name}/SKILL.md must exist`,
      );
    });

    test(`${name} — SKILL.md is non-empty`, () => {
      const content = read(name);
      assert.ok(content.trim().length > 0, `${name}/SKILL.md must not be empty`);
    });

    test(`${name} — SKILL.md has YAML front matter with name: and description:`, () => {
      const content = read(name);
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      assert.ok(fmMatch, `${name}/SKILL.md must have YAML front matter block`);
      assert.ok(
        fmMatch[1].includes('name:'),
        `${name}/SKILL.md front matter must contain name:`,
      );
      assert.ok(
        fmMatch[1].includes('description:'),
        `${name}/SKILL.md front matter must contain description:`,
      );
    });
  }
});
