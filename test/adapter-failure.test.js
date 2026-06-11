// The adapter runtime-failure contract (T-P2-05 / API-01).
//
// Sources: concept + first principles, zero third-party skills-factory files (clean-room).
// docs/04 §"Adapter runtime-failure contract". Asserts every degraded failure mode
// (timeout / malformed / partial / empty / auth) maps to a DEFINED fatal-or-recoverable
// outcome — never a crash, never a silent-wrong partial.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FAILURE_CLASS,
  AdapterFailure,
  isAdapterFailure,
  classifyFailure,
  toAdapterFailure,
  isEmptyDescription,
  assertCompleteRead,
  emptySourceFailure,
  callUnderContract,
  callAsyncUnderContract,
  commitArtifact,
  DEFAULT_RETRY,
} from "../src/adapters/failure.js";
import { readInput, buildResult } from "../src/adapters/run-edges.js";

// --- classification: the three classes, keyed on transport-neutral signals -----------------

test("classifyFailure: 401/403 → auth; 429/5xx → transient; 404/4xx → permanent", () => {
  assert.equal(classifyFailure({ status: 401 }), FAILURE_CLASS.AUTH);
  assert.equal(classifyFailure({ statusCode: 403 }), FAILURE_CLASS.AUTH);
  assert.equal(classifyFailure({ status: 429 }), FAILURE_CLASS.TRANSIENT);
  assert.equal(classifyFailure({ status: 503 }), FAILURE_CLASS.TRANSIENT);
  assert.equal(classifyFailure({ status: 404 }), FAILURE_CLASS.PERMANENT);
  assert.equal(classifyFailure({ status: 400 }), FAILURE_CLASS.PERMANENT);
});

test("classifyFailure: timeout markers → transient", () => {
  assert.equal(classifyFailure({ code: "ETIMEDOUT" }), FAILURE_CLASS.TRANSIENT);
  assert.equal(classifyFailure({ name: "TimeoutError" }), FAILURE_CLASS.TRANSIENT);
  assert.equal(classifyFailure({ isTimeout: true }), FAILURE_CLASS.TRANSIENT);
});

test("classifyFailure: a JSON/parse failure (malformed source) → permanent", () => {
  let parseErr;
  try {
    JSON.parse("{ not json");
  } catch (e) {
    parseErr = e;
  }
  assert.ok(parseErr instanceof SyntaxError);
  assert.equal(classifyFailure(parseErr), FAILURE_CLASS.PERMANENT);
  assert.equal(classifyFailure({ isMalformed: true }), FAILURE_CLASS.PERMANENT);
});

test("classifyFailure: an unrecognized error fails CLOSED (permanent, never assumed retryable)", () => {
  assert.equal(classifyFailure(new Error("who knows")), FAILURE_CLASS.PERMANENT);
  assert.equal(classifyFailure("a string"), FAILURE_CLASS.PERMANENT);
  assert.equal(classifyFailure(null), FAILURE_CLASS.PERMANENT);
});

test("classifyFailure: honors an error that already declared its own class", () => {
  assert.equal(classifyFailure({ failureClass: "transient" }), FAILURE_CLASS.TRANSIENT);
  assert.equal(classifyFailure({ failureClass: "auth", status: 404 }), FAILURE_CLASS.AUTH);
});

// --- fatality: auth/permanent fatal from the first occurrence; transient recoverable -------

test("AdapterFailure: auth/permanent are fatal by default; transient is recoverable", () => {
  assert.equal(new AdapterFailure({ failureClass: FAILURE_CLASS.AUTH, reason: "x" }).fatal, true);
  assert.equal(new AdapterFailure({ failureClass: FAILURE_CLASS.PERMANENT, reason: "x" }).fatal, true);
  assert.equal(new AdapterFailure({ failureClass: FAILURE_CLASS.TRANSIENT, reason: "x" }).fatal, false);
  // explicit fatal wins (transient-past-cap is forced fatal).
  assert.equal(
    new AdapterFailure({ failureClass: FAILURE_CLASS.TRANSIENT, reason: "x", fatal: true }).fatal,
    true,
  );
});

test("toAdapterFailure: an auth failure carries a rotation hint (a reference, never a value)", () => {
  const f = toAdapterFailure({ status: 401 }, { edge: "input", adapter: "jira", rotationHint: "secrets.jiraToken" });
  assert.ok(isAdapterFailure(f));
  assert.equal(f.failureClass, FAILURE_CLASS.AUTH);
  assert.equal(f.fatal, true);
  assert.equal(f.rotationHint, "secrets.jiraToken");
  assert.equal(f.edge, "input");
  // The hint names a reference, not a value — assert it is not a credential-shaped token.
  assert.doesNotMatch(f.rotationHint, /[A-Za-z0-9]{32,}/);
});

test("toAdapterFailure: a rotation hint is dropped for a non-auth class (only auth rotates)", () => {
  const f = toAdapterFailure({ status: 429 }, { edge: "input", rotationHint: "secrets.x" });
  assert.equal(f.failureClass, FAILURE_CLASS.TRANSIENT);
  assert.equal(f.rotationHint, null);
});

test("toData: a secret-free projection for telemetry/skill_result", () => {
  const data = toAdapterFailure({ status: 404 }, { edge: "input", adapter: "dtcg-tokens" }).toData();
  assert.deepEqual(Object.keys(data).sort(), ["edge", "failureClass", "fatal", "reason", "rotationHint"]);
  assert.equal(data.failureClass, FAILURE_CLASS.PERMANENT);
  assert.equal(data.fatal, true);
});

// --- empty / partial-result semantics (the hard rule) --------------------------------------

test("isEmptyDescription: a payload whose every array is empty is empty", () => {
  assert.equal(isEmptyDescription({ payload: { tokens: [], roles: [] } }), true);
  assert.equal(isEmptyDescription({ payload: { tokens: [{ name: "a" }], roles: [] } }), false);
  assert.equal(isEmptyDescription({ payload: {} }), true);
  assert.equal(isEmptyDescription({ payload: null }), true);
  assert.equal(isEmptyDescription({ payload: { meta: "x", tokens: [] } }), false); // non-array content
});

test("isEmptyDescription: an all-null object payload (no arrays) is EMPTY — future object-payload adapter", () => {
  // A future input adapter (e.g. a docs reader) whose empty read is an all-null object payload —
  // NOT empty arrays — must still count as empty so the run refuses an empty-context assembly
  // (the hard rule, generic over future adapters). reviewer-p2 finding: previously returned false.
  assert.equal(isEmptyDescription({ payload: { title: null, body: null } }), true);
  assert.equal(isEmptyDescription({ payload: { title: null, body: undefined } }), true);
  // a single non-nullish field is content → not empty.
  assert.equal(isEmptyDescription({ payload: { title: "Spec", body: null } }), false);
  // a nested non-empty object is content (only nullish + empty-array count as empty).
  assert.equal(isEmptyDescription({ payload: { meta: { a: 1 } } }), false);
});

test("assertCompleteRead: a partial read is a fatal permanent failure (no partial-context run)", () => {
  assert.throws(
    () => assertCompleteRead({ read: 3, expected: 4, edge: "input", adapter: "jira" }),
    (e) => isAdapterFailure(e) && e.fatal && e.failureClass === FAILURE_CLASS.PERMANENT && /partial/.test(e.message),
  );
  // a complete read does not throw.
  assert.doesNotThrow(() => assertCompleteRead({ read: 4, expected: 4 }));
});

test("emptySourceFailure: a defined permanent-fatal outcome", () => {
  const f = emptySourceFailure({ adapter: "dtcg-tokens" });
  assert.ok(isAdapterFailure(f));
  assert.equal(f.failureClass, FAILURE_CLASS.PERMANENT);
  assert.equal(f.fatal, true);
  assert.match(f.message, /empty/);
});

// --- the bounded sync call ----------------------------------------------------------------

test("callUnderContract: a thrown raw error becomes a typed AdapterFailure (never escapes raw)", () => {
  assert.throws(
    () =>
      callUnderContract(
        () => {
          throw new SyntaxError("Unexpected token");
        },
        { edge: "input", adapter: "dtcg-tokens", fatal: true },
      ),
    (e) => isAdapterFailure(e) && e.failureClass === FAILURE_CLASS.PERMANENT && e.fatal === true,
  );
});

test("callUnderContract: a successful call passes its value through unchanged", () => {
  const v = callUnderContract(() => ({ ok: 1 }), { edge: "input" });
  assert.deepEqual(v, { ok: 1 });
});

// --- the bounded async retry/timeout (transient → recoverable until the cap, then fatal) ----

test("callAsyncUnderContract: a transient failure is RETRIED, then succeeds within the cap", async () => {
  let calls = 0;
  const v = await callAsyncUnderContract(
    async () => {
      calls += 1;
      if (calls < 3) throw { status: 503 }; // transient twice, then ok
      return "ok";
    },
    { edge: "input", now: stubClock(), sleep: noSleep, retry: { maxAttempts: 5, maxTotalMs: 100000, baseDelayMs: 1 } },
  );
  assert.equal(v, "ok");
  assert.equal(calls, 3);
});

test("callAsyncUnderContract: a transient past the attempt cap becomes FATAL", async () => {
  let calls = 0;
  await assert.rejects(
    callAsyncUnderContract(
      async () => {
        calls += 1;
        throw { status: 429 }; // always transient
      },
      { edge: "input", now: stubClock(), sleep: noSleep, retry: { maxAttempts: 3, maxTotalMs: 100000, baseDelayMs: 1 } },
    ),
    (e) => isAdapterFailure(e) && e.failureClass === FAILURE_CLASS.TRANSIENT && e.fatal === true && /fatal/.test(e.message),
  );
  assert.equal(calls, 3, "stopped at the attempt cap");
});

test("callAsyncUnderContract: an AUTH failure fails FAST (no retry)", async () => {
  let calls = 0;
  await assert.rejects(
    callAsyncUnderContract(
      async () => {
        calls += 1;
        throw { status: 401 };
      },
      { edge: "input", rotationHint: "secrets.token", now: stubClock(), sleep: noSleep },
    ),
    (e) => isAdapterFailure(e) && e.failureClass === FAILURE_CLASS.AUTH && e.fatal === true && e.rotationHint === "secrets.token",
  );
  assert.equal(calls, 1, "auth is not retried (no budget burn)");
});

test("callAsyncUnderContract: a hang past the per-call timeout is a transient timeout", async () => {
  await assert.rejects(
    callAsyncUnderContract(() => new Promise(() => {}) /* never resolves */, {
      edge: "input",
      timeoutMs: 5,
      retry: { maxAttempts: 1, maxTotalMs: 100, baseDelayMs: 1 },
    }),
    (e) => isAdapterFailure(e) && /timed out/.test(e.message),
  );
});

test("callAsyncUnderContract: the retry is bounded by total wall-time, not just attempts", async () => {
  let calls = 0;
  await assert.rejects(
    callAsyncUnderContract(
      async () => {
        calls += 1;
        throw { status: 503 };
      },
      {
        edge: "input",
        // a clock that jumps far past maxTotalMs after the first attempt → the bound trips.
        now: stubClock([0, 0, 99999]),
        sleep: noSleep,
        retry: { maxAttempts: 99, maxTotalMs: 1000, baseDelayMs: 1 },
      },
    ),
    (e) => isAdapterFailure(e) && e.fatal === true,
  );
  assert.ok(calls < 99, "the wall-time bound stopped retrying before the attempt cap");
});

// --- transactional output commit (idempotent-or-transactional) -----------------------------

test("commitArtifact: writes temp then renames atomically (target untouched until commit)", () => {
  const order = [];
  const fs = {
    writeFileSync: (p) => order.push(["write", p]),
    renameSync: (from, to) => order.push(["rename", from, to]),
    rmSync: () => order.push(["rm"]),
  };
  commitArtifact({ path: "/out/Button.tsx", content: "x", fs, tmpName: () => "/out/Button.tsx.tmp" });
  assert.deepEqual(order, [
    ["write", "/out/Button.tsx.tmp"],
    ["rename", "/out/Button.tsx.tmp", "/out/Button.tsx"],
  ]);
});

test("commitArtifact: a write failure leaves the target untouched and cleans up the temp", () => {
  const order = [];
  const fs = {
    writeFileSync: () => {
      throw new Error("disk full");
    },
    renameSync: () => order.push(["rename"]),
    rmSync: () => order.push(["rm-temp"]),
  };
  assert.throws(
    () => commitArtifact({ path: "/out/Button.tsx", content: "x", fs, tmpName: () => "/out/Button.tsx.tmp" }),
    (e) => isAdapterFailure(e),
  );
  assert.deepEqual(order, [["rm-temp"]], "no rename ran (target untouched); temp cleaned up");
});

// --- run-edge wrappers: the contract applied at the run path's two edges --------------------

test("readInput: a malformed source surfaces as a FATAL input failure (not a crash)", () => {
  const adapter = {
    read: () => {
      throw new SyntaxError("DTCG token file is not valid JSON");
    },
  };
  assert.throws(
    () => readInput({ adapter, adapterName: "dtcg-tokens", readArgs: {} }),
    (e) => isAdapterFailure(e) && e.edge === "input" && e.fatal === true && e.failureClass === FAILURE_CLASS.PERMANENT,
  );
});

test("readInput: an EMPTY source is refused as a defined fatal outcome (no empty-context run)", () => {
  const adapter = { read: () => ({ edge: "input", envelope: {}, payload: { tokens: [], roles: [] } }) };
  assert.throws(
    () => readInput({ adapter, adapterName: "dtcg-tokens", readArgs: {} }),
    (e) => isAdapterFailure(e) && e.fatal === true && /empty/.test(e.message),
  );
});

test("readInput: EVERY input failure is fatal — even a transient one aborts (the hard rule)", () => {
  const adapter = {
    read: () => {
      throw { status: 503 }; // transient class, but at the input edge it must abort
    },
  };
  assert.throws(
    () => readInput({ adapter, adapterName: "jira", readArgs: {} }),
    (e) => isAdapterFailure(e) && e.fatal === true,
  );
});

test("readInput: a non-empty read passes through unchanged", () => {
  const desc = { edge: "input", envelope: {}, payload: { tokens: [{ name: "a" }], roles: [] } };
  const adapter = { read: () => desc };
  assert.equal(readInput({ adapter, adapterName: "dtcg-tokens", readArgs: {} }), desc);
});

test("buildResult: a render throw surfaces as a fatal output failure (no raw escape)", () => {
  const adapter = {
    makeResult: (spec) => ({ spec }),
    render: () => {
      throw new TypeError("bad result");
    },
  };
  assert.throws(
    () => buildResult({ adapter, adapterName: "react", spec: {}, identity: "Button" }),
    (e) => isAdapterFailure(e) && e.edge === "output" && e.fatal === true,
  );
});

test("buildResult: a clean build returns { result, artifact }", () => {
  const adapter = {
    makeResult: (spec, id) => ({ result: true, id }),
    render: (r) => ({ artifact: true, from: r }),
  };
  const out = buildResult({ adapter, adapterName: "react", spec: { x: 1 }, identity: "Button" });
  assert.deepEqual(out.result, { result: true, id: "Button" });
  assert.deepEqual(out.artifact, { artifact: true, from: { result: true, id: "Button" } });
});

// --- helpers -------------------------------------------------------------------------------

/** A deterministic clock: returns the given sequence, or a fixed 0 once exhausted. */
function stubClock(sequence) {
  if (!sequence) return () => 0;
  let i = 0;
  return () => (i < sequence.length ? sequence[i++] : sequence[sequence.length - 1]);
}

/** A no-op sleep so the retry loop runs without real time. */
function noSleep() {
  return Promise.resolve();
}

// touch DEFAULT_RETRY so the import is load-bearing (documents the bound's existence).
test("DEFAULT_RETRY exposes a bounded default (attempts + total time)", () => {
  assert.ok(DEFAULT_RETRY.maxAttempts >= 1 && DEFAULT_RETRY.maxTotalMs > 0);
});
