// mcp/server integration tests. These drive the REAL stdio MCP server end to end:
// each test spawns `bin/skillforge.js mcp` as a child process, speaks newline-delimited
// JSON-RPC 2.0 over stdin/stdout, and asserts on the protocol-level response. No engine
// internals are imported — the server is exercised exactly as an MCP client would see it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../../bin/skillforge.js', import.meta.url));
const SKILL = fileURLToPath(new URL('../fixtures/sample-skill.md', import.meta.url));
const REGISTRY = fileURLToPath(new URL('../fixtures/sample-registry.json', import.meta.url));

const READ_TIMEOUT_MS = 5000;

function startServer() {
  return spawn(process.execPath, [BIN, 'mcp'], { stdio: ['pipe', 'pipe', 'pipe'] });
}

// Sends one JSON-RPC request and resolves with the first complete JSON-RPC response line
// whose id matches. Buffers stdout across chunks and splits on newlines, because the server
// emits newline-delimited JSON and a single chunk may carry several lines.
function sendRequest(child, id, method, params) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for response to ${method} (id=${id})`));
    }, READ_TIMEOUT_MS);

    function onData(chunk) {
      buffer += chunk.toString('utf8');
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line === '') continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue; // not a complete JSON line yet / unrelated diagnostic
        }
        if (message.id === id) {
          cleanup();
          resolve(message);
          return;
        }
      }
    }

    function onError(err) {
      cleanup();
      reject(err);
    }

    function cleanup() {
      clearTimeout(timer);
      child.stdout.removeListener('data', onData);
      child.removeListener('error', onError);
    }

    child.stdout.on('data', onData);
    child.on('error', onError);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

function notify(child, method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

async function initialize(child) {
  const res = await sendRequest(child, 1, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test', version: '0' },
  });
  notify(child, 'notifications/initialized', {});
  return res;
}

function callTool(child, id, name, args) {
  return sendRequest(child, id, 'tools/call', { name, arguments: args });
}

test('initialize handshake returns protocolVersion and serverInfo', async () => {
  const child = startServer();
  try {
    const res = await initialize(child);
    assert.equal(typeof res.result.protocolVersion, 'string');
    assert.equal(res.result.serverInfo.name, 'skillforge');
  } finally {
    child.kill();
  }
});

test('tools/list returns 7 tools with correct names', async () => {
  const child = startServer();
  try {
    await initialize(child);
    const res = await sendRequest(child, 2, 'tools/list', {});
    const names = res.result.tools.map((t) => t.name);
    assert.equal(res.result.tools.length, 7);
    assert.ok(names.includes('skillforge_emit'));
    assert.ok(names.includes('skillforge_list_profiles'));
    assert.ok(names.includes('skillforge_list_skills'));
    assert.ok(names.includes('skillforge_get_skill'));
    assert.ok(names.includes('skillforge_skills_update'));
    assert.ok(names.includes('skillforge_write_file'));
    assert.ok(names.includes('skillforge_read_file'));
  } finally {
    child.kill();
  }
});

test('skillforge_list_profiles returns known profiles', async () => {
  const child = startServer();
  try {
    await initialize(child);
    const res = await callTool(child, 3, 'skillforge_list_profiles', {});
    const payload = JSON.parse(res.result.content[0].text);
    assert.ok(payload.profiles.includes('open-core'));
    assert.ok(payload.profiles.includes('claude'));
    assert.ok(payload.profiles.includes('codex'));
  } finally {
    child.kill();
  }
});

test('skillforge_list_skills with explicit registry returns skill names', async () => {
  const child = startServer();
  try {
    await initialize(child);
    const res = await callTool(child, 4, 'skillforge_list_skills', { registry_path: REGISTRY });
    const payload = JSON.parse(res.result.content[0].text);
    assert.ok(payload.skills.some((s) => s.name === 'sample-skill'));
  } finally {
    child.kill();
  }
});

test('skillforge_list_skills with no registry returns empty list', async () => {
  const child = startServer();
  try {
    await initialize(child);
    const res = await callTool(child, 5, 'skillforge_list_skills', {
      registry_path: '/no/such/registry.json',
    });
    assert.notEqual(res.result.isError, true);
    const payload = JSON.parse(res.result.content[0].text);
    assert.deepEqual(payload.skills, []);
  } finally {
    child.kill();
  }
});

test('skillforge_get_skill rejects a path-traversal name', async () => {
  const child = startServer();
  try {
    await initialize(child);
    const res = await callTool(child, 30, 'skillforge_get_skill', {
      name: '../../../etc/passwd',
    });
    assert.equal(res.result.isError, true);
    assert.match(res.result.content[0].text, /invalid skill name/);
  } finally {
    child.kill();
  }
});

test('skillforge_get_skill on a not-installed name returns a helpful error', async () => {
  const child = startServer();
  try {
    await initialize(child);
    // A leading slash (as typed in chat) is stripped before resolution.
    const res = await callTool(child, 31, 'skillforge_get_skill', {
      name: '/sfg-definitely-not-a-real-skill',
    });
    assert.equal(res.result.isError, true);
    assert.match(res.result.content[0].text, /not installed/);
    assert.match(res.result.content[0].text, /skillforge_list_skills/);
  } finally {
    child.kill();
  }
});

test('skillforge_emit open-core writes output file', async () => {
  const child = startServer();
  const out = mkdtempSync(join(tmpdir(), 'sfg-mcp-emit-'));
  try {
    await initialize(child);
    const res = await callTool(child, 6, 'skillforge_emit', {
      skill_path: SKILL,
      profile: 'open-core',
      out_dir: out,
    });
    assert.notEqual(res.result.isError, true);
    const written = res.result.content[0].text;
    const expected = join(out, 'sample-skill.md');
    assert.ok(written.includes(expected));
    assert.ok(existsSync(expected));
  } finally {
    child.kill();
    rmSync(out, { recursive: true, force: true });
  }
});

test('skillforge_emit claude (with registry) writes the SKILL.md and its companion', async () => {
  const child = startServer();
  const out = mkdtempSync(join(tmpdir(), 'sfg-mcp-emit-claude-'));
  try {
    await initialize(child);
    const res = await callTool(child, 7, 'skillforge_emit', {
      skill_path: SKILL,
      profile: 'claude',
      out_dir: out,
      registry_path: REGISTRY,
    });
    assert.notEqual(res.result.isError, true);
    const written = res.result.content[0].text;
    const skillMd = join(out, 'sample-skill.md');
    assert.ok(written.includes(skillMd));
    assert.ok(existsSync(skillMd));
    // The claude flavour emits at least one companion alongside the SKILL.md.
    const emittedPaths = written.split('\n').filter((p) => p.trim() !== '');
    assert.ok(emittedPaths.length >= 2, 'claude emit writes the SKILL.md plus companion(s)');
    for (const p of emittedPaths) assert.ok(existsSync(p));
  } finally {
    child.kill();
    rmSync(out, { recursive: true, force: true });
  }
});

// File I/O tests must set SKILLFORGE_STATE_DIR so paths stay within the allowed root.
function startServerWithStateDir(stateDir) {
  return spawn(process.execPath, [BIN, 'mcp'], {
    env: { ...process.env, SKILLFORGE_STATE_DIR: stateDir },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

test('skillforge_write_file creates file and directories inside state root', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'sfg-state-'));
  const child = startServerWithStateDir(stateDir);
  try {
    await initialize(child);
    const res = await callTool(child, 8, 'skillforge_write_file', {
      path: 'sub/state.json',
      content: '{"session":"test"}',
    });
    assert.notEqual(res.result.isError, true);
    const payload = JSON.parse(res.result.content[0].text);
    assert.equal(payload.stateRoot, stateDir);
    assert.ok(existsSync(payload.written));
  } finally {
    child.kill();
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test('skillforge_read_file returns file content written via write_file', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'sfg-state-'));
  const child = startServerWithStateDir(stateDir);
  try {
    await initialize(child);
    await callTool(child, 9, 'skillforge_write_file', { path: 'note.md', content: '# Hello' });
    const res = await callTool(child, 10, 'skillforge_read_file', { path: 'note.md' });
    assert.notEqual(res.result.isError, true);
    assert.equal(res.result.content[0].text, '# Hello');
  } finally {
    child.kill();
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test('skillforge_read_file returns error for missing file', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'sfg-state-'));
  const child = startServerWithStateDir(stateDir);
  try {
    await initialize(child);
    const res = await callTool(child, 11, 'skillforge_read_file', { path: 'no-such.txt' });
    assert.equal(res.result.isError, true);
    assert.ok(res.result.content[0].text.includes('not found'));
  } finally {
    child.kill();
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test('skillforge_write_file rejects path escaping state root', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'sfg-state-'));
  const child = startServerWithStateDir(stateDir);
  try {
    await initialize(child);
    const res = await callTool(child, 12, 'skillforge_write_file', {
      path: '../../etc/passwd',
      content: 'bad',
    });
    assert.equal(res.result.isError, true);
    assert.ok(res.result.content[0].text.includes('SKILLFORGE_STATE_DIR'));
  } finally {
    child.kill();
    rmSync(stateDir, { recursive: true, force: true });
  }
});
