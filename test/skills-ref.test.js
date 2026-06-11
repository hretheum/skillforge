// Tests for the local skills-ref validator.
//
// Sources: concept + first principles, zero third-party skills-factory files
// (clean-room). Exercises the SKILL.md contract from doc 12 plus the
// generic-skill clean-room rule from doc 05, including the real skill under
// skills/ and synthetic fixtures for each failure mode.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const VALIDATOR = fileURLToPath(new URL("../tools/skills-ref.js", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Run the validator with `skills/` rooted at `cwd`. Returns {code, stdout, stderr}. */
function runValidator(cwd) {
  try {
    const stdout = execFileSync("node", [VALIDATOR], { cwd, encoding: "utf8" });
    return { code: 0, stdout, stderr: "" };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

/** Build a throwaway repo with a single skill file and return its dir. */
function withSkill(name, skillMd) {
  const root = mkdtempSync(join(tmpdir(), "skills-ref-"));
  const dir = join(root, "skills", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), skillMd);
  return root;
}

const VALID = `---
name: demo-skill
description: A generic demo skill that does a thing when a request matches it.
---

# Demo

A generic body with no client specifics.
`;

test("the checked-in create-component skill passes against the real skills/ dir", () => {
  const r = runValidator(REPO_ROOT);
  assert.equal(r.code, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /PASS/);
});

test("a well-formed synthetic skill passes", () => {
  const root = withSkill("demo-skill", VALID);
  const r = runValidator(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(r.code, 0, r.stderr);
});

test("missing frontmatter fails", () => {
  const root = withSkill("demo-skill", "# No frontmatter\n");
  const r = runValidator(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /frontmatter/i);
});

test("missing name fails", () => {
  const root = withSkill("demo-skill", `---\ndescription: has a description only\n---\n\nbody\n`);
  const r = runValidator(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /"name"/);
});

test("missing description fails", () => {
  const root = withSkill("demo-skill", `---\nname: demo-skill\n---\n\nbody\n`);
  const r = runValidator(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /"description"/);
});

test("name not matching directory fails", () => {
  const root = withSkill("demo-skill", `---\nname: other-name\ndescription: mismatch\n---\n\nbody\n`);
  const r = runValidator(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /must match the parent directory/);
});

test("invalid name characters fail", () => {
  const root = withSkill("Demo_Skill", `---\nname: Demo_Skill\ndescription: bad name\n---\n\nbody\n`);
  const r = runValidator(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /lowercase/);
});

test("empty body fails", () => {
  const root = withSkill("demo-skill", `---\nname: demo-skill\ndescription: no body follows\n---\n`);
  const r = runValidator(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /non-empty Markdown body/);
});

test("client name leak in body fails the generic-skill rule", () => {
  const root = withSkill(
    "demo-skill",
    `---\nname: demo-skill\ndescription: leaks a client name\n---\n\nThis emits a .hbtn for Example Studio.\n`,
  );
  const r = runValidator(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /generic/);
});

test("client token leak in body fails", () => {
  const root = withSkill(
    "demo-skill",
    `---\nname: demo-skill\ndescription: leaks a token\n---\n\nBind to --bc-color-ink for the surface.\n`,
  );
  const r = runValidator(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /--bc-/);
});

test("folded and block scalars parse without error", () => {
  const md = `---
name: demo-skill
description: >-
  A folded description that spans
  multiple lines and trims.
compatibility: |
  line one
  line two
metadata:
  skillforge.owner: platform
---

body
`;
  const root = withSkill("demo-skill", md);
  const r = runValidator(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(r.code, 0, r.stderr);
});
