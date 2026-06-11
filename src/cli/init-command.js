// init-command — write (or update) the Claude Desktop MCP server entry for skillforge.
//
// `skillforge init` makes the engine reachable from Claude Desktop by registering it as an MCP
// server in claude_desktop_config.json. The entry runs this very CLI's `mcp` subcommand via node,
// pointed at the absolute path of bin/skillforge.js (resolved relative to this module so it stays
// correct wherever the repo lives). Idempotent: re-running with an unchanged target is a no-op.
//
// Returns plain result data and never prints — the bin layer formats and prints, mirroring the
// emit/skills split. Logic in, presentation out.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve the platform-specific Claude Desktop config path. An explicit override
// (CLAUDE_DESKTOP_CONFIG_PATH) always wins so tests never touch the real config.
function platformConfigPath() {
  if (process.env.CLAUDE_DESKTOP_CONFIG_PATH) return process.env.CLAUDE_DESKTOP_CONFIG_PATH;
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
    return join(appData, 'Claude', 'claude_desktop_config.json');
  }
  return join(homedir(), '.config', 'Claude', 'claude_desktop_config.json');
}

function readConfig(configPath) {
  let text;
  try {
    text = readFileSync(configPath, 'utf8');
  } catch {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`claude_desktop_config.json is not valid JSON — fix it manually: ${configPath}`);
  }
}

function shallowEqualEntry(a, b) {
  if (!a || !b) return false;
  if (a.command !== b.command) return false;
  const aArgs = a.args || [];
  const bArgs = b.args || [];
  if (aArgs.length !== bArgs.length) return false;
  return aArgs.every((arg, i) => arg === bArgs[i]);
}

/**
 * Write (or update) the Claude Desktop MCP server entry for skillforge.
 * @param {object} opts
 * @param {string} [opts.configPath]   — override config file path (for tests; default = platform path)
 * @param {string} [opts.skillsSource] — if provided, also run skillsAddCommand(skillsSource)
 * @param {string} [opts.storeDir]     — passed through to skillsAddCommand
 * @returns {Promise<{ configPath: string, wasUpdated: boolean }>}
 */
export async function initCommand(opts = {}) {
  const configPath = opts.configPath || platformConfigPath();
  const config = readConfig(configPath);

  if (!config.mcpServers || typeof config.mcpServers !== 'object') {
    config.mcpServers = {};
  }

  const binPath = fileURLToPath(new URL('../../bin/skillforge.js', import.meta.url));
  const target = { command: 'node', args: [binPath, 'mcp'] };

  const wasUpdated = !shallowEqualEntry(config.mcpServers.skillforge, target);
  if (wasUpdated) {
    config.mcpServers.skillforge = target;
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  }

  if (opts.skillsSource) {
    const { skillsAddCommand } = await import('./skills-command.js');
    await skillsAddCommand(opts.skillsSource, { storeDir: opts.storeDir });
  }

  return { configPath, wasUpdated };
}
