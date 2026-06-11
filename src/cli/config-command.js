// config-command — the SHARED CORE of the `skills config` sub-subcommand.
//
// Persists a small set of skillforge preferences to `<configHome>/config.json`, where configHome is
// `~/.skillforge` (the dirname of the store root). The first key is `auto-update`: when true, the
// MCP server installs newer bundle versions on startup instead of merely notifying. This module
// returns plain result data and never prints — the bin layer formats and prints. Sync, zero deps.
//
// Safe defaults: a missing file, missing key, or unreadable config all read as `{ autoUpdate: false }`,
// so a corrupt or absent config can never turn auto-update on by accident.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { STORE_PATH } from '../store/index.js';

const CONFIG_FILE = 'config.json';

// The config home is the dirname of the store root (~/.skillforge). Derived from STORE_PATH so the
// two stay in lockstep; the homedir() fallback only matters if STORE_PATH is ever relativised.
const DEFAULT_CONFIG_DIR = dirname(STORE_PATH) || join(homedir(), '.skillforge');

// Maps the CLI key spelling to its JSON field and a parser. Adding a key is a one-line entry here.
const KEYS = {
  'auto-update': { field: 'autoUpdate', parse: (v) => v === 'true' },
};

function configPathFor(configDir) {
  return join(configDir, CONFIG_FILE);
}

function readRaw(configDir) {
  try {
    const parsed = JSON.parse(readFileSync(configPathFor(configDir), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Read the skillforge config with safe defaults.
 *
 * @param {object} [opts]
 * @param {string} [opts.configDir]  override ~/.skillforge (for tests).
 * @returns {{ autoUpdate: boolean }}
 */
export function readConfig(opts = {}) {
  const configDir = opts.configDir || DEFAULT_CONFIG_DIR;
  const raw = readRaw(configDir);
  return { autoUpdate: raw.autoUpdate === true };
}

/**
 * Write a single config key, preserving any other keys already in the file.
 *
 * @param {string} key    a supported key (currently only "auto-update").
 * @param {string} value  "true" enables; anything else disables.
 * @param {object} [opts]
 * @param {string} [opts.configDir]  override ~/.skillforge (for tests).
 * @returns {{ key: string, value: boolean, configPath: string }}
 * @throws {Error} on an unknown key.
 */
export function writeConfig(key, value, opts = {}) {
  const spec = KEYS[key];
  if (!spec) throw new Error(`unknown config key: ${key}`);

  const configDir = opts.configDir || DEFAULT_CONFIG_DIR;
  const configPath = configPathFor(configDir);
  const parsed = spec.parse(value);

  const config = readRaw(configDir);
  config[spec.field] = parsed;

  mkdirSync(configDir, { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');

  return { key, value: parsed, configPath };
}
