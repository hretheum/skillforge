// ecc-import — ECC→SFG import adapter (parse a public ECC skill, emit a SFG registry stub).
//
// Sources: concept + first principles + public ECC specification (github.com/affaan-m/ECC README); zero files from any third-party skills-factory codebase (clean-room).
//
// WHAT THIS IS. ECC (Efficient Claude Code) is a public skill library. Each skill lives at
// skills/<name>/SKILL.md with YAML frontmatter (at minimum name, description, origin) and a
// Markdown body holding the instructions. This module is pure logic: it (1) parses that file
// shape, (2) projects a parsed skill into a PARTIAL SFG registry entry — a stub an operator
// reviews and completes before enabling — and (3) fetches the raw file via an INJECTED fetch
// so the parse/transform core stays free of real I/O (tests pass a stub).
//
// The stub is deliberately CONSERVATIVE: imported skills land disabled, owner 'imported-ecc',
// with capability fields ([] tools/adapters/secrets) left empty and an `_importNotes` trail
// marking every field a human must fill in. Importing never auto-grants capability.

const RAW_BASE = 'https://raw.githubusercontent.com/affaan-m/ECC/main/skills';

/** Build the canonical raw URL for an ECC skill's SKILL.md. */
function eccSkillUrl(skillName) {
  return `${RAW_BASE}/${encodeURIComponent(skillName)}/SKILL.md`;
}

/**
 * Parse an ECC SKILL.md: YAML frontmatter (between the first two `---` fences) + Markdown body.
 * Frontmatter parsing is intentionally minimal — line-by-line `key: value`, no nesting, no
 * external YAML lib. Missing fields come back as null; a file with no frontmatter yields nulls
 * and treats the whole text as the body.
 *
 * @param {string} markdownText
 * @returns {{ name: string|null, description: string|null, origin: string|null, body: string }}
 */
export function parseEccSkill(markdownText) {
  if (typeof markdownText !== 'string') {
    return { name: null, description: null, origin: null, body: '' };
  }

  const fm = extractFrontmatter(markdownText);
  const fields = parseYamlLines(fm.yaml);

  return {
    name: fields.name ?? null,
    description: fields.description ?? null,
    origin: fields.origin ?? null,
    body: fm.body,
  };
}

/**
 * Split text into { yaml, body }. Frontmatter is the block between a leading `---` line and the
 * next `---` line. No leading fence -> no frontmatter (empty yaml, whole text is body).
 */
function extractFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') {
    return { yaml: '', body: text };
  }
  let close = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      close = i;
      break;
    }
  }
  // an opening fence with no closing fence -> treat as malformed: no frontmatter, all body.
  if (close === -1) {
    return { yaml: '', body: text };
  }
  return {
    yaml: lines.slice(1, close).join('\n'),
    body: lines.slice(close + 1).join('\n').replace(/^\n+/, ''),
  };
}

/** Parse `key: value` lines into an object. Blank lines, comments (#…), and non-kv lines skipped. */
function parseYamlLines(yaml) {
  const out = {};
  if (!yaml) return out;
  for (const raw of yaml.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    if (key === '') continue;
    let value = line.slice(sep + 1).trim();
    // strip a single layer of matching surrounding quotes
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value[value.length - 1] === value[0]) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Project a parsed ECC skill into a PARTIAL SFG registry entry (a stub). Conservative defaults:
 * disabled, owner 'imported-ecc', instruction kind, empty capability fields, wildcard scope.
 * Every field a human must complete is recorded in `_importNotes` with a `// TODO: fill in` marker.
 *
 * @param {{ name: string|null, description: string|null, origin: string|null, body: string }} parsed
 * @returns {object} partial registry entry stub
 */
export function eccEntryToRegistryStub(parsed) {
  const p = parsed ?? {};
  const notes = [];
  const todo = (field) => notes.push(`${field}: // TODO: fill in`);

  if (!p.name) todo('name');
  if (!p.description) todo('description');
  todo('requiredTools');
  todo('requiredAdapters');
  todo('requiredSecrets');
  todo('compose');

  return {
    version: '0.0.0',
    enabled: false,
    owner: 'imported-ecc',
    skillKind: 'instruction',
    description: p.description ?? null,
    origin: p.origin ?? 'ECC',
    requiredTools: [],
    requiredAdapters: { input: [], output: [] },
    requiredSecrets: [],
    scope: { clients: ['*'], projects: ['*'] },
    model: 'inherit',
    effort: 'medium',
    _importSource: 'ecc',
    _importName: p.name ?? null,
    _importNotes: notes,
  };
}

/**
 * Fetch a skill's SKILL.md from the public ECC library and parse it. `fetch` is injected so the
 * network call is testable (default: global fetch). The injected fn receives the raw URL and
 * must return a Response-like object exposing `ok`, `status`, and async `text()`.
 *
 * @param {string} skillName
 * @param {{ fetch?: typeof fetch }} [opts]
 * @returns {Promise<{ name: string|null, description: string|null, origin: string|null, body: string }>}
 */
export async function fetchEccSkill(skillName, { fetch: fetchFn = globalThis.fetch } = {}) {
  if (typeof skillName !== 'string' || skillName.trim() === '') {
    throw new Error('fetchEccSkill: skillName must be a non-empty string');
  }
  if (typeof fetchFn !== 'function') {
    throw new Error('fetchEccSkill: no fetch implementation available (inject { fetch })');
  }
  const url = eccSkillUrl(skillName);
  const res = await fetchFn(url);
  if (!res || res.ok === false) {
    const status = res && res.status != null ? res.status : 'unknown';
    throw new Error(`fetchEccSkill: failed to fetch ${skillName} (status ${status})`);
  }
  const text = await res.text();
  return parseEccSkill(text);
}
