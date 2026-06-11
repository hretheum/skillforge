// residency-posture — assert the profile-A residency/retention posture AGAINST THE BACKEND,
// not against one mutable doc page (SEC-P1-4 / T-HARD-03).
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room). Realizes docs/15-compliance-and-cost.md §"Monitoring the ZDR basis"
// and docs/14-deployment-profiles.md §profile A (EU residency + ZDR).
//
// WHY THIS EXISTS (SEC-P1-4). Profile A sells a regulated client a hard promise — EU data
// residency + zero data retention — but the *truth* of that promise rests on facts about the
// MODEL BACKEND that live on mutable third-party pages (the Bedrock model card's EU-availability
// list and the abuse-detection page's retention-exception list). docs/15 names the failure
// window precisely: onboarding → silent third-party policy change → next audit. A control that
// is "a human re-reads the page at onboarding" cannot close that window. So the posture must be
// ASSERTED BY A CHECK that reads the backend's reported facts and FAILS when they diverge from
// the promise — a residency/retention regression is then caught the week it lands, not at audit.
//
// WHAT "AGAINST THE BACKEND" MEANS HERE. The check does not trust the prose of docs/15/14; it
// reads BACKEND EVIDENCE — the facts the backend reports about itself (which model IDs are
// available in the EU for the active profile, and which models the backend's retention-exception
// list names). The evidence is supplied by an injectable provider so the check is deterministic
// and offline-testable (a committed snapshot is the default source), while the SAME evaluator
// runs over a LIVE fetch for the scheduled re-check (docs/15 "scheduled re-check"). The contract
// the evidence is judged against is encoded here as data — the single asserted posture.
//
// DENY-FIRST / FAIL-CLOSED. Like the profile-evaluator sibling, this module never throws on bad
// input and never reads through as "compliant" when uncertain: missing or malformed evidence is
// a REGRESSION (the promise cannot be proven → it is not kept), not a pass. A check that fails
// open on a fetch error would re-create exactly the silent-window this task closes.

/** The residency posture handles this module asserts (docs/14 profile A). */
export const RESIDENCY = Object.freeze({
  // The model backend must reach the model through an EU REGIONAL (or EU geo) endpoint, never the
  // global endpoint (docs/15 fact 1: the global endpoint is not residency-safe).
  EU_REGIONAL: "eu-regional",
});

/** A residency/retention finding's severity — every non-OK finding fails the check (deny-first). */
export const FINDING = Object.freeze({
  OK: "ok",
  REGRESSION: "regression", // an asserted invariant is violated by the backend evidence
  UNPROVEN: "unproven", // evidence is missing/malformed → the promise cannot be proven (fail-closed)
});

// --- the asserted profile-A posture contract (the single copy, encoded as data) ----------
//
// These are the invariants docs/15 lists as the basis of the promise. The check proves each one
// against the backend evidence; any violation is a regression. Kept as data (not prose) so the
// check is the enforcement, and docs/15/14 remain the human narrative — neither re-prints the
// other's authority.
export const PROFILE_A_POSTURE = Object.freeze({
  profile: "compliance", // PROFILES.COMPLIANCE (docs/14)
  // INVARIANT R1 — residency: the active endpoint class must be EU-regional/EU-geo, not global.
  requiredEndpointClass: RESIDENCY.EU_REGIONAL,
  // INVARIANT R2 — model availability: the priced/active model MUST appear in the backend's
  // EU-available model list for the active profile (docs/15: "the priced model must appear in the
  // platform's available-model list for the active profile"). If it is dropped/renamed, residency
  // for that model is no longer delivered.
  // INVARIANT R3 — ZDR: the active model MUST NOT appear on the backend's retention-exception
  // list (docs/15 fact 2: ZDR-by-default holds only because Claude is NOT on that list; only the
  // GPT-5.x family is, as of 2026-06-05). If `anthropic.*`/the active model ever appears, ZDR by
  // default no longer holds → regression.
  // INVARIANT R4 — exception scope: the retention-exception list must stay within the KNOWN scope
  // recorded at the as-of date (GPT-5.x only). A widening of the list — even if it does not yet
  // name Claude — is a signal the policy is moving and must be surfaced, not silently tolerated.
  knownRetentionExceptionScope: Object.freeze(["gpt-5"]), // the family the as-of evidence names
  asOf: "2026-06-05", // the date the asserted scope was last confirmed (docs/15)
});

function regression(invariant, detail) {
  return Object.freeze({ finding: FINDING.REGRESSION, invariant, detail });
}
function unproven(invariant, detail) {
  return Object.freeze({ finding: FINDING.UNPROVEN, invariant, detail });
}

// Normalize a model id to its family prefix for the retention-exception scope check. The active
// model id is e.g. "anthropic.claude-sonnet-4-6"; an exception entry is e.g. "gpt-5" or
// "openai.gpt-5.1". We compare on a lowercased, vendor-stripped family token so a rename within
// a family (sonnet-4-6 → sonnet-4-7) does not spuriously pass R3, and a vendor prefix difference
// does not spuriously fail R4.
function familyOf(modelId) {
  if (typeof modelId !== "string") return null;
  const lower = modelId.toLowerCase().trim();
  if (lower === "") return null;
  // Strip a leading VENDOR prefix only — a vendor segment is a purely-alphabetic token before the
  // first dot ("anthropic.", "openai.", "aws.", "eu.anthropic." → strip both). A model NAME's dot
  // is a VERSION dot ("gpt-5.1", "claude-sonnet-4-6") whose pre-dot segment contains a digit/hyphen,
  // so it is NOT stripped — otherwise "gpt-5.1" would collapse to "1" and break the family compare.
  let rest = lower;
  for (;;) {
    const dot = rest.indexOf(".");
    if (dot < 0) break;
    const head = rest.slice(0, dot);
    if (!/^[a-z]+$/.test(head)) break; // not a vendor segment (has a digit/hyphen) → keep as-is
    rest = rest.slice(dot + 1);
  }
  return rest;
}

/**
 * Does the active model belong to a retention-exception family? An exception entry names a family
 * token (e.g. "gpt-5"); the active model matches if its family STARTS WITH that token. This is the
 * R3 test: the active model must NOT match any exception entry.
 */
function modelMatchesException(activeModelId, exceptionEntry) {
  const fam = familyOf(activeModelId);
  const exc = familyOf(exceptionEntry);
  if (fam == null || exc == null) return false;
  return fam === exc || fam.startsWith(exc + "-") || fam.startsWith(exc + ".") || fam.startsWith(exc);
}

/**
 * Is the retention-exception list within the asserted known scope? Every entry must belong to a
 * known-scope family; an entry outside it (a NEW family on the list) is a widening to surface (R4).
 * Returns the list of out-of-scope entries (empty = within scope).
 */
function exceptionsOutOfScope(exceptionList, knownScope) {
  const known = knownScope.map(familyOf);
  return exceptionList.filter((entry) => {
    const fam = familyOf(entry);
    if (fam == null) return true; // an unparseable entry is out of scope (cannot prove it is known)
    return !known.some((k) => k != null && (fam === k || fam.startsWith(k + "-") || fam.startsWith(k + ".") || fam.startsWith(k)));
  });
}

/**
 * @typedef {Object} BackendEvidence  what the backend reports about itself (the facts the promise
 *   rests on). Supplied by a provider (committed snapshot by default; live fetch for the
 *   scheduled re-check). Deny-first: a missing/malformed field is treated as unproven, not as a pass.
 * @property {string} endpointClass             the active endpoint class (e.g. "eu-regional", "global")
 * @property {string} activeModelId             the priced/active model id (e.g. "anthropic.claude-sonnet-4-6")
 * @property {string[]} euAvailableModels        model ids the backend reports available in the EU for this profile
 * @property {string[]} retentionExceptionList   model ids/families the backend names as retention exceptions
 * @property {string} [evidenceAsOf]            the date the evidence was fetched (for reporting)
 * @property {string} [source]                  where the evidence came from (snapshot path / live URL)
 */

/**
 * Assert the profile-A residency/retention posture against backend evidence.
 *
 * TOTAL and FAIL-CLOSED: never throws; returns a report whose `ok` is true ONLY when every
 * asserted invariant (R1–R4) is PROVEN by the evidence. Missing/malformed evidence → unproven →
 * ok:false (the promise is not proven, so it is not kept).
 *
 * @param {BackendEvidence} evidence
 * @param {typeof PROFILE_A_POSTURE} [posture]  the asserted contract (override for tests)
 * @returns {{ ok: boolean, findings: Array<{finding:string,invariant:string,detail:string}>,
 *            checked: string[], evidenceAsOf: string|null, source: string|null }}
 */
export function assertResidencyPosture(evidence, posture = PROFILE_A_POSTURE) {
  const findings = [];
  const checked = ["R1-endpoint", "R2-model-available", "R3-zdr-not-excepted", "R4-exception-scope"];

  // Evidence must be a well-formed object at all (fail-closed on garbage).
  if (evidence === null || typeof evidence !== "object") {
    return Object.freeze({
      ok: false,
      findings: [unproven("evidence", "no backend evidence supplied; the residency/retention promise cannot be proven (fail-closed)")],
      checked,
      evidenceAsOf: null,
      source: null,
    });
  }

  const { endpointClass, activeModelId, euAvailableModels, retentionExceptionList } = evidence;

  // R1 — residency: the endpoint class must be the asserted EU-regional class.
  if (typeof endpointClass !== "string" || endpointClass.trim() === "") {
    findings.push(unproven("R1-endpoint", "backend evidence does not report an endpoint class (fail-closed)"));
  } else if (endpointClass !== posture.requiredEndpointClass) {
    findings.push(
      regression(
        "R1-endpoint",
        `active endpoint class is "${endpointClass}" but profile A requires "${posture.requiredEndpointClass}"; a non-EU-regional endpoint may route data outside the EU (residency regression)`,
      ),
    );
  }

  // R2 — the priced/active model must be in the backend's EU-available list.
  if (typeof activeModelId !== "string" || activeModelId.trim() === "") {
    findings.push(unproven("R2-model-available", "backend evidence does not name an active model id (fail-closed)"));
  } else if (!Array.isArray(euAvailableModels)) {
    findings.push(unproven("R2-model-available", "backend evidence does not report the EU-available model list (fail-closed)"));
  } else if (!euAvailableModels.includes(activeModelId)) {
    findings.push(
      regression(
        "R2-model-available",
        `active model "${activeModelId}" is NOT in the backend's EU-available model list (${euAvailableModels.length} entries); EU residency for this model is no longer delivered (it may have been dropped/renamed)`,
      ),
    );
  }

  // R3 — ZDR: the active model must NOT be on the retention-exception list.
  if (!Array.isArray(retentionExceptionList)) {
    findings.push(unproven("R3-zdr-not-excepted", "backend evidence does not report the retention-exception list (fail-closed)"));
  } else if (typeof activeModelId === "string" && activeModelId.trim() !== "") {
    const hit = retentionExceptionList.find((entry) => modelMatchesException(activeModelId, entry));
    if (hit !== undefined) {
      findings.push(
        regression(
          "R3-zdr-not-excepted",
          `active model "${activeModelId}" matches retention-exception entry "${hit}"; ZDR-by-default no longer holds for the priced model (retention regression)`,
        ),
      );
    }
  }
  // (if activeModelId is missing, R2's unproven finding already fails the check; R3 cannot run)

  // R4 — exception scope: the list must stay within the asserted known scope; a widening is surfaced.
  if (Array.isArray(retentionExceptionList) && Array.isArray(posture.knownRetentionExceptionScope)) {
    const widened = exceptionsOutOfScope(retentionExceptionList, posture.knownRetentionExceptionScope);
    if (widened.length > 0) {
      findings.push(
        regression(
          "R4-exception-scope",
          `the backend's retention-exception list has WIDENED beyond the asserted scope (${posture.knownRetentionExceptionScope.join(", ")}, as of ${posture.asOf}): new entr${widened.length === 1 ? "y" : "ies"} ${widened.map((w) => `"${w}"`).join(", ")}; the retention policy is moving and must be re-confirmed even though Claude is not (yet) named`,
        ),
      );
    }
  }

  const ok = findings.length === 0;
  return Object.freeze({
    ok,
    findings: Object.freeze(findings),
    checked,
    evidenceAsOf: typeof evidence.evidenceAsOf === "string" ? evidence.evidenceAsOf : null,
    source: typeof evidence.source === "string" ? evidence.source : null,
  });
}

/** Read-only view of the asserted posture (tests / introspection; no mutation). */
export const _posture = Object.freeze({
  profileA: () => PROFILE_A_POSTURE,
});
