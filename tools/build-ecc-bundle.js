#!/usr/bin/env node
// Assembles packages/ecc-bundle/skills/ (npm distribution of @skillforge-core/ecc-bundle)
// from the thematic plugin packages under packages/plugins/*/skills/.
// Source of truth is the plugin layout; the bundle is a build artifact.
// Usage: node tools/build-ecc-bundle.js  (also wired as `npm run build:ecc-bundle`)

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGINS = join(ROOT, 'packages', 'plugins');
const BUNDLE = join(ROOT, 'packages', 'ecc-bundle');
const OUT_SKILLS = join(BUNDLE, 'skills');

function frontmatterField(md, field) {
  const fm = md.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return '';
  // obsługuje zarówno "field: value" jak i blokowe "field: >-\n  ..."
  const m = fm[1].match(new RegExp(`^${field}:\\s*(?:>-?|\\|-?)?\\s*\\n?((?:\\s{2,}.*\\n?)+|.*)`, 'm'));
  if (!m) return '';
  return m[1]
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ')
    .trim();
}

rmSync(OUT_SKILLS, { recursive: true, force: true });
mkdirSync(OUT_SKILLS, { recursive: true });

const manifestSkills = [];
for (const plugin of readdirSync(PLUGINS).sort()) {
  const skillsDir = join(PLUGINS, plugin, 'skills');
  if (!existsSync(skillsDir)) continue;
  for (const name of readdirSync(skillsDir).sort()) {
    const src = join(skillsDir, name);
    cpSync(src, join(OUT_SKILLS, name), { recursive: true });
    const skillMd = join(src, 'SKILL.md');
    const description = existsSync(skillMd) ? frontmatterField(readFileSync(skillMd, 'utf8'), 'description') : '';
    manifestSkills.push({ name, version: '0.1.0', description, plugin });
  }
}

const pkg = JSON.parse(readFileSync(join(BUNDLE, 'package.json'), 'utf8'));
const manifest = {
  bundleVersion: pkg.version,
  source: 'https://github.com/affaan-m/ECC',
  license: 'MIT',
  builtFrom: 'packages/plugins (run tools/build-ecc-bundle.js to regenerate)',
  skills: manifestSkills,
};
writeFileSync(join(BUNDLE, 'bundle-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`assembled ${manifestSkills.length} skills into packages/ecc-bundle/skills`);
