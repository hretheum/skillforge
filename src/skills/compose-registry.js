// The compose-registry — resolves a skill's compose step from its registry `compose` ref
// (docs/05 §"skill core compose"; Phase D OCP closure of).
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room).
//
// WHY THIS EXISTS. Before Phase D the skill→compose binding lived in hand-maintained
// COMPOSE_BY_SKILL tables in the run path. Adding a skill meant editing those
// tables AND its registry entry — two edits, two places to drift. This registry makes the binding
// DATA: each skill entry declares a `compose` ref ("<dir>/compose.js#<export>"), and this module
// resolves that ref to the actual function. The run path passes the skill's registry entry; the
// binding table is the registry, not code.
//
// THE REGISTRY IS INJECTED DATA, NOT A STATIC IMPORT. This module deliberately does NOT import
// skillforge.registry.json — the engine already carries the parsed registry as `args.registry`
// and passes the per-skill ref in. Keeping the registry out of the module's import graph means a
// caller running against a sandboxed/alternate tree (e.g. the determinism gate) is not coupled to
// the repo-root JSON; the engine stays generic over the registry it is handed.
//
// Pattern mirrors src/adapters/index.js: static imports enumerate the engine's KNOWN compose
// implementations once (so adding a recipe is a deliberate, visible code touch HERE), and a map
// binds the registry's ref strings to those callables. The resolution is synchronous (static
// imports, no dynamic import) so the run path stays a plain function call.

import { composeComponent } from "./create-component/compose.js";
import { composeInstruction as composeBrandDiscovery } from "./brand-discovery/compose.js";
import { composeInstruction as composePlatformAnalysis } from "./competitive-platform-analysis/compose.js";
import { composeInstruction as composeBenchmarkMethodology } from "./benchmark-methodology/compose.js";
import { composeInstruction as composeReportStructure } from "./competitive-report-structure/compose.js";
import { composeSync } from "./sync-example/compose.js";
import { composeInstruction as composeVerdexCreateComponent } from "./verdex-create-component/compose.js";
import { composeInstruction as composeVerdexFormBuilder } from "./verdex-form-builder/compose.js";
import { composeAnalysis as composeVerdexAnalytics } from "./verdex-analytics/compose.js";
import { composeValidation as composeVerdexDisclosureCheck } from "./verdex-disclosure-check/compose.js";

// The ref→callable table: every compose export the engine knows, keyed by the SAME ref string a
// registry entry's `compose` field carries ("<dir>/compose.js#<export>"). This is the one place
// the known recipes are enumerated; a registry ref that is not here cannot resolve (fail loud).
const COMPOSE_BY_REF = Object.freeze({
  "create-component/compose.js#composeComponent": composeComponent,
  "brand-discovery/compose.js#composeInstruction": composeBrandDiscovery,
  "competitive-platform-analysis/compose.js#composeInstruction": composePlatformAnalysis,
  "benchmark-methodology/compose.js#composeInstruction": composeBenchmarkMethodology,
  "competitive-report-structure/compose.js#composeInstruction": composeReportStructure,
  "sync-example/compose.js#composeSync": composeSync,
  "verdex-create-component/compose.js#composeInstruction": composeVerdexCreateComponent,
  "verdex-form-builder/compose.js#composeInstruction": composeVerdexFormBuilder,
  "verdex-analytics/compose.js#composeAnalysis": composeVerdexAnalytics,
  "verdex-disclosure-check/compose.js#composeValidation": composeVerdexDisclosureCheck,
});

/**
 * Resolve one `compose` ref string to its function. Returns the callable, or null if the ref is
 * not a known compose export. Pure over its input so both the run path and registry-lint
 * (LINT-COMPOSE-REQUIRED) share one resolver with no registry dependency.
 *
 * @param {unknown} ref  the registry entry's `compose` ref ("<dir>/compose.js#<export>").
 * @returns {Function|null}
 */
export function resolveComposeRef(ref) {
  if (typeof ref !== "string") return null;
  const fn = COMPOSE_BY_REF[ref];
  return typeof fn === "function" ? fn : null;
}

/**
 * Get the compose step for a recognized skill from its registry entry's `compose` ref. The
 * compose signature is uniform — {request, description, references} — and each compose reads only
 * the fields its kind supplies (artifact: description; instruction: references).
 *
 * @param {string} skillName  the skill's registry key (for the error message).
 * @param {object} entry  the skill's registry entry (carries the `compose` ref).
 * @returns {Function} the compose function.
 * @throws if the entry has no resolvable compose ref (fail loud — never a silent recipe).
 */
export function get(skillName, entry) {
  const fn = resolveComposeRef(entry?.compose);
  if (typeof fn !== "function") {
    throw new Error(
      `no compose step registered for skill "${skillName}" (compose ref: ${JSON.stringify(entry?.compose)})`,
    );
  }
  return fn;
}

export const composeRegistry = Object.freeze({ get, resolveComposeRef });
