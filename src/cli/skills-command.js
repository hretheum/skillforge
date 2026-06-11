// skills-command — the SHARED CORE of the `skills` subcommand.
//
// This module owns the install/list WORKFLOW for the global skill store (src/store): take a
// bundle SOURCE (an npm package or a local directory), find the skills it carries, copy each into
// the store, and record provenance in the manifest. It returns plain result data and never prints
// — the bin layer (bin/skillforge.js) formats and prints, mirroring the emit-command split. Logic
// in, presentation out.
//
// A bundle is a directory holding `skills/<name>/SKILL.md` per skill. An npm source is materialised
// to a temp dir via `npm install` and then read the same way, so local and npm paths converge on a
// single copy routine. Generic by construction: this file names no client and no skill.

import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { STORE_PATH } from '../store/index.js';
import { discoverSkills } from '../store/discovery.js';
import { readManifest, writeManifestEntry } from '../store/manifest.js';

const SKILL_FILE = 'SKILL.md';
const VERSION_MARKER = /^#\s*skillforge-version:\s*(.+?)\s*$/m;

// Short aliases for the curated first-party bundles, so `skillforge skills add ecc` resolves to the
// published package without the caller typing the scope. An alias only applies to a bare token; an
// explicit package spec or a local path is passed through untouched.
export const BUNDLE_ALIASES = {
  ecc: '@skillforge-core/ecc-bundle',
};

/** Does `source` address a local directory (absolute or explicitly-relative) rather than a package? */
function isLocalSource(source) {
  return source.startsWith('/') || source.startsWith('.');
}

/**
 * Read the version a bundle declares for one skill: the `# skillforge-version: <v>` marker in its
 * SKILL.md, or `"local"` when the marker is absent. The version is the unit of idempotency — a
 * re-install with the same version is skipped, a different version overwrites.
 */
function readSkillVersion(skillMdPath) {
  let text;
  try {
    text = readFileSync(skillMdPath, 'utf8');
  } catch {
    return 'local';
  }
  const match = text.match(VERSION_MARKER);
  return match ? match[1] : 'local';
}

/**
 * Enumerate the skills a bundle carries: each `<bundleDir>/skills/<name>/SKILL.md`. Returns
 * `[{ name, dir, skillMd, version }]`, sorted by name. A bundle with no `skills/` directory yields
 * an empty list (the caller decides whether that is an error).
 */
function bundleSkills(bundleDir) {
  const skillsRoot = join(bundleDir, 'skills');
  let entries;
  try {
    entries = readdirSync(skillsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(skillsRoot, entry.name);
    const skillMd = join(dir, SKILL_FILE);
    let isFile = false;
    try {
      isFile = statSync(skillMd).isFile();
    } catch {
      isFile = false;
    }
    if (!isFile) continue;
    skills.push({ name: entry.name, dir, skillMd, version: readSkillVersion(skillMd) });
  }
  skills.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return skills;
}

/**
 * Materialise an npm package into a temp dir and return the path to its installed package root
 * (`<tmp>/node_modules/<package>`). The caller is responsible for removing `tmpDir`.
 *
 * @returns {{ tmpDir: string, packageRoot: string }}
 * @throws {Error} with the npm stderr when the install fails (unknown package, no network, …).
 */
function installNpmPackage(source) {
  const tmpDir = mkdtempSync(join(tmpdir(), 'sf-skills-'));
  try {
    execFileSync('npm', ['install', '--prefix', tmpDir, '--no-save', '--silent', source], {
      stdio: 'pipe',
    });
  } catch (cause) {
    rmSync(tmpDir, { recursive: true, force: true });
    const stderr = cause && cause.stderr ? cause.stderr.toString().trim() : '';
    throw new Error(`npm install failed for ${source}: ${stderr || cause.message}`);
  }
  // Strip an npm version/tag spec ("pkg@1.2.3", "@scope/pkg@next") to the bare package name so it
  // maps to a node_modules directory. A scope's leading "@" is not a separator.
  const at = source.indexOf('@', source.startsWith('@') ? 1 : 0);
  const packageName = at > 0 ? source.slice(0, at) : source;
  const packageRoot = join(tmpDir, 'node_modules', packageName);
  if (!existsSync(packageRoot)) {
    rmSync(tmpDir, { recursive: true, force: true });
    throw new Error(`npm install failed for ${source}: package directory not found after install`);
  }
  return { tmpDir, packageRoot };
}

/**
 * Install a skill bundle from npm or a local directory into the global store.
 *
 * Idempotent per skill+version: a skill already present in the store with the same recorded version
 * is skipped (no overwrite); a missing or differently-versioned skill is (re)copied and its
 * provenance written to the manifest.
 *
 * @param {string} source  npm package name (e.g. "@skillforge-core/ecc-bundle") or a local bundle dir.
 * @param {object} [opts]
 * @param {string} [opts.storeDir]  override STORE_PATH (for tests).
 * @returns {Promise<{ installed: string[], skipped: string[] }>}
 * @throws {Error} on a bad source (missing dir, no skills, failed npm install).
 */
export async function skillsAddCommand(source, opts = {}) {
  if (typeof source !== 'string' || source.trim() === '') {
    throw new Error('skills add requires a <source> (npm package or local bundle directory)');
  }
  const storeDir = opts.storeDir || STORE_PATH;

  // Resolve a curated alias (e.g. "ecc") to its package spec; everything else passes through. A
  // local path is never aliased. `resolved` is what gets recorded as provenance.
  const resolved = isLocalSource(source) ? source : BUNDLE_ALIASES[source] || source;

  let bundleDir;
  let cleanupTmp;
  if (isLocalSource(resolved)) {
    if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
      throw new Error(`local bundle source is not a directory: ${resolved}`);
    }
    bundleDir = resolved;
  } else {
    const { tmpDir, packageRoot } = installNpmPackage(resolved);
    bundleDir = packageRoot;
    cleanupTmp = () => rmSync(tmpDir, { recursive: true, force: true });
  }

  try {
    const skills = bundleSkills(bundleDir);
    if (skills.length === 0) {
      throw new Error(`no skills found in bundle: ${resolved} (expected skills/<name>/SKILL.md)`);
    }

    const manifest = readManifest(storeDir);
    const installed = [];
    const skipped = [];
    const installedAt = new Date().toISOString();

    for (const skill of skills) {
      const target = join(storeDir, skill.name);
      const existing = manifest.skills[skill.name];
      const already = existsSync(target) && existing && existing.version === skill.version;
      if (already) {
        skipped.push(skill.name);
        continue;
      }
      rmSync(target, { recursive: true, force: true });
      cpSync(skill.dir, target, { recursive: true });
      writeManifestEntry(storeDir, skill.name, {
        source: resolved,
        version: skill.version,
        installedAt,
      });
      installed.push(skill.name);
    }

    return { installed, skipped };
  } finally {
    if (cleanupTmp) cleanupTmp();
  }
}

/**
 * List installed skills from the store, merging discovery (authoritative existence) with manifest
 * provenance. Skills present on disk but absent from the manifest report empty source/version and
 * an empty installedAt.
 *
 * @param {object} [opts]
 * @param {string} [opts.storeDir]  override STORE_PATH (for tests).
 * @returns {{ name: string, source: string, version: string, installedAt: string }[]}
 */
export function skillsListCommand(opts = {}) {
  const storeDir = opts.storeDir || STORE_PATH;
  const manifest = readManifest(storeDir);
  return discoverSkills(storeDir).map((skill) => {
    const provenance = manifest.skills[skill.name] || {};
    return {
      name: skill.name,
      source: provenance.source || '',
      version: provenance.version || '',
      installedAt: provenance.installedAt || '',
    };
  });
}
