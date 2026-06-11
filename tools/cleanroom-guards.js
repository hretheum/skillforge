#!/usr/bin/env node
// cleanroom-guards — the public subset of the clean-room provenance gates, run in CI.
//
// Sources: concept + first principles + this repo's clean-room process
// (docs/08-guardrails-and-cleanroom.md, docs/cleanroom-process.md). Zero files from any
// third-party skills-factory codebase (clean-room).
//
// WHAT THIS IS. docs/08 keeps the full stage-by-stage guardrail catalog LOCAL-ONLY (in
// private/, not in the remote) because it references prior-employer context. This tool
// implements the LOGIC of the three public-facing gates that protect the tracked tree —
// without copying any private catalog text into the repo. It greps the working tree; it does
// not embed the private document.
//
//   E0/E5 — guard-no-sf-paths   : no foreign-repo paths/imports (a third-party skill factory)
//                                 anywhere in src/ or the spec docs. The one-way membrane:
//                                 the concept may cross, code/paths never.
//   E0/E7 — guard-no-efi-clients: no prior-employer client identifiers anywhere in the tree;
//                                 the only client configs permitted are the author's own
//                                 ("example-studio" + the fictional "glasshouse"). Client data is
//                                 confidential; the generic engine is not.
//   E0    — guard-doc-sources   : every spec doc declares its provenance ("written from the
//                                 concept; zero third-party files").
//   E3    — guard-provenance    : a provenance declaration exists (local-only by design — the
//                                 gate reports its status without failing the public build on
//                                 a deliberately-local artifact).
//
// FORBIDDEN PATTERNS AS DATA. To grep for a forbidden token the tool must NAME it, so the
// patterns below necessarily contain the foreign markers. That would make this tool trip its
// OWN guard — so the guardrail tooling itself is on the allowlist (the same way the spec's
// guardrail docs are). This is a tool that HUNTS the markers, not one that carries foreign
// content; keeping it allowlisted is correct, not a loophole.

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, basename } from "node:path";

const ROOT = process.cwd();

// --- forbidden markers (the membrane's hard list) ---------------------------------------
// E0/E5 — the membrane: no FOREIGN skill-factory PATH or IMPORT in the tracked tree.
//
// The detector must distinguish a REAL foreign path/import (the leak) from the DISCLAIMER
// PROSE that legitimately names the marker (the mandatory Sources note: "...zero files from
// any third-party skills-factory codebase (clean-room)"). The earlier ±1-line window was
// BYPASSABLE (reviewer-b): a real `import "../../dev/skills/x.js"` sitting next to — or on the
// same line as — a "clean-room"/"third-party" word slipped through, and since every file's
// top carries the Sources note, any import below it passed. THE FIX: judge each line on its
// OWN content, with no neighbour window —
//   * FLAG a line that carries a REAL foreign path/import token (the dangerous form), even if
//     a disclaimer word is on the same line;
//   * EXCLUDE a line only when its marker is DISCLAIMER PROSE — i.e. the phrase
//     "third-party skills-factory" with NO real path token on that line.
//
// Any mention of a marker at all (decides whether a line needs classification).
const SF_MARKER_RE = /dev\/skills|skills-factory|skillfactory/i;
//
// IMPORT_CONTEXT_RE — the marker used as a REAL import / module-path / JS-string specifier
// (the leak shape that must ALWAYS flag, even with a disclaimer word on the same line):
//   - an ES import / export-from / require() / dynamic import() whose specifier names a marker
//   - the marker inside a single/double-quoted JS string used as a path (…/dev/skills/…,
//     "skills-factory/…", '…/skillfactory')
// It deliberately does NOT match a Markdown backtick `~/dev/skills` mention or a plain prose
// sentence — those are the disclaimer forms, handled below. (Backticks are markdown inline
// code, not a JS string, so a prose "`~/dev/skills`" mention is not an import.)
const IMPORT_CONTEXT_RE = new RegExp(
  [
    // import … from "…marker…" / export … from '…marker…' / from "…marker…"
    String.raw`\b(?:import|export)\b[^\n]*\bfrom\s*["'][^"'\n]*(?:dev\/skills|skills-factory|skillfactory)`,
    String.raw`\bfrom\s*["'][^"'\n]*(?:dev\/skills|skills-factory|skillfactory)`,
    // import("…marker…") / require("…marker…")
    String.raw`\b(?:import|require)\s*\(\s*["'][^"'\n]*(?:dev\/skills|skills-factory|skillfactory)`,
    // a quoted JS string path containing the marker (single/double quotes, not backticks)
    String.raw`["'][^"'\n]*(?:dev\/skills|skills-factory|skillfactory)[^"'\n]*["']`,
  ].join("|"),
  "i",
);
// A clean-room DISCLAIMER that legitimately names the marker as prose (allowed). Corpus forms:
//   - the mandatory Sources note "…third-party `skills-factory` codebase (clean-room)";
//   - its WRAPPED continuation line "`skills-factory` codebase (clean-room)" (some notes break
//     across two lines — the marker lands on a line carrying "codebase"/"clean-room" but not
//     "third-party"). This is SAFE to allow even without a neighbour window because an actual
//     import is caught FIRST by IMPORT_CONTEXT_RE (a real import always flags regardless of any
//     disclaimer word on the line — closing reviewer-b's bypass);
//   - audit/research "not read" notes about the local repo ("the local `~/dev/skills` repo was
//     deliberately not read").
// A disclaimer LINE = the marker appears together with a clean-room provenance CUE on the same
// line. Because an actual import/path is caught FIRST by IMPORT_CONTEXT_RE (and returns before
// this check), recognising "marker + cue" here cannot re-open the bypass: a real import flags
// regardless of any cue. The cues are the established disclaimer vocabulary across the corpus.
const MARKER_ALT = String.raw`(?:dev\/skills|skills-factory|skillfactory)`;
const CLEANROOM_CUE = String.raw`(?:third-party|clean-?room|codebase|not (?:read|opened)|no\b[^\n]*\bread\b|never (?:read|opened)|deliberately not|prior-employer|from scratch|first principles|zero files)`;
const DISCLAIMER_PROSE_RE = new RegExp(
  `${MARKER_ALT}[^\\n]*${CLEANROOM_CUE}|${CLEANROOM_CUE}[^\\n]*${MARKER_ALT}`,
  "i",
);

// Prior-employer client identifiers (E0/E7).
const EFI_CLIENT_RE = /\b(?:orlen|energa|coop|_efi|_eds-poc|efigence)\b/i;

// Files/dirs that are ALLOWED to name the markers because their job is to hunt or document
// them: the guardrail tooling itself, and the local-only guardrail/process docs.
const ALLOWLIST_BASENAMES = new Set([
  "cleanroom-guards.js", // this hunter
  "secret-scan.js", // sibling hunter (may share marker helpers in future)
  "cleanroom-process.md", // the membrane's own description
  "gates-fail-loud.test.js", // negative tests PLANT markers on purpose to prove the gate fails
]);
const ALLOWLIST_PREFIXES = ["sf-"]; // sf-*.md guardrail/legal docs (local-only)

// Directories never scanned (not part of the tracked engine surface).
const SKIP_DIRS = new Set([".git", "node_modules", "private"]);
// `private/` is local-only and out of the remote by design; the membrane keeps prior-employer
// context THERE on purpose, so it is not part of the tracked tree this gate protects.

function isAllowlisted(path) {
  const base = basename(path);
  if (ALLOWLIST_BASENAMES.has(base)) return true;
  return ALLOWLIST_PREFIXES.some((p) => base.startsWith(p));
}

/** Recursively collect tracked text files under a root, skipping SKIP_DIRS. */
function walk(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(join(dir, e.name), acc);
    } else if (e.isFile()) {
      acc.push(join(dir, e.name));
    }
  }
  return acc;
}

const isSpecDoc = (rel) => /^docs\/[0-1][0-9]-.*\.md$/.test(rel);

function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

// --- the gates --------------------------------------------------------------------------

function guardNoSfPaths(files, problems) {
  for (const path of files) {
    const rel = relative(ROOT, path);
    if (isAllowlisted(path)) continue;
    if (!/\.(js|mjs|cjs|ts|tsx|json|md)$/.test(path)) continue;
    const text = readText(path);
    if (text == null) continue;
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      if (!SF_MARKER_RE.test(line)) return;
      // Judge THIS line alone (no neighbour window — the window was the bypass). A marker used
      // as a REAL import / module-path / JS-string is ALWAYS a leak, even if a disclaimer word
      // ("clean-room"/"third-party") sits on the same line.
      if (IMPORT_CONTEXT_RE.test(line)) {
        problems.push(`E0/E5 guard-no-sf-paths: foreign skill-factory import/path at ${rel}:${i + 1}`);
        return;
      }
      // Not an import/path. Allow it ONLY if the marker is recognised clean-room DISCLAIMER
      // prose (the Sources note, or an audit/research "not read" note). Any other bare mention
      // of a marker that is neither an import nor a recognised disclaimer is suspicious → flag.
      if (DISCLAIMER_PROSE_RE.test(line)) return;
      problems.push(
        `E0/E5 guard-no-sf-paths: foreign skill-factory marker (neither an import nor a recognised provenance note) at ${rel}:${i + 1}`,
      );
    });
  }
}

function guardNoEfiClients(files, problems) {
  for (const path of files) {
    if (isAllowlisted(path)) continue;
    if (!/\.(js|mjs|cjs|ts|tsx|json|md|txt)$/.test(path)) continue;
    const rel = relative(ROOT, path);
    const text = readText(path);
    if (text == null) continue;
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      if (EFI_CLIENT_RE.test(line)) {
        problems.push(`E0/E7 guard-no-efi-clients: prior-employer client identifier at ${rel}:${i + 1}`);
      }
    });
  }
}

function guardClientsDir(problems) {
  const clientsDir = join(ROOT, "clients");
  if (!existsSync(clientsDir)) return; // no clients dir tracked = nothing to constrain
  let entries;
  try {
    entries = readdirSync(clientsDir, { withFileTypes: true });
  } catch {
    return;
  }
  // The author's own clients. "example-studio" is the first real client; "glasshouse" is a
  // FICTIONAL second client (a verdant greenhouse brand the author invented) added to prove the
  // engine is generic across DIFFERENT adapters — it is NOT a prior-employer/efigence client
  // (those remain forbidden by EFI_CLIENT_RE). Extending this set is legitimate author-owned
  // maintenance: a new author client is data-only and must still pass EFI_CLIENT_RE.
  const allowed = new Set(["example-studio", "glasshouse", "verdex", "verdex-advisor"]);
  for (const e of entries) {
    if (e.isDirectory() && !allowed.has(e.name)) {
      problems.push(
        `E7 guard-no-efi-clients: clients/ may only hold the author's own clients (${[...allowed].join(", ")}); found "${e.name}"`,
      );
    }
  }
}

function guardDocSources(problems) {
  const docsDir = join(ROOT, "docs");
  if (!existsSync(docsDir)) return;
  for (const path of walk(docsDir)) {
    const rel = relative(ROOT, path);
    if (!isSpecDoc(rel)) continue;
    const text = readText(path);
    if (text == null) continue;
    // The provenance note: "written from the concept ... zero ... third-party skills-factory
    // codebase (clean-room)". Accept the established phrasings.
    const hasNote =
      /zero files from any third-party `?skills-factory`? codebase/i.test(text) ||
      /zero (?:third-party )?(?:files|SF files)/i.test(text) ||
      /clean-room/i.test(text);
    if (!hasNote) {
      problems.push(`E0 guard-doc-sources: spec doc ${rel} is missing its "Sources / clean-room" provenance note`);
    }
  }
}

function reportProvenance() {
  // E3: the provenance declaration is LOCAL-ONLY by design (private/PROVENANCE.md, out of the
  // remote). The public CI gate therefore REPORTS its status rather than failing the build on
  // a deliberately-local artifact: a tracked PROVENANCE.md is optional; the local one is the
  // evidentiary record. We surface which is present so the operator sees the posture.
  const tracked = existsSync(join(ROOT, "PROVENANCE.md"));
  const local = existsSync(join(ROOT, "private", "PROVENANCE.md"));
  return { tracked, local };
}

// --- entry point ------------------------------------------------------------------------

function main() {
  const problems = [];
  const srcFiles = walk(join(ROOT, "src"));
  const docFiles = walk(join(ROOT, "docs"));
  const clientFiles = walk(join(ROOT, "clients"));
  const testFiles = walk(join(ROOT, "test"));
  const toolFiles = walk(join(ROOT, "tools"));
  const allFiles = [...srcFiles, ...docFiles, ...clientFiles, ...testFiles, ...toolFiles];

  guardNoSfPaths(allFiles, problems);
  guardNoEfiClients(allFiles, problems);
  guardClientsDir(problems);
  guardDocSources(problems);

  const prov = reportProvenance();
  // E3 is INFORMATIONAL in the public gate: the authoritative provenance record is local-only
  // by design (private/PROVENANCE.md, out of the remote), so the public CI must not fail the
  // build on its deliberate absence from the tracked tree. We report the posture; the absence
  // of BOTH is surfaced as a warning, not a hard fail (a clean checkout legitimately has
  // neither in the tracked tree).
  if (!prov.tracked && !prov.local) {
    console.warn(
      "cleanroom-guards: NOTE — no PROVENANCE.md visible (it is local-only by design, in private/); " +
        "ensure the local provenance record exists in the working environment.",
    );
  }

  if (problems.length > 0) {
    console.error(`cleanroom-guards: FAIL — ${problems.length} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  const provNote = prov.tracked
    ? "provenance: tracked PROVENANCE.md present"
    : `provenance: local-only (private/PROVENANCE.md ${prov.local ? "present" : "absent"})`;
  console.log(`cleanroom-guards: PASS — E0/E5/E7 + doc-sources clean; ${provNote}`);
}

main();
