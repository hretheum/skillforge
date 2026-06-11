// Public surface of the global skill store.
//
// The store is the machine-local home for installed skills, rooted at ~/.skillforge/skills. Each
// skill lives in its own directory holding a SKILL.md; an optional .manifest.json at the store
// root records provenance (source, version, install time). This module is the single entry point:
// it binds the discovery scan (discovery.js) and the provenance manifest (manifest.js) to the one
// concrete STORE_PATH and adds name-resolution with path-traversal defence. Sync-only, zero deps.

import { homedir } from 'node:os';
import { join } from 'node:path';

import { discoverSkills } from './discovery.js';
import { readManifest as readManifestAt, writeManifestEntry as writeManifestEntryAt } from './manifest.js';

export const STORE_PATH = join(homedir(), '.skillforge', 'skills');

// A skill name addresses a single directory under the store root. Reject anything that could
// escape that root or reach into a nested path: empty, path separators, or a parent-dir token.
function isSafeName(name) {
  if (typeof name !== 'string' || name.length === 0) return false;
  if (name.includes('/') || name.includes('\\')) return false;
  if (name === '..' || name.includes('..')) return false;
  return true;
}

// Resolve a skill name to the absolute path of its SKILL.md, or null if the name is unsafe or the
// skill is not installed. Traversal-bearing names always resolve to null.
export function resolveByName(name) {
  if (!isSafeName(name)) return null;
  const match = discoverSkills(STORE_PATH).find((s) => s.name === name);
  return match ? match.path : null;
}

// List installed skills, merging discovery (authoritative existence) with any manifest provenance.
// Each entry always has { name, path }; source/version/installedAt appear only when the manifest
// records them.
export function listSkills() {
  const manifest = readManifestAt(STORE_PATH);
  return discoverSkills(STORE_PATH).map((skill) => {
    const provenance = manifest.skills[skill.name];
    if (!provenance) return { name: skill.name, path: skill.path };
    return {
      name: skill.name,
      path: skill.path,
      source: provenance.source,
      version: provenance.version,
      installedAt: provenance.installedAt,
    };
  });
}

export function readManifest() {
  return readManifestAt(STORE_PATH);
}

export function writeManifestEntry(name, { source, version, installedAt } = {}) {
  return writeManifestEntryAt(STORE_PATH, name, { source, version, installedAt });
}
