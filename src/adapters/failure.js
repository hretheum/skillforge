// The adapter runtime-failure contract (API-01).
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room). Realizes docs/04-adapters.md §"Adapter runtime-failure contract" +
// docs/06-loader-and-activation.md (startup validation says nothing about a system that is
// valid at start and unreachable at second 30).
//
// THE RUNTIME MIRROR OF "VALIDATE BEFORE ACTING". Startup validation (the loader) proves the
// WIRING is valid. This contract governs what happens when a system that was valid at start
// FAILS at call time — a token file that resolves but is malformed, a tracker that returns 429
// mid-read, a credential revoked between activation and the call, an output write that half-
// completes. The core speaks only the normalized form, so it has no way to interpret a backend
// error; this contract converts every degraded read/write into a CLASSIFIED, defined outcome —
// never an opaque crash, never a silent-wrong partial.
//
// THREE FAILURE CLASSES (docs/04 §"Failures are classified into three classes"):
//   - transient  (429/503/timeout/dropped connection)  → retry with bounded backoff; past the
//                                                          cap it becomes a fatal failure.
//   - auth       (401/403/expired/revoked credential)   → fail fast (no retry), with a ROTATION
//                                                          HINT naming the secret REFERENCE
//                                                          (never the value — docs/11).
//   - permanent  (404/malformed source/unfixable 400)   → stop; retrying cannot help.
//
// FATAL vs RECOVERABLE. "Recoverable" is a per-CALL property used by the retry helper: a
// transient class is recoverable UNTIL the bounded cap is exhausted, after which it is fatal
// for this run. auth and permanent are fatal from the first occurrence. The contract surfaces
// BOTH the class and a `fatal` flag so the caller (the run path) can apply the hard rule below.
//
// THE HARD RULE — INPUT FAILURES ABORT, NEVER DEGRADE (docs/04 §"Input failures abort
// assembly"). A confidently-wrong artifact built from half a design system is worse than a
// clean stop. So a fatal input-adapter failure ABORTS the run; the core must not assemble a
// skill on a partial or empty context. Empty source is its own defined outcome (see EMPTY).
//
// OUTPUT IS IDEMPOTENT OR TRANSACTIONAL (docs/04 §"Output adapters are idempotent or
// transactional"). A failed output call must leave the world fully-updated or untouched, never
// half-written. This module provides the commit helper (write-temp-then-rename) the file output
// adapter uses to satisfy the transactional half; an adapter whose render is a pure in-memory
// function (no side effect until the gated Write) is idempotent by construction.
//
// THE FAILURE IS DATA, AND SECRET-FREE (docs/04 §"The failure is data" + docs/11). A classified
// failure is a typed value (class + human reason + optional rotation hint), carrying NO secret
// values and NO raw source content — the same edge discipline as everywhere else.
//
// Generic by construction: this file names NO client and NO concrete backend. The class mapping
// is keyed on transport-neutral SIGNALS (an HTTP-ish status, a timeout marker, a parse failure)
// so any adapter — a DTCG file reader today, a Jira reader tomorrow — maps its backend's errors
// onto the same three classes behind the contract (docs/04 §"Why this lives in the adapter").

/** The three failure classes the contract recognizes (docs/04 §classes). */
export const FAILURE_CLASS = Object.freeze({
  TRANSIENT: "transient",
  AUTH: "auth",
  PERMANENT: "permanent",
});

/** Whether a class is RECOVERABLE in principle (only transient is — and only until the cap). */
const RECOVERABLE_CLASSES = new Set([FAILURE_CLASS.TRANSIENT]);

/** Default bound on a transient retry: attempts and total wall-time. Overridable as data. */
export const DEFAULT_RETRY = Object.freeze({ maxAttempts: 3, maxTotalMs: 2000, baseDelayMs: 50 });

/** Default per-call timeout (a sensible default, overridable as config data — docs/04 §bounded). */
export const DEFAULT_TIMEOUT_MS = 5000;

/**
 * A typed adapter failure — the ONLY failure shape the core/run path reasons about. It is data:
 * a class, a fatal flag, a human-readable reason, and (for auth) a rotation hint naming the
 * secret REFERENCE. It never carries a secret value or raw source content.
 */
export class AdapterFailure extends Error {
  /**
   * @param {object} info
   * @param {("transient"|"auth"|"permanent")} info.failureClass
   * @param {string} info.reason       human-readable, secret-free explanation
   * @param {("input"|"output")} [info.edge]   which edge failed
   * @param {boolean} [info.fatal]     whether this aborts the run (default: derived from class)
   * @param {string|null} [info.rotationHint]  for auth: the secret REFERENCE to rotate (never a value)
   * @param {Error} [info.cause]       the underlying error (for logs; not surfaced to artifacts)
   */
  constructor({ failureClass, reason, edge = null, fatal, rotationHint = null, cause } = {}) {
    super(reason);
    this.name = "AdapterFailure";
    this.failureClass = failureClass;
    this.edge = edge;
    // Fatality: explicit wins; otherwise auth/permanent are fatal, transient is recoverable
    // (the retry helper flips a transient to fatal once the cap is exhausted).
    this.fatal = typeof fatal === "boolean" ? fatal : !RECOVERABLE_CLASSES.has(failureClass);
    this.rotationHint = rotationHint;
    if (cause !== undefined) this.cause = cause;
  }

  /** A plain, secret-free projection for telemetry / the skill_result event (docs/04 + docs/10). */
  toData() {
    return {
      failureClass: this.failureClass,
      fatal: this.fatal,
      reason: this.message,
      edge: this.edge,
      rotationHint: this.rotationHint,
    };
  }
}

/** True for the contract's typed failure (vs an arbitrary thrown Error). */
export function isAdapterFailure(value) {
  return value instanceof AdapterFailure;
}

/**
 * Classify a raw backend error into one of the three classes — the transport-neutral mapping
 * every adapter funnels its errors through. Keyed on SIGNALS, not on a specific backend:
 *   - an explicit `failureClass` on the error (an adapter already classified it) is honored;
 *   - a numeric `status`/`statusCode` maps by HTTP convention (401/403→auth, 404/4xx→permanent,
 *     429/5xx→transient);
 *   - a timeout marker (`code === "ETIMEDOUT"`, `name === "TimeoutError"`, or our own marker)
 *     → transient;
 *   - a JSON/parse failure (`SyntaxError`, or a flagged malformed source) → permanent;
 *   - anything unrecognized → permanent (fail closed: an unknown error is NOT assumed retryable,
 *     so we never burn the budget retrying something that cannot recover).
 *
 * @param {unknown} err  the raw error from a backend call.
 * @returns {("transient"|"auth"|"permanent")}
 */
export function classifyFailure(err) {
  if (err && typeof err === "object") {
    // 1. Already-classified error (an adapter mapped its own backend).
    if (typeof err.failureClass === "string" && isKnownClass(err.failureClass)) {
      return err.failureClass;
    }
    // 2. Timeout markers → transient.
    if (err.code === "ETIMEDOUT" || err.name === "TimeoutError" || err.isTimeout === true) {
      return FAILURE_CLASS.TRANSIENT;
    }
    // 3. HTTP-ish status.
    const status = numericStatus(err);
    if (status !== null) {
      if (status === 401 || status === 403) return FAILURE_CLASS.AUTH;
      if (status === 429 || status >= 500) return FAILURE_CLASS.TRANSIENT;
      if (status >= 400) return FAILURE_CLASS.PERMANENT; // 404, unfixable 400, etc.
    }
    // 4. Parse failure / flagged malformed source → permanent.
    if (err instanceof SyntaxError || err.name === "SyntaxError" || err.isMalformed === true) {
      return FAILURE_CLASS.PERMANENT;
    }
  }
  // 5. Unknown → permanent (fail closed; do not retry an error we cannot reason about).
  return FAILURE_CLASS.PERMANENT;
}

/**
 * Wrap a raw error as a typed AdapterFailure with the right class + fatality + rotation hint.
 * The rotation hint (auth only) is supplied by the CALLER from config data — this module never
 * sees a secret value; the hint is a reference NAME the deployment chose to expose.
 *
 * @param {unknown} err
 * @param {object} [ctx]
 * @param {("input"|"output")} [ctx.edge]
 * @param {string} [ctx.adapter]   the adapter NAME (for the reason; not a secret)
 * @param {string|null} [ctx.rotationHint]  the secret REFERENCE for an auth failure
 * @param {boolean} [ctx.fatal]    force fatality (e.g. transient-past-cap)
 * @returns {AdapterFailure}
 */
export function toAdapterFailure(err, ctx = {}) {
  if (isAdapterFailure(err)) {
    // Already typed — only enrich an absent edge/hint, never overwrite a decided class.
    if (ctx.edge && !err.edge) err.edge = ctx.edge;
    if (ctx.rotationHint && !err.rotationHint) err.rotationHint = ctx.rotationHint;
    return err;
  }
  const failureClass = classifyFailure(err);
  const adapter = ctx.adapter ? ` (adapter "${ctx.adapter}")` : "";
  const reason = `${ctx.edge ?? "adapter"} call failed${adapter}: ${classReason(failureClass)}`;
  return new AdapterFailure({
    failureClass,
    reason,
    edge: ctx.edge ?? null,
    fatal: ctx.fatal,
    // A rotation hint is only meaningful for an auth failure; ignore it otherwise.
    rotationHint: failureClass === FAILURE_CLASS.AUTH ? (ctx.rotationHint ?? null) : null,
    cause: err instanceof Error ? err : undefined,
  });
}

// --- the empty / partial-result semantics --------------------------------------------------
//
// docs/04 + API-01 require EXPLICIT empty-source handling and all-or-nothing (vs partial)
// semantics. The contract draws the line at the EDGE:
//   - EMPTY input  = a successful read that yielded nothing usable (a source with zero
//     tokens/roles). It is NOT a transport failure, so it is not an AdapterFailure; it is a
//     defined PERMANENT-fatal outcome the run treats as "cannot assemble on empty context"
//     (docs/04 §"empty source handling" + docs/06 "never start with half its context").
//   - PARTIAL read  = a read that returned SOME but not all of the source (e.g. 3 of 4 token
//     files). Under the hard rule this is NOT a degraded success — it is a fatal failure, never
//     a partial-context run. assertCompleteRead() enforces that an adapter that detects a
//     partial read converts it to a fatal failure rather than returning the fragment.

/**
 * Decide whether a normalized DESCRIPTION is empty (no usable binding facts). Generic over the
 * payload's shape: a payload is empty iff EVERY own field is itself empty — a nullish value, or
 * an empty array. Any other field (a non-empty array, or any non-nullish scalar/object) is
 * content. The run uses this to refuse an empty-context assembly (the hard rule: no empty- or
 * partial-context run, faithful across CURRENT and FUTURE input adapters — e.g. a docs reader
 * whose empty read is an all-null object payload, not empty arrays).
 *
 * @param {{payload: unknown}} description  a normalized description (input edge).
 * @returns {boolean}
 */
export function isEmptyDescription(description) {
  const payload = description?.payload;
  if (payload === null || payload === undefined) return true;
  if (typeof payload !== "object") return false; // a scalar payload is, oddly, "something"
  const values = Object.values(payload);
  if (values.length === 0) return true; // an object with no own keys is empty
  // Empty iff every field is itself empty/nullish (an empty array OR a null/undefined value).
  // A non-empty array, or ANY non-nullish non-array value, is content — so an all-null object
  // payload (no arrays at all) correctly counts as EMPTY, closing the silent-wrong-on-empty gap
  // for a future object-payload input adapter (reviewer-p2 finding).
  return values.every((v) => v === null || v === undefined || (Array.isArray(v) && v.length === 0));
}

/**
 * Enforce the no-partial-context rule: if an adapter reports it read only PART of the source,
 * convert that to a FATAL failure rather than letting a fragment through. `read`/`expected` are
 * counts (or any comparable) the adapter supplies; a mismatch is a permanent-fatal failure.
 *
 * @param {object} args
 * @param {number} args.read       how many source units were successfully read
 * @param {number} args.expected   how many were expected
 * @param {("input"|"output")} [args.edge]
 * @param {string} [args.adapter]
 * @throws {AdapterFailure} permanent + fatal when read < expected
 */
export function assertCompleteRead({ read, expected, edge = "input", adapter } = {}) {
  if (typeof read === "number" && typeof expected === "number" && read < expected) {
    const adapterStr = adapter ? ` (adapter "${adapter}")` : "";
    throw new AdapterFailure({
      failureClass: FAILURE_CLASS.PERMANENT,
      reason:
        `${edge} read was partial${adapterStr}: ${read} of ${expected} source units read; ` +
        `aborting rather than assembling on partial context (no partial-context run)`,
      edge,
      fatal: true,
    });
  }
}

/**
 * Build the defined EMPTY-source failure — a permanent-fatal outcome the run uses when an input
 * read succeeded but yielded nothing usable. Surfaced as data, not a silent empty assembly.
 *
 * @param {object} [ctx]
 * @param {string} [ctx.adapter]
 * @returns {AdapterFailure}
 */
export function emptySourceFailure({ adapter } = {}) {
  const adapterStr = adapter ? ` (adapter "${adapter}")` : "";
  return new AdapterFailure({
    failureClass: FAILURE_CLASS.PERMANENT,
    reason:
      `input source is empty${adapterStr}: it resolved and read cleanly but carries no usable ` +
      `binding facts; aborting rather than assembling on empty context`,
    edge: "input",
    fatal: true,
  });
}

// --- the bounded call helpers --------------------------------------------------------------

/**
 * Run a SYNCHRONOUS adapter call under the contract: any throw is converted to a typed
 * AdapterFailure with the right class/fatality. (The MVP adapters are synchronous file readers;
 * the async retry/timeout helper below is for live-backend adapters.)
 *
 * @template T
 * @param {() => T} call          the adapter call (e.g. () => input.read(args))
 * @param {object} [ctx]          edge/adapter/rotationHint context for the typed failure
 * @returns {T}
 * @throws {AdapterFailure} the classified failure (never the raw error)
 */
export function callUnderContract(call, ctx = {}) {
  try {
    return call();
  } catch (err) {
    throw toAdapterFailure(err, ctx);
  }
}

/**
 * Run an ASYNC adapter call under the contract WITH a bounded timeout and bounded
 * transient-retry-with-backoff. The cap on attempts/total-time is the line where a transient
 * (recoverable) failure becomes FATAL for this run (docs/04 §transient: "If still failing after
 * the cap, it becomes a permanent failure for this run"). auth/permanent fail fast (no retry).
 *
 * `now`/`sleep` are injectable so tests can drive the bound deterministically without real time.
 *
 * @template T
 * @param {() => Promise<T>} call   the async adapter call
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs]        per-attempt timeout (default DEFAULT_TIMEOUT_MS)
 * @param {object} [opts.retry]            { maxAttempts, maxTotalMs, baseDelayMs }
 * @param {("input"|"output")} [opts.edge]
 * @param {string} [opts.adapter]
 * @param {string|null} [opts.rotationHint]
 * @param {() => number} [opts.now]        clock (default Date.now)
 * @param {(ms: number) => Promise<void>} [opts.sleep]  delay (default real setTimeout)
 * @returns {Promise<T>}
 * @throws {AdapterFailure}
 */
export async function callAsyncUnderContract(call, opts = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retry = DEFAULT_RETRY,
    edge = null,
    adapter,
    rotationHint = null,
    now = Date.now,
    sleep = realSleep,
  } = opts;
  const { maxAttempts, maxTotalMs, baseDelayMs } = { ...DEFAULT_RETRY, ...retry };

  const started = now();
  let attempt = 0;
  let lastFailure = null;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      return await withTimeout(call(), timeoutMs, { edge, adapter });
    } catch (err) {
      const failure = toAdapterFailure(err, { edge, adapter, rotationHint });
      lastFailure = failure;

      // auth / permanent: fail fast — retrying cannot help (and an auth retry burns budget).
      if (failure.failureClass !== FAILURE_CLASS.TRANSIENT) throw failure;

      // transient: retry within the bound. If the bound is exhausted, it becomes fatal.
      const elapsed = now() - started;
      const delay = baseDelayMs * 2 ** (attempt - 1); // exponential backoff
      if (attempt >= maxAttempts || elapsed + delay >= maxTotalMs) {
        throw new AdapterFailure({
          failureClass: FAILURE_CLASS.TRANSIENT,
          reason:
            `${failure.message} — still failing after ${attempt} attempt(s) within the bound; ` +
            `transient failure exhausted its retry cap and is now fatal for this run`,
          edge,
          fatal: true, // transient-past-cap ⇒ fatal (the rule)
          cause: failure,
        });
      }
      await sleep(delay);
    }
  }
  // Unreachable in practice (the loop throws on the last attempt), but fail closed.
  throw (
    lastFailure ??
    new AdapterFailure({ failureClass: FAILURE_CLASS.PERMANENT, reason: "adapter call failed", edge, fatal: true })
  );
}

/**
 * Bound a promise by a timeout; on expiry reject with a transient-classed timeout error so the
 * retry helper treats it as retryable (docs/04 §"exceeding it is a failure of the transient
 * class … not a hang").
 */
function withTimeout(promise, timeoutMs, ctx) {
  if (!(timeoutMs > 0)) return promise;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new AdapterFailure({
          failureClass: FAILURE_CLASS.TRANSIENT,
          reason: `${ctx.edge ?? "adapter"} call timed out after ${timeoutMs}ms`,
          edge: ctx.edge ?? null,
        }),
      );
    }, timeoutMs);
    // Do not keep the event loop alive solely for this timer.
    if (typeof timer.unref === "function") timer.unref();
    Promise.resolve(promise).then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function realSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- transactional output commit (the file half of idempotent-or-transactional) ------------

/**
 * Commit bytes to a path TRANSACTIONALLY: write to a temp sibling, then atomically rename over
 * the target. A failure leaves the target untouched (the temp is cleaned up) — never a half-
 * written artifact (docs/04 §"write-temp-then-rename for files"). The actual `fs` calls are
 * injected so this stays unit-testable and so the run path can keep the real side effect behind
 * the PreToolUse gate.
 *
 * @param {object} args
 * @param {string} args.path        the final artifact path
 * @param {string} args.content     the bytes to write
 * @param {object} args.fs          { writeFileSync, renameSync, rmSync } (injected)
 * @param {() => string} [args.tmpName]  temp-path factory (default: path + ".tmp-<n>")
 * @throws {AdapterFailure} on a write/rename failure (target left untouched)
 */
export function commitArtifact({ path, content, fs, tmpName } = {}) {
  if (!fs || typeof fs.writeFileSync !== "function" || typeof fs.renameSync !== "function") {
    throw new TypeError("commitArtifact requires an fs with writeFileSync + renameSync");
  }
  const tmp = (tmpName ?? (() => `${path}.tmp-${process.pid}`))();
  try {
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, path); // atomic on POSIX: target is fully-updated or untouched
  } catch (err) {
    // Best-effort cleanup of the temp; the target is guaranteed untouched (rename is atomic,
    // and a failed write never reached the rename).
    try {
      if (typeof fs.rmSync === "function") fs.rmSync(tmp, { force: true });
    } catch {
      /* cleanup is best-effort; the invariant (target untouched) already holds */
    }
    throw toAdapterFailure(err, { edge: "output" });
  }
}

// --- internals ----------------------------------------------------------------------------

function isKnownClass(c) {
  return c === FAILURE_CLASS.TRANSIENT || c === FAILURE_CLASS.AUTH || c === FAILURE_CLASS.PERMANENT;
}

function numericStatus(err) {
  const s = err.status ?? err.statusCode ?? err.code;
  return typeof s === "number" && Number.isFinite(s) ? s : null;
}

function classReason(failureClass) {
  switch (failureClass) {
    case FAILURE_CLASS.AUTH:
      return "authentication/authorization failed (credential expired or revoked); failing fast";
    case FAILURE_CLASS.TRANSIENT:
      return "a transient backend condition (rate-limit/unavailable/timeout)";
    case FAILURE_CLASS.PERMANENT:
    default:
      return "a permanent condition (not-found / malformed source / unfixable request); retrying cannot help";
  }
}
