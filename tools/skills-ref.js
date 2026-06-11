#!/usr/bin/env node
// skills-ref — Agent Skills SKILL.md contract validator (local, faithful).
//
// Sources: the public Agent Skills open standard (agentskills.io/specification)
// and docs/12-skill-manifest-and-registry.md §"Standardized frontmatter fields".
// Zero files from any third-party skills-factory codebase (clean-room).
//
// WHY THIS EXISTS. The standard ships a reference validator invoked as
// `skills-ref validate ./my-skill`. It is not installed in this environment, so
// this is a faithful local substitute that enforces the same SKILL.md contract
// as a CI gate (package.json → gate:skills-ref). When the official `skills-ref`
// becomes available it should replace this; the checks here are written to
// match the published contract so the swap is transparent.
//
// WHAT IT CHECKS (per the standard + doc 12):
//   - a SKILL.md exists at skills/<name>/SKILL.md;
//   - it opens with a YAML frontmatter block delimited by `---` lines;
//   - frontmatter has required `name` and `description`;
//   - `name`: <=64 chars, lowercase [a-z0-9-], no leading/trailing/consecutive
//     hyphen, and MUST equal the parent directory name;
//   - `description`: <=1024 chars, non-empty;
//   - optional `license` / `compatibility` (<=500 chars) / `metadata`
//     (string->string map) / `allowed-tools` are well-formed if present;
//   - a non-empty Markdown body follows the frontmatter.
//
// Plus the skillforge generic-skill rule (doc 05 §"What makes a skill generic"):
//   - the body carries NO client-specific token/name/path. This keeps the open
//     core portable and clean-room clean.
//
// This validator deliberately parses only the small, flat YAML shape the
// frontmatter contract uses (scalars, a one-level string map, a scalar list,
// and folded/literal block scalars). It is not a general YAML engine; anything
// outside that shape is reported rather than silently accepted.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SKILLS_DIR = "skills";

// ---------------------------------------------------------------------------
// Frontmatter extraction + a small, contract-shaped YAML reader.
// ---------------------------------------------------------------------------

/**
 * Split a SKILL.md into its frontmatter text and body. Returns null when the
 * file does not open with a `---` delimited block.
 */
function splitFrontmatter(text) {
  const lines = text.split("\n");
  if (lines[0].trim() !== "---") return null;
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) return null;
  return {
    frontmatter: lines.slice(1, end).join("\n"),
    body: lines.slice(end + 1).join("\n"),
  };
}

/** Strip an inline `#` comment that is not inside quotes. */
function stripInlineComment(s) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === "#" && !inSingle && !inDouble && (i === 0 || s[i - 1] === " ")) {
      return s.slice(0, i);
    }
  }
  return s;
}

/** Unquote a scalar; collapse simple quoting. */
function unquote(v) {
  const s = v.trim();
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  return s;
}

/** Indentation width (spaces) of a raw line. */
function indentOf(line) {
  let n = 0;
  while (n < line.length && line[n] === " ") n++;
  return n;
}

/**
 * Parse the flat frontmatter shape the contract uses. Throws on shapes outside
 * that contract so they are surfaced, never silently accepted.
 */
function parseFrontmatter(fm) {
  const out = {};
  const raw = fm.split("\n");
  let i = 0;
  while (i < raw.length) {
    const line = raw[i];
    if (line.trim() === "") {
      i++;
      continue;
    }
    if (indentOf(line) !== 0) {
      throw new Error(`unexpected indentation at frontmatter line: "${line}"`);
    }
    const m = line.match(/^([A-Za-z0-9_.-]+):(.*)$/);
    if (!m) throw new Error(`malformed frontmatter line: "${line}"`);
    const key = m[1];
    let rest = stripInlineComment(m[2]).trim();

    // Block scalar (folded `>` / literal `|`, with optional chomping indicator).
    if (rest === ">" || rest === "|" || /^[>|][+-]?$/.test(rest)) {
      const folded = rest[0] === ">";
      const blockLines = [];
      i++;
      let blockIndent = null;
      while (i < raw.length) {
        const bl = raw[i];
        if (bl.trim() === "") {
          blockLines.push("");
          i++;
          continue;
        }
        const ind = indentOf(bl);
        if (ind === 0) break;
        if (blockIndent === null) blockIndent = ind;
        blockLines.push(bl.slice(blockIndent));
        i++;
      }
      // trim trailing blank lines
      while (blockLines.length && blockLines[blockLines.length - 1] === "") {
        blockLines.pop();
      }
      out[key] = folded
        ? blockLines.map((l) => l.trim()).join(" ").trim()
        : blockLines.join("\n");
      continue;
    }

    // Nested map (string->string) — used by `metadata`.
    if (rest === "") {
      const map = {};
      i++;
      let childIndent = null;
      while (i < raw.length) {
        const cl = raw[i];
        if (cl.trim() === "") {
          i++;
          continue;
        }
        const ind = indentOf(cl);
        if (ind === 0) break;
        if (childIndent === null) childIndent = ind;
        if (ind !== childIndent) {
          throw new Error(`inconsistent nesting under "${key}": "${cl}"`);
        }
        const cm = cl.trim().match(/^([A-Za-z0-9_.-]+):(.*)$/);
        if (!cm) throw new Error(`malformed nested entry under "${key}": "${cl}"`);
        map[cm[1]] = unquote(stripInlineComment(cm[2]).trim());
        i++;
      }
      out[key] = map;
      continue;
    }

    // Inline flow list: [a, b, c]
    if (rest.startsWith("[") && rest.endsWith("]")) {
      const inner = rest.slice(1, -1).trim();
      out[key] = inner === "" ? [] : inner.split(",").map((s) => unquote(s.trim()));
      i++;
      continue;
    }

    // Scalar.
    out[key] = unquote(rest);
    i++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Contract checks.
// ---------------------------------------------------------------------------

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Heuristics for the generic-skill clean-room rule. The body must not name a
// concrete client, its files, or its tokens. These patterns flag the obvious
// leaks; the human reviewer is the backstop for subtler ones.
const CLIENT_LEAK_PATTERNS = [
  { re: /\bbutton\s*cult\b/i, why: 'client name "Example Studio"' },
  { re: /\bbuttoncult\b/i, why: 'client slug "example-studio"' },
  { re: /\bheresy\b/i, why: "client theme name" },
  { re: /--bc-[a-z0-9-]+/i, why: "client token (--bc-*)" },
  { re: /\.hbtn\b/, why: "client CSS class (.hbtn)" },
  { re: /\bhbtn\b/, why: "client class token (hbtn)" },
  { re: /\b(?:ritual-red|toxic-green|warning-orange|electric-violet)\b/i, why: "client accent token" },
];

function validateSkill(dirName, dirPath, errors) {
  const skillFile = join(dirPath, "SKILL.md");
  let text;
  try {
    text = readFileSync(skillFile, "utf8");
  } catch {
    errors.push(`${dirName}: missing SKILL.md (expected at ${skillFile})`);
    return;
  }

  const split = splitFrontmatter(text);
  if (!split) {
    errors.push(`${dirName}: SKILL.md must open with a "---" delimited YAML frontmatter block`);
    return;
  }

  let fm;
  try {
    fm = parseFrontmatter(split.frontmatter);
  } catch (e) {
    errors.push(`${dirName}: frontmatter parse error — ${e.message}`);
    return;
  }

  // name
  if (typeof fm.name !== "string" || fm.name === "") {
    errors.push(`${dirName}: frontmatter "name" is required and must be a non-empty string`);
  } else {
    if (fm.name.length > 64) errors.push(`${dirName}: "name" exceeds 64 chars`);
    if (!NAME_RE.test(fm.name)) {
      errors.push(
        `${dirName}: "name" must be lowercase [a-z0-9-] with no leading/trailing/consecutive hyphen (got "${fm.name}")`,
      );
    }
    if (fm.name !== dirName) {
      errors.push(`${dirName}: "name" ("${fm.name}") must match the parent directory name ("${dirName}")`);
    }
  }

  // description
  if (typeof fm.description !== "string" || fm.description.trim() === "") {
    errors.push(`${dirName}: frontmatter "description" is required and must be a non-empty string`);
  } else if (fm.description.length > 1024) {
    errors.push(`${dirName}: "description" exceeds 1024 chars`);
  }

  // optional fields, well-formedness only
  if (fm.compatibility !== undefined) {
    if (typeof fm.compatibility !== "string") {
      errors.push(`${dirName}: "compatibility" must be a string`);
    } else if (fm.compatibility.length > 500) {
      errors.push(`${dirName}: "compatibility" exceeds 500 chars`);
    }
  }
  if (fm.license !== undefined && typeof fm.license !== "string") {
    errors.push(`${dirName}: "license" must be a string`);
  }
  if (fm.metadata !== undefined) {
    if (typeof fm.metadata !== "object" || Array.isArray(fm.metadata) || fm.metadata === null) {
      errors.push(`${dirName}: "metadata" must be a string->string map`);
    } else {
      for (const [k, v] of Object.entries(fm.metadata)) {
        if (typeof v !== "string") {
          errors.push(`${dirName}: metadata."${k}" must be a string (the standard's metadata is a string map)`);
        }
      }
    }
  }
  if (fm["allowed-tools"] !== undefined && !Array.isArray(fm["allowed-tools"]) && typeof fm["allowed-tools"] !== "string") {
    errors.push(`${dirName}: "allowed-tools" must be a string or a list of strings`);
  }

  // body present
  if (split.body.trim() === "") {
    errors.push(`${dirName}: SKILL.md must have a non-empty Markdown body after the frontmatter`);
  }

  // generic-skill clean-room rule: no client-specific leak in the body
  for (const { re, why } of CLIENT_LEAK_PATTERNS) {
    if (re.test(split.body)) {
      errors.push(`${dirName}: body leaks ${why} — a skill body must be generic (no client name/path/token)`);
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point.
// ---------------------------------------------------------------------------

function main() {
  const errors = [];
  let count = 0;

  let entries;
  try {
    entries = readdirSync(SKILLS_DIR, { withFileTypes: true });
  } catch {
    console.error(`skills-ref: no "${SKILLS_DIR}/" directory found`);
    process.exit(1);
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirPath = join(SKILLS_DIR, entry.name);
    try {
      if (!statSync(dirPath).isDirectory()) continue;
    } catch {
      continue;
    }
    count++;
    validateSkill(entry.name, dirPath, errors);
  }

  if (count === 0) {
    console.error(`skills-ref: no skill directories under "${SKILLS_DIR}/"`);
    process.exit(1);
  }

  if (errors.length > 0) {
    console.error(`skills-ref: FAIL — ${errors.length} problem(s):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  console.log(`skills-ref: PASS — ${count} skill(s) valid`);
}

main();
