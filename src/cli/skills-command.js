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
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { STORE_PATH } from '../store/index.js';
import { discoverSkills } from '../store/discovery.js';
import { readManifest, writeManifestEntry } from '../store/manifest.js';
import { emit } from '../emit/index.js';
import { readConfig, writeConfig } from './config-command.js';

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

// Resolve the harness skills directory a target writes into. A target is a NAME (e.g. "superpowers")
// for messaging only — every target currently lands in the same Claude skills dir. The directory is
// overridable via CLAUDE_SKILLS_DIR (tests, alternate installs); the default is ~/.claude/skills.
function harnessSkillsDir() {
  return process.env.CLAUDE_SKILLS_DIR || join(homedir(), '.claude', 'skills');
}

/**
 * Resolve the activation target: the explicit `--target`, else the persisted `default-target`. There
 * is NO hard-coded default — when neither is set this returns '' and the caller must fail loudly
 * rather than silently picking a harness.
 */
function resolveTarget(opts) {
  if (opts.target && opts.target.trim() !== '') return opts.target.trim();
  const fromConfig = readConfig(opts.configDir ? { configDir: opts.configDir } : {}).defaultTarget;
  return fromConfig && fromConfig.trim() !== '' ? fromConfig.trim() : '';
}

/**
 * Activate one installed skill into a harness skills directory: emit it from the store and drop the
 * result as `<targetDir>/<name>.md`. Idempotent — a re-run overwrites the same file in place.
 *
 * The emit uses the "claude" profile when a registry entry is available for the skill (so the
 * harness flavour is applied), and falls back to the portable "open-core" profile otherwise, so any
 * installed skill can be activated without a registry on hand.
 *
 * @param {string} name  the installed skill name (a directory under the store).
 * @param {object} [opts]
 * @param {string} [opts.target]    the activation target name (e.g. "superpowers"). REQUIRED unless a
 *                                  persisted `default-target` is set — there is no hard default, so
 *                                  with neither this throws.
 * @param {boolean} [opts.list]     when true, do not activate — report which installed skills have a
 *                                  file present in the target dir.
 * @param {string} [opts.storeDir]  override STORE_PATH (for tests).
 * @param {string} [opts.targetDir] override the harness skills dir (for tests).
 * @param {string} [opts.configDir] override ~/.skillforge (for tests).
 * @param {object} [opts.registryEntry] explicit registry entry for the claude profile (optional).
 * @returns {{ activated: string, target: string, outputFile: string }
 *           | { activated: string[] }}
 * @throws {Error} when the skill is not installed, or when no target is given and none is persisted.
 */
export function skillsActivateCommand(name, opts = {}) {
  const storeDir = opts.storeDir || STORE_PATH;
  const targetDir = opts.targetDir || harnessSkillsDir();

  if (opts.list) {
    const installed = discoverSkills(storeDir);
    const activated = installed
      .filter((skill) => existsSync(join(targetDir, skill.name, SKILL_FILE)))
      .map((skill) => skill.name);
    return { activated };
  }

  if (typeof name !== 'string' || name.trim() === '') {
    throw new Error('skills activate requires a <name> (an installed skill)');
  }

  const skillDir = join(storeDir, name);
  const skillMd = join(skillDir, SKILL_FILE);
  if (!existsSync(skillMd)) {
    throw new Error(`skill "${name}" is not installed (expected ${skillMd}). Run "skillforge skills add" first.`);
  }

  const target = resolveTarget(opts);
  if (target === '') {
    throw new Error(
      'skills activate requires a target: pass --target <name> or set a default with ' +
        '"skillforge skills config default-target <name>"',
    );
  }

  const skillText = readFileSync(skillMd, 'utf8');
  const registryEntry = opts.registryEntry;
  const profile = registryEntry && typeof registryEntry === 'object' ? 'claude' : 'open-core';
  const result = emit({ skillText, profile, registryEntry, name });

  // Claude Code's Skill tool discovers skills as <dir>/<name>/SKILL.md, not flat <name>.md files.
  const outputDir = join(targetDir, name);
  mkdirSync(outputDir, { recursive: true });
  const outputFile = join(outputDir, SKILL_FILE);
  writeFileSync(outputFile, result.skillMd);

  return { activated: name, target, outputFile };
}

// Persist a default activation target so future `skills activate` calls need no --target.
export function setDefaultTarget(target, opts = {}) {
  return writeConfig('default-target', target, opts.configDir ? { configDir: opts.configDir } : {});
}

// Remove a previously activated skill from the harness skills directory.
// Inverse of skillsActivateCommand. Idempotent: deactivating a skill that is not
// activated is not an error.
export function skillsDeactivateCommand(name, opts = {}) {
  const storeDir = opts.storeDir || STORE_PATH;
  const targetDir = opts.targetDir || harnessSkillsDir();

  if (typeof name !== 'string' || name.trim() === '') {
    throw new Error('skills deactivate requires a <name>');
  }

  // Guard against path traversal: name must be a plain basename with no
  // directory separators, null bytes, or drive-letter prefixes.
  if (/[/\\]/.test(name) || name.includes('\0') || /^[a-zA-Z]:/.test(name)) {
    throw new Error(`invalid skill name "${name}": must be a simple name with no path separators`);
  }

  const skillMd = join(storeDir, name, SKILL_FILE);
  if (!existsSync(skillMd)) {
    throw new Error(`skill "${name}" is not installed (expected ${skillMd}). Run "skillforge skills add" first.`);
  }

  const outputDir = join(targetDir, name);
  // Atomic: let the OS tell us whether the directory existed rather than a
  // separate existsSync check (avoids TOCTOU race).
  let wasActive = true;
  try {
    rmSync(outputDir, { recursive: true });
  } catch (err) {
    if (err.code === 'ENOENT') wasActive = false;
    else throw err;
  }
  return { deactivated: name, wasActive };
}
