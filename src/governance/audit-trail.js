// The PostToolUse audit trail — tamper-evidence + scope (T-HARD-05, closes GOV-06).
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room). Realizes docs/13-tool-governance.md §"PostToolUse → telemetry /
// audit" and the STRIDE Repudiation control of docs/11-security-and-secrets.md
// ("The audit trail is the repudiation control — names of resources, never values").
//
// WHY THIS EXISTS (GOV-06). docs/13 emits a secret-free event per tool call at PostToolUse so
// "no out-of-scope tool ran" becomes observable. The audit (AUD-ARCH, GOV-06) flagged the honest
// limit: PostToolUse "fires after a tool runs (cannot undo it)" — it is OBSERVATION, not
// enforcement. "No out-of-scope tool ran" is only provable from these events if the trail is
// COMPLETE and TRUSTWORTHY: an attacker who can suppress or rewrite a PostToolUse record erases
// the audit. So the trail needs two properties the bare event stream did not state:
//
//   (1) APPEND-ONLY integrity — once recorded, an entry is immutable; the trail grows only at the
//       end. No in-place edit, no deletion, no reordering of recorded entries.
//   (2) TAMPER-EVIDENCE — each entry links the previous entry's hash (a hash chain), so a deleted
//       or altered MIDDLE entry is DETECTABLE on verification, even though PostToolUse cannot
//       PREVENT a determined attacker from dropping the in-memory record. Detect, don't pretend to
//       prevent — the honest posture GOV-06 asks for.
//
// And the scope the rest of governance uses:
//
//   (3) SCOPED — every entry carries the (client, project) it belongs to (the same addressing
//       spine as secrets and the resolver), so the trail can be filtered per client/project
//       without ever co-mingling whose action was whose.
//
// HONEST BOUNDARY (GOV-06 recommendation, stated in code so it is not lost). The trail's AUTHORITY
// to say "this tool was denied" derives from the PreToolUse DENY (which actually blocks the call),
// NOT from the presence of a PostToolUse record. A MISSING PostToolUse entry is therefore a
// RELIABILITY concern (the record is incomplete), not a security BYPASS (the call was already
// gated upstream). The hash chain makes an incomplete/altered trail DETECTABLE; it does not turn
// PostToolUse into the boundary. The boundary is, and remains, the deny-first resolver at
// PreToolUse (docs/13 §enforcement seam 1).
//
// SECRET-FREE BY CONSTRUCTION (docs/11 hard rule 2 + docs/10 privacy). An entry records the
// RESOURCE NAME (the tool, the skill, the scope handles) and the resolver DECISION — never a
// secret value, never raw tool_input / source / artifact content. makeAuditEntry() scans its own
// payload and refuses a credential-shaped value (fail-closed), the same discipline as
// skill_result and the PreToolUse secret-scan.
//
// MODEL-INDEPENDENT & TRANSPORT-INJECTED. Plain logic over data — no model call. The trail object
// is an in-process recorder; a deployment that persists the trail injects its own sink (the same
// pattern as emitSkillResult). The engine decides WHAT a trustworthy entry is; the environment
// decides WHERE it is durably stored.

import { hasSecret } from "./secret-scan.js";
import { contentHash } from "../core/content-hash.js";
import { DECISION } from "./policy-resolver.js";

/** The audit event name, namespaced to skillforge (alongside Claude Code's native events). */
export const AUDIT_EVENT = "skillforge.tool_audit";

/** The hook seam this trail is fed from (docs/13 §PostToolUse). */
export const HOOK_EVENT_NAME = "PostToolUse";

/** The genesis link — the "previous hash" of the first entry in a fresh trail. */
export const GENESIS_PREV = "sha256:" + "0".repeat(64);

// The resolver decisions an audit entry may record. `defer` is internal-only to the resolver and
// is never a FINAL decision (docs/13), so the trail — which records what actually happened at the
// gate — only ever sees the three terminal verdicts.
const RECORDABLE_DECISIONS = new Set([DECISION.ALLOW, DECISION.ASK, DECISION.DENY]);

/**
 * The secret-free, scoped FACT an entry records — everything EXCEPT the chain fields (seq + the
 * prev/this hashes), which the trail assigns at append time. Factored out so the hash is computed
 * over a stable, well-defined subset and the secret-scan sees exactly what will be stored.
 *
 * @param {object} info
 * @param {string} info.tool       the tool that was called (a NAME, e.g. "mcp__tracker__create")
 * @param {("allow"|"ask"|"deny")} info.decision  the resolver's terminal verdict for the call
 * @param {string} info.skill      the skill that ran (a name)
 * @param {string|null} [info.client]   the client handle (scope), never client content
 * @param {string|null} [info.project] the project handle (scope), if any
 * @param {string} [info.at]       an ISO timestamp for the call (caller-supplied so the entry is a
 *        pure function of its inputs — testable + deterministic; defaults to now())
 * @returns {object} the secret-free fact (no chain fields yet)
 * @throws {TypeError} on a bad field or a credential-shaped value
 */
export function makeAuditEntry({ tool, decision, skill, client = null, project = null, at } = {}) {
  if (typeof tool !== "string" || tool.length === 0) {
    throw new TypeError("audit entry requires a non-empty tool name");
  }
  if (!RECORDABLE_DECISIONS.has(decision)) {
    throw new TypeError(
      `audit entry decision must be one of allow|ask|deny, got ${JSON.stringify(decision)} ` +
        "(defer is an internal resolver outcome, never a recorded verdict)",
    );
  }
  if (typeof skill !== "string" || skill.length === 0) {
    throw new TypeError("audit entry requires a non-empty skill name");
  }
  const when = typeof at === "string" && at.length > 0 ? at : new Date().toISOString();

  const fact = {
    event: AUDIT_EVENT,
    hookEventName: HOOK_EVENT_NAME,
    tool,
    decision,
    skill,
    // scope — the same (client, project) spine the resolver and secret model use.
    client,
    project,
    at: when,
  };

  // The trail must not become a secret-leak surface (docs/11 hard rule 2). Scan the whole fact;
  // refuse anything credential-shaped (e.g. a tool name that embedded a token, or a misused
  // scope handle) — fail-closed, the same posture as skill_result and the PreToolUse scan.
  if (hasSecret(fact)) {
    throw new TypeError(
      "refusing to record an audit entry: it carries a credential-shaped value " +
        "(the audit trail records resource NAMES and the decision — never a secret VALUE)",
    );
  }
  return fact;
}

/**
 * An append-only, scoped, tamper-evident audit trail.
 *
 * Integrity model:
 *   - APPEND-ONLY: the only mutation is record() adding ONE entry at the end. There is no API to
 *     edit, delete, or reorder. Recorded entries are deep-frozen, and entries() returns a COPY of
 *     the frozen list, so a caller cannot splice the internal array.
 *   - HASH CHAIN: each entry stores `prevHash` (the prior entry's `hash`, GENESIS_PREV for the
 *     first) and its own `hash` = contentHash(fact + seq + prevHash). Altering or removing any
 *     entry breaks the chain from that point on, which verify() detects.
 *   - SEQ: a strictly-increasing 0-based sequence number, so a gap (a suppressed entry) is visible
 *     independently of the hash chain.
 *
 * @param {object} [opts]
 * @param {(entry: object) => void} [opts.sink]  an optional durable transport called once per
 *        recorded entry (best-effort: a throwing sink does not break recording — telemetry/audit
 *        export is never the reason a run fails, the same rule as emitSkillResult).
 */
export class AuditTrail {
  #entries = [];
  #sink;

  constructor({ sink } = {}) {
    this.#sink = typeof sink === "function" ? sink : null;
  }

  /** The number of recorded entries. */
  get length() {
    return this.#entries.length;
  }

  /** The hash of the last entry (the chain head), or GENESIS_PREV for an empty trail. */
  get headHash() {
    return this.#entries.length === 0 ? GENESIS_PREV : this.#entries[this.#entries.length - 1].hash;
  }

  /**
   * Append one entry. Accepts either a fact from makeAuditEntry or the raw fields (which it then
   * validates via makeAuditEntry, so every recorded entry is secret-scanned exactly once).
   * Returns the recorded, frozen entry (with seq + chain fields). This is the ONLY mutator.
   *
   * @param {object} info  a fact from makeAuditEntry OR raw { tool, decision, skill, client?, project?, at? }
   * @returns {Readonly<object>} the recorded entry
   */
  record(info) {
    // Re-validate through makeAuditEntry so a raw object is secret-scanned and shape-checked, and a
    // pre-built fact is normalized to exactly the stored field set (defense against a caller
    // sneaking extra keys past the scan).
    const fact = makeAuditEntry(info);

    const seq = this.#entries.length;
    const prevHash = this.headHash;
    // The hash binds the fact to its POSITION (seq) and its PREDECESSOR (prevHash) — so neither a
    // reorder nor a deletion can go unnoticed: both change some later entry's prevHash/seq pair.
    const hash = contentHash({ fact, seq, prevHash });

    const entry = Object.freeze({ ...fact, seq, prevHash, hash });
    this.#entries.push(entry);

    if (this.#sink) {
      try {
        this.#sink(entry);
      } catch {
        // Best-effort durable export: a broken sink does not break the in-process trail or the
        // run. A persistent sink outage is itself observable (entries pile up unexported), not a
        // crash. The in-memory chain remains verifiable regardless.
      }
    }
    return entry;
  }

  /**
   * A COPY of the recorded entries (frozen). Returning a copy keeps append-only honest: a caller
   * mutating the returned array cannot alter the trail.
   *
   * @param {object} [filter]  optional scope filter — { client?, project? }. A field that is
   *        omitted (undefined) is not constrained; an explicit value (incl. null) must match.
   * @returns {ReadonlyArray<object>}
   */
  entries(filter) {
    const all = this.#entries.slice();
    if (!filter || typeof filter !== "object") return all;
    const constrainClient = Object.prototype.hasOwnProperty.call(filter, "client");
    const constrainProject = Object.prototype.hasOwnProperty.call(filter, "project");
    return all.filter(
      (e) =>
        (!constrainClient || e.client === filter.client) &&
        (!constrainProject || e.project === filter.project),
    );
  }

  /**
   * Verify the chain's integrity. Recomputes each entry's hash from its fact+seq+prevHash and
   * checks the links and the seq sequence. Detects: an in-place edit (hash mismatch), a deletion
   * or reorder (a broken prevHash link and/or a seq gap), and a wrong genesis link.
   *
   * @returns {{ ok: boolean, brokenAt: number|null, reason: string|null }}
   *   ok=true and brokenAt=null when intact; otherwise the index of the first broken entry and why.
   */
  verify() {
    let expectedPrev = GENESIS_PREV;
    for (let i = 0; i < this.#entries.length; i++) {
      const e = this.#entries[i];
      if (e.seq !== i) {
        return { ok: false, brokenAt: i, reason: `seq gap/disorder: entry ${i} has seq ${e.seq}` };
      }
      if (e.prevHash !== expectedPrev) {
        return { ok: false, brokenAt: i, reason: `broken link at entry ${i}: prevHash does not match the predecessor` };
      }
      const { seq, prevHash, hash, ...fact } = e;
      const recomputed = contentHash({ fact, seq, prevHash });
      if (recomputed !== hash) {
        return { ok: false, brokenAt: i, reason: `tampered entry ${i}: recomputed hash does not match stored hash` };
      }
      expectedPrev = hash;
    }
    return { ok: true, brokenAt: null, reason: null };
  }

  /**
   * Verify an EXTERNALLY-supplied entry list (e.g. one read back from durable storage) with the
   * same rules as verify(). Static so a deployment can check a persisted trail it did not build
   * in-process — the integrity property travels with the data, not only with this object.
   *
   * @param {ReadonlyArray<object>} entries
   * @returns {{ ok: boolean, brokenAt: number|null, reason: string|null }}
   */
  static verifyEntries(entries) {
    if (!Array.isArray(entries)) {
      return { ok: false, brokenAt: null, reason: "entries must be an array" };
    }
    let expectedPrev = GENESIS_PREV;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (!e || typeof e !== "object") {
        return { ok: false, brokenAt: i, reason: `entry ${i} is not an object` };
      }
      if (e.seq !== i) {
        return { ok: false, brokenAt: i, reason: `seq gap/disorder: entry ${i} has seq ${e.seq}` };
      }
      if (e.prevHash !== expectedPrev) {
        return { ok: false, brokenAt: i, reason: `broken link at entry ${i}: prevHash does not match the predecessor` };
      }
      const { seq, prevHash, hash, ...fact } = e;
      if (contentHash({ fact, seq, prevHash }) !== hash) {
        return { ok: false, brokenAt: i, reason: `tampered entry ${i}: recomputed hash does not match stored hash` };
      }
      expectedPrev = hash;
    }
    return { ok: true, brokenAt: null, reason: null };
  }
}
