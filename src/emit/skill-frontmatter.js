// skill-frontmatter — a minimal, contract-shaped reader/writer for a SKILL.md's YAML
// frontmatter block, used ONLY by the emit layer (docs/12 §"Claude flavour — an optional
// emit-adapter").
//
// Sources: the public Agent Skills open standard (agentskills.io/specification) and
// docs/05-skills-and-commands.md §"open core vs the optional Claude flavour" +
// docs/12-skill-manifest-and-registry.md. Zero files from any third-party skills-factory
// codebase (clean-room).
//
// WHY A SEPARATE, MINIMAL READER. The CI validator tools/skills-ref.js already parses the full
// frontmatter contract; the emit layer needs much less. To project a Claude flavour we only
// need to (a) split the open `SKILL.md` into { frontmatter, body } so we can ADD additive lines
// without re-rendering anything we did not author, and (b) read which keys are already present
// (so the flavour never overwrites an open-core field). We deliberately do NOT round-trip the
// whole document through a parse→serialize: that would risk BYTE DRIFT in the open-core text,
// and byte-stability of the open core is exactly the portability guarantee this layer must
// preserve (docs/05 §"flavour only ADDS, never required"). So the emit layer manipulates the
// raw text by INSERTION only; this reader exists just to locate the seam and detect collisions.
//
// Generic by construction: this file names no client. It works on any SKILL.md's text.

/**
 * Split a SKILL.md's text into its frontmatter block and body, preserving the exact bytes of
 * each. Returns null when the text does not open with a `---`-delimited frontmatter block (an
 * open-core SKILL.md always has one — doc 12 Layer 1 — so a null here is a malformed input the
 * caller must reject loudly, never silently flavour).
 *
 * @param {string} text  the full SKILL.md source.
 * @returns {{ frontmatter: string, body: string, endLine: number } | null}
 *   `frontmatter` is the text BETWEEN the `---` fences (no fences); `body` is everything after
 *   the closing fence's newline; `endLine` is the line index of the closing `---` fence.
 */
export function splitFrontmatter(text) {
  const lines = text.split("\n");
  if (lines.length === 0 || lines[0].trim() !== "---") return null;
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
    endLine: end,
  };
}

/**
 * The set of TOP-LEVEL frontmatter keys already declared in a frontmatter block. Used by the
 * flavour to refuse overwriting any open-core field (collision = the open core already decided
 * that field, and the flavour only ADDS). Only column-0 `key:` lines count as top-level, so a
 * nested `metadata` child (indented) is not mistaken for a top-level key.
 *
 * @param {string} frontmatter  the text between the `---` fences.
 * @returns {Set<string>} the top-level keys present.
 */
export function topLevelKeys(frontmatter) {
  const keys = new Set();
  for (const line of frontmatter.split("\n")) {
    if (line.length === 0 || line[0] === " " || line[0] === "\t") continue; // nested / blank
    const m = line.match(/^([A-Za-z0-9_.-]+):/);
    if (m) keys.add(m[1]);
  }
  return keys;
}

/**
 * Whether a `metadata:` block exists and, if so, the exact key names declared under it. The
 * Claude flavour records its provenance under `metadata.skillforge.*` (doc 12 §"How skillforge
 * uses the open fields"), and must not clobber an existing metadata child.
 *
 * @param {string} frontmatter
 * @returns {{ present: boolean, childKeys: Set<string> }}
 */
export function metadataKeys(frontmatter) {
  const lines = frontmatter.split("\n");
  let inMeta = false;
  const childKeys = new Set();
  let present = false;
  for (const line of lines) {
    if (/^metadata:\s*$/.test(line)) {
      inMeta = true;
      present = true;
      continue;
    }
    if (inMeta) {
      if (line.length === 0) continue;
      if (line[0] !== " " && line[0] !== "\t") {
        inMeta = false; // dedented back to a top-level key
        continue;
      }
      const m = line.trim().match(/^([A-Za-z0-9_.-]+):/);
      if (m) childKeys.add(m[1]);
    }
  }
  return { present, childKeys };
}
