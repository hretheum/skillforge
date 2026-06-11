// Skill core — the "verdex-disclosure-check" COMPOSE step: a VALIDATION recipe that checks a
// generated Verdex financial disclosure carries the sections MiFID II requires (risk warnings,
// cost disclosure, regulatory references).
//
// Sources: concept + first principles, zero files from any third-party skills-factory codebase
// (clean-room). See docs/p3-client-concept.md §4 (MiFID II — disclosure) and §6 (validation kind).
//
// VALIDATION KIND. The validationDescriptor's compose contract requires {pass:boolean,
// violations:string[]} (src/registry/kinds/validation.js). Its stage set has no read/build/gate
// (governance:'none'), so this is a read-only verdict — never a file write. Pairing a ⚖
// disclosure-producing skill with THIS validation is the engine-level compliance gate Verdex's
// `compliance` profile needs (docs/p3-client-concept.md §4 "Skills that must NOT be emitted without
// a paired compliance check").
//
// CLEAN-ROOM. This file names no client value: the disclosure under test arrives as DATA on
// `request.disclosure` (the artifact a sibling disclosure skill produced); the required-section
// vocabulary is the regulatory contract, not a client secret.

/**
 * The sections a MiFID II financial disclosure must carry. Each entry is a section key plus the
 * substrings whose presence (case-insensitively) evidences the section. This is the regulatory
 * checklist, not client material — the same for any MiFID II disclosure.
 */
export const REQUIRED_SECTIONS = Object.freeze([
  { key: "risk-warning", label: "risk warnings", markers: ["risk warning", "capital at risk", "may go down"] },
  { key: "cost-disclosure", label: "cost disclosure", markers: ["cost", "fee", "charge"] },
  { key: "regulatory-reference", label: "regulatory references", markers: ["FCA", "MiFID", "regulated by"] },
]);

/**
 * Reduce a disclosure under test to a single searchable lowercase string. Accepts either a string
 * (the rendered disclosure text) or an object whose string leaves are concatenated (a structured
 * disclosure spec). Anything else yields "" — an empty disclosure fails every section.
 *
 * @param {unknown} disclosure
 * @returns {string}
 */
function disclosureText(disclosure) {
  if (typeof disclosure === "string") return disclosure.toLowerCase();
  if (disclosure && typeof disclosure === "object") {
    const parts = [];
    const walk = (node) => {
      if (typeof node === "string") parts.push(node);
      else if (Array.isArray(node)) node.forEach(walk);
      else if (node && typeof node === "object") Object.values(node).forEach(walk);
    };
    walk(disclosure);
    return parts.join(" \n ").toLowerCase();
  }
  return "";
}

/**
 * Compose the disclosure-check verdict. Reads the disclosure under test from `request.disclosure`
 * and returns a {pass, violations} verdict: a violation per MiFID II section the disclosure omits.
 *
 * @param {object} args
 * @param {{ disclosure?: unknown }|null} [args.request]  the disclosure artifact to validate.
 * @returns {{ pass: boolean, violations: string[] }}
 */
export function composeValidation({ request = null } = {}) {
  const text = disclosureText(request?.disclosure);
  const violations = [];
  for (const section of REQUIRED_SECTIONS) {
    const present = section.markers.some((m) => text.includes(m.toLowerCase()));
    if (!present) {
      violations.push(
        `MiFID II disclosure is missing its ${section.label} section (no marker among: ${section.markers.join(", ")})`,
      );
    }
  }
  return { pass: violations.length === 0, violations };
}
