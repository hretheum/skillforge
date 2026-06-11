// Store discovery — scan the global store for installed skills.
//
// A skill is installed as a directory <storeDir>/<name>/ containing a SKILL.md. Discovery is the
// authoritative answer to "what skills exist in the store": it walks the immediate children of
// storeDir and keeps those that hold a SKILL.md. The directory name IS the skill name. Sync-only,
// zero runtime deps. A missing store directory yields an empty list (not an error).

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SKILL_FILE = 'SKILL.md';

export function discoverSkills(storeDir) {
  let entries;
  try {
    entries = readdirSync(storeDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillPath = join(storeDir, entry.name, SKILL_FILE);
    let isFile = false;
    try {
      isFile = statSync(skillPath).isFile();
    } catch {
      isFile = false;
    }
    if (isFile) skills.push({ name: entry.name, path: skillPath });
  }
  skills.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return skills;
}
