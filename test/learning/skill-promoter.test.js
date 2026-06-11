// Clean-room: concept + first principles, zero third-party skills-factory files.
import { test } from "node:test";
import assert from "node:assert/strict";

import { LEARNED_DIR, promoteToLearned } from "../../src/learning/skill-promoter.js";

// An in-memory fs double — no real disk writes in tests.
function memFs() {
  const writes = [];
  const mkdirs = [];
  return {
    writes,
    mkdirs,
    fs: {
      async writeFile(p, content, enc) {
        writes.push({ path: p, content, enc });
      },
    },
    async mkdir(dir, opts) {
      mkdirs.push({ dir, opts });
    },
  };
}

const pattern = {
  skillName: "brand-discovery",
  patternKey: "brand-discovery:Read",
  frequency: 4,
  evidence: [
    { timestamp: "2026-06-10T10:00:00Z" },
    { timestamp: "2026-06-10T10:01:00Z" },
  ],
};

test("LEARNED_DIR is 'learned'", () => {
  assert.equal(LEARNED_DIR, "learned");
});

test("scan clean → promotes and writes the candidate file", async () => {
  const m = memFs();
  const res = await promoteToLearned(
    pattern,
    { clean: true, findings: [] },
    { fs: m.fs, mkdir: m.mkdir },
  );
  assert.equal(res.promoted, true);
  assert.equal(m.writes.length, 1);
  assert.match(m.writes[0].path, /learned[/\\]brand-discovery_Read\.md$/);
  assert.match(m.writes[0].content, /origin: learned/);
  assert.match(m.writes[0].content, /confidence: 4/);
  assert.match(m.writes[0].content, /2026-06-10T10:00:00Z/);
  assert.equal(m.mkdirs.length, 1);
  assert.deepEqual(m.mkdirs[0].opts, { recursive: true });
});

test("scan dirty → not promoted, no write, reason names the findings", async () => {
  const m = memFs();
  const res = await promoteToLearned(
    pattern,
    { clean: false, findings: [{ type: "injection", detail: "injection markers: ignore previous" }] },
    { fs: m.fs, mkdir: m.mkdir },
  );
  assert.equal(res.promoted, false);
  assert.equal(res.path, null);
  assert.match(res.reason, /supply-chain scan failed/);
  assert.match(res.reason, /ignore previous/);
  assert.equal(m.writes.length, 0, "no file written when scan is dirty");
});

test("missing scan result → fail-closed, not promoted", async () => {
  const m = memFs();
  const res = await promoteToLearned(pattern, null, { fs: m.fs, mkdir: m.mkdir });
  assert.equal(res.promoted, false);
  assert.equal(m.writes.length, 0);
});

test("invalid pattern → not promoted", async () => {
  const m = memFs();
  const res = await promoteToLearned({}, { clean: true }, { fs: m.fs, mkdir: m.mkdir });
  assert.equal(res.promoted, false);
  assert.match(res.reason, /invalid pattern/);
});
