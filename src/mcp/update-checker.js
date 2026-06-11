// Startup update check — see if installed skill bundles have newer npm releases.
//
// On MCP server startup this runs asynchronously and non-blockingly: it reads the store manifest,
// collects the npm-package sources of installed skills, and asks npm for each one's latest version.
// A result is cached at the store root for one hour so repeated startups don't re-hit the network.
// Every failure mode — no network, npm absent, malformed output — is swallowed: the check is a
// courtesy, never a gate, so it returns [] rather than throwing. Sync npm calls are wrapped in a
// Promise so the caller can fire-and-forget. Zero runtime deps; the npm runner is injectable.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { STORE_PATH } from '../store/index.js';
import { readManifest } from '../store/manifest.js';

const CACHE_FILE = '.update-check-cache.json';
const CACHE_TTL_MS = 3_600_000;

// A source is checkable iff it looks like an npm package coordinate: a non-empty string that is
// not a filesystem path (absolute or relative). Local-path installs have no npm "latest".
// Strict allowlist: npm package names (scoped or plain) + optional @version suffix.
// Rejects filesystem paths and anything outside the npm registry name grammar.
// Names that start with '-' (e.g. '-rf') pass the regex but are neutered by the
// 'npm view --' end-of-options sentinel in execFileSync — npm treats them as a
// package lookup, not a flag. Defence-in-depth: regex + sentinel, not regex alone.
const NPM_PACKAGE_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(@[\w.\-+]+)?$/i;

function isNpmSource(source) {
  if (typeof source !== 'string' || source.length === 0) return false;
  return NPM_PACKAGE_RE.test(source);
}

// Compare two dotted version strings numerically, segment by segment. Returns true iff `latest` is
// strictly greater than `installed`. Non-numeric or missing segments are treated as 0, so this is a
// best-effort semver ordering — good enough to decide "is there something newer" without pulling in
// a semver dependency. A missing installed version makes any latest count as an update.
function isNewer(latest, installed) {
  if (typeof latest !== 'string' || latest.length === 0) return false;
  if (typeof installed !== 'string' || installed.length === 0) return true;
  const a = latest.split('.');
  const b = installed.split('.');
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = Number.parseInt(a[i], 10) || 0;
    const y = Number.parseInt(b[i], 10) || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

function readCache(cacheDir) {
  try {
    const raw = readFileSync(join(cacheDir, CACHE_FILE), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.timestamp !== 'number' || !Array.isArray(parsed.results)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(cacheDir, results) {
  try {
    const payload = JSON.stringify({ timestamp: Date.now(), results }, null, 2) + '\n';
    writeFileSync(join(cacheDir, CACHE_FILE), payload, 'utf8');
  } catch {
    // best-effort: a non-writable cache dir must not break the check
  }
}

// A cache is usable iff it is fresh AND already covers every source we currently care about. A new
// install that adds a source invalidates the cache even within the hour.
function cacheCovers(cache, sources) {
  if (Date.now() - cache.timestamp >= CACHE_TTL_MS) return false;
  const cached = new Set(cache.results.map((r) => r.source));
  return sources.every((s) => cached.has(s));
}

export async function checkForUpdates(opts = {}) {
  try {
    const storeDir = opts.storeDir || STORE_PATH;
    const cacheDir = opts.cacheDir || storeDir;
    const execNpm =
      opts.execNpm ||
      ((source) =>
        execFileSync('npm', ['view', '--', source, 'version'], { encoding: 'utf8', timeout: 5000 }));

    const manifest = readManifest(storeDir);
    const entries = manifest && manifest.skills ? Object.values(manifest.skills) : [];

    const sourceToVersion = new Map();
    for (const entry of entries) {
      if (entry && isNpmSource(entry.source) && !sourceToVersion.has(entry.source)) {
        sourceToVersion.set(entry.source, entry.version);
      }
    }
    const sources = [...sourceToVersion.keys()];
    if (sources.length === 0) return [];

    const cache = readCache(cacheDir);
    if (cache && cacheCovers(cache, sources)) {
      return cache.results;
    }

    const results = sources.map((source) => {
      const installed = sourceToVersion.get(source);
      const latest = String(execNpm(source)).trim();
      return { source, installed, latest, updateAvailable: isNewer(latest, installed) };
    });

    writeCache(cacheDir, results);
    return results;
  } catch {
    return [];
  }
}
