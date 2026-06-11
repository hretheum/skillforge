// emit-command — the SHARED CORE of the `emit` subcommand.
//
// This module owns the emit WORKFLOW: validate inputs, read the SKILL.md, resolve the
// registry entry when the chosen profile needs one, call emit() (src/emit/index.js), and
// write the results to the output directory. It returns a plain result object; it never
// prints. That separation is deliberate — the bin layer (bin/skillforge.js) formats and
// prints, and a future MCP server reuses this exact function without re-touching
// any I/O presentation. Logic in, presentation out.
//
// Generic by construction: this file names no client and no skill. Every specific arrives as
// DATA (the --skill path, the registry JSON, the chosen --profile).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { basename, extname, join, resolve as resolvePath, dirname } from 'node:path';

import { emit, emitProfileNames } from '../emit/index.js';
import { resolveByName, listSkills } from '../store/index.js';
import { discoverSkills } from '../store/discovery.js';

/** Profiles that need a registry entry to emit (the harness flavours; open-core does not). */
const REGISTRY_REQUIRED = new Set(emitProfileNames().filter((p) => p !== 'open-core'));

/**
 * Is `skill` a bare skill NAME rather than a path? A name carries no path separator and does not
 * end in `.md`; anything else (a relative or absolute path, or any *.md file) is a path.
 */
function looksLikeName(skill) {
  return !skill.includes('/') && !skill.includes('\\') && !skill.toLowerCase().endsWith('.md');
}

/** Local-project skills root: `<cwd>/.claude/skills`, where each `<name>/SKILL.md` is a skill. */
function localSkillsDir() {
  return resolvePath(process.cwd(), '.claude', 'skills');
}

/**
 * Resolve a bare skill name to the absolute path of its SKILL.md, or throw with a known-names list.
 * Order: local project (`.claude/skills/<name>/SKILL.md`) wins over the global store.
 */
function resolveSkillName(name) {
  const local = discoverSkills(localSkillsDir()).find((s) => s.name === name);
  if (local) return local.path;

  const global = resolveByName(name);
  if (global) return global;

  const localNames = discoverSkills(localSkillsDir()).map((s) => s.name);
  const globalNames = listSkills().map((s) => s.name);
  const known = [...new Set([...localNames, ...globalNames])].sort();
  throw new Error(
    `skill "${name}" not found. Known skills: ${known.length ? known.join(', ') : '(none)'}`,
  );
}

/**
 * Derive a skill name from a SKILL.md path.
 *
 * The common canonical layout places skill sources as `skills/<name>/SKILL.md`. Using the
 * filename alone yields "SKILL" — which is never a registry key. When the filename (minus
 * extension) is exactly "SKILL" (case-insensitive), fall back to the parent directory name,
 * which matches the registry key convention.
 */
function skillNameFromPath(skillPath) {
  const base = basename(skillPath, extname(skillPath));
  if (base.toUpperCase() === 'SKILL') {
    return basename(dirname(skillPath));
  }
  return base;
}

/**
 * Load the registry JSON and return the entry for `name`, or throw a clear error.
 * Resolution order: explicit `registryPath`, else `skillforge.registry.json` in cwd.
 *
 * @param {string|undefined} registryPath  explicit --registry path (optional)
 * @param {string} name  the skill name to look up
 * @param {string} profile  the profile (for the error message)
 * @returns {object} the registry entry
 */
function resolveRegistryEntry(registryPath, name, profile) {
  const path = registryPath
    ? resolvePath(process.cwd(), registryPath)
    : resolvePath(process.cwd(), 'skillforge.registry.json');

  if (!existsSync(path)) {
    throw new Error(
      `profile "${profile}" requires a registry, but none was found ` +
        `(looked for ${path}). Pass --registry <path> or add skillforge.registry.json to the cwd.`,
    );
  }

  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    throw new Error(`registry "${path}" is not valid JSON: ${cause.message}`);
  }

  const skills = raw && typeof raw === 'object' ? raw.skills : null;
  const entry = skills && typeof skills === 'object' ? skills[name] : undefined;
  if (!entry || typeof entry !== 'object') {
    const known = skills && typeof skills === 'object' ? Object.keys(skills) : [];
    throw new Error(
      `skill "${name}" not found in registry "${path}"` +
        (known.length ? ` (known skills: ${known.join(', ')})` : ' (registry has no skills)'),
    );
  }
  return entry;
}

/**
 * Run the emit workflow. Pure logic + filesystem effects; never prints.
 *
 * @param {object} args
 * @param {string} args.skill  path to the SKILL.md (required).
 * @param {string} [args.profile]  the emit profile; defaults to "open-core".
 * @param {string} [args.out]  output directory; defaults to the cwd.
 * @param {string} [args.registry]  explicit registry path; auto-discovered otherwise.
 * @returns {{ ok: true, profile: string, skillName: string, outputFiles: string[] }}
 * @throws {Error} loud and early on the first input that does not hold.
 */
export async function emitCommand(args = {}) {
  const skillPath = args.skill;
  if (typeof skillPath !== 'string' || skillPath.trim() === '') {
    throw new Error('emit requires --skill <path-to-SKILL.md>');
  }

  const profile = args.profile && args.profile.trim() !== '' ? args.profile : 'open-core';
  const known = emitProfileNames();
  if (!known.includes(profile)) {
    throw new Error(`unknown profile "${profile}" (known profiles: ${known.join(', ')})`);
  }

  const skillAbs = looksLikeName(skillPath.trim())
    ? resolveSkillName(skillPath.trim())
    : resolvePath(process.cwd(), skillPath);
  if (!existsSync(skillAbs)) {
    throw new Error(`--skill path does not exist: ${skillAbs}`);
  }
  const skillText = readFileSync(skillAbs, 'utf8');
  const name = skillNameFromPath(skillAbs);

  let registryEntry;
  if (REGISTRY_REQUIRED.has(profile)) {
    registryEntry = resolveRegistryEntry(args.registry, name, profile);
  }

  const result = emit({ skillText, profile, registryEntry, name });

  const outDir = resolvePath(process.cwd(), args.out && args.out.trim() !== '' ? args.out : '.');
  mkdirSync(outDir, { recursive: true });

  const outputFiles = [];

  const skillOut = join(outDir, `${name}.md`);
  writeFileSync(skillOut, result.skillMd);
  outputFiles.push(skillOut);

  for (const companion of result.companions || []) {
    const companionPath = join(outDir, companion.path);
    mkdirSync(dirname(companionPath), { recursive: true });
    writeFileSync(companionPath, companion.content);
    outputFiles.push(companionPath);
  }

  return { ok: true, profile: result.profile, skillName: name, outputFiles };
}
