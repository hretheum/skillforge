// The store manifest — a side-record of where each installed skill came from.
//
// The manifest is OPTIONAL provenance: the discovery scan (discovery.js) is authoritative for
// "what skills exist", while the manifest answers "where did this one come from, which version,
// when installed". It lives as a single JSON file at the store root and is read/written whole.
// Sync-only (readFileSync/writeFileSync), zero runtime deps.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const MANIFEST_FILE = '.manifest.json';

const EMPTY = { skills: {} };

// Read and parse the manifest at <storeDir>/.manifest.json. A missing or malformed manifest is
// not an error — it yields the empty shape { skills: {} } so callers can treat "no provenance"
// and "store not yet initialised" alike.
export function readManifest(storeDir) {
  let raw;
  try {
    raw = readFileSync(join(storeDir, MANIFEST_FILE), 'utf8');
  } catch {
    return { skills: {} };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { skills: {} };
  }
  if (!parsed || typeof parsed !== 'object' || typeof parsed.skills !== 'object' || parsed.skills === null) {
    return { skills: {} };
  }
  return parsed;
}

// Upsert one skill's provenance entry, then write the whole manifest back. Re-writing the same
// name overwrites in place (no duplicate keys). Returns the persisted entry.
export function writeManifestEntry(storeDir, name, entry) {
  const manifest = readManifest(storeDir);
  manifest.skills[name] = { ...entry };
  writeFileSync(join(storeDir, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return manifest.skills[name];
}
