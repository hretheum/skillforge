// Skill core — the "create-component" COMPOSE step (docs/05 §"The life cycle of a single
// invocation", step 4 "Composing (skill core)").
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room).
//
// WHERE THIS SITS. In the run, the input adapter has already turned the client's design
// system into a normalized DESCRIPTION (tokens + roles). Compose is the ONLY step where the
// generic "how to build a component" recipe meets THIS client's data — and precisely because
// the meeting happens here, the recipe stays generic (docs/05 "What follows from this":
// client knowledge lives only at the edges; the middle is generic).
//
// WHAT IT DOES. It takes a COMPONENT REQUEST (what component to build — name, host element,
// the canonical base class, prop-driven variants, fixed decorations, and the source classes
// the wrapper may emit) and the normalized DESCRIPTION, and produces a normalized RESULT of
// result-kind `frontend-component`. The request is DATA (a component name, a host element,
// and class names are component facts the caller supplies, not a client identity); the
// description is the client's data, delivered already normalized by the adapter. Compose
// carries no client name, no file path, no token literal of its own.
//
// THE DS-COMPLIANCE CHECK (why this is composition, not just a passthrough). A request may
// declare that a variant BINDS a semantic ROLE of the design system (e.g. an "accent" variant
// binds the `color.semantic.accent` role). Compose VALIDATES every declared role binding
// against the roles the normalized description actually carries — a component that binds a
// role the client's DS does not define FAILS LOUD here, before any artifact is produced
// (validate before acting). That cross-check is the "compliant with the client's design
// system" guarantee made mechanical: the component is provably expressed in terms the DS
// defines, not invented. Variants without a role binding are pure structural class toggles and
// need no DS role (e.g. a size modifier).
//
// WHAT IT DOES NOT DO. It does not render (that is the output adapter). It does not reach back
// to the source (it works only on the normalized description it was handed). It does not embed
// craft/CSS values — the wrapper emits canonical CLASS NAMES; the craft stays in the client's
// source stylesheet (the "code as source of truth" path).

import { ComposeError } from "./errors.js";

/** The result-kind this skill emits (docs/04 §"Skill↔adapter typing"). */
export const RESULT_KIND = "frontend-component";

/** The source-kind this skill consumes. */
export const SOURCE_KIND = "design-system";

const PASCAL_RE = /^[A-Z][A-Za-z0-9]*$/;
const HTML_NAME_RE = /^[a-z][a-z0-9-]*$/;

/**
 * Build the set of role names the normalized design-system description defines. The adapter
 * returns roles as { name, type, alias }; the name is the semantic role (e.g.
 * "color.semantic.accent"). Compose checks declared variant role-bindings against this set.
 */
function rolesOf(description) {
  const roles = description?.payload?.roles;
  if (!Array.isArray(roles)) return new Set();
  return new Set(roles.map((r) => r?.name).filter((n) => typeof n === "string"));
}

/**
 * Compose a `frontend-component` spec from a component request + a normalized design-system
 * description. Returns the SPEC the output adapter consumes (the same shape the React adapter
 * documents) — the run hands this spec to the output adapter's result-builder, keeping the
 * skill core free of any output-stack knowledge.
 *
 * @param {object} args
 * @param {object} args.request  the component request (DATA — names no client):
 *   { componentName, element, baseClass, variants?: [{prop,value,class,role?}],
 *     decorations?: [{element,class,ariaHidden?}], sourceClasses: string[] }
 * @param {object} args.description  the normalized design-system description (source-kind
 *   `design-system`) from the input adapter.
 * @returns {object} a `frontend-component` spec (the output adapter renders it).
 * @throws {ComposeError} on a malformed request or a DS-compliance violation.
 */
export function composeComponent({ request, description } = {}) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new ComposeError("create-component request must be an object describing the component");
  }
  if (!description || typeof description !== "object") {
    throw new ComposeError("create-component compose needs a normalized design-system description");
  }
  if (description.envelope?.kind !== SOURCE_KIND) {
    throw new ComposeError(
      `create-component consumes a "${SOURCE_KIND}" description, got "${description.envelope?.kind}"`,
    );
  }

  const { componentName, element, baseClass, variants = [], decorations = [], sourceClasses } = request;

  if (!PASCAL_RE.test(componentName ?? "")) {
    throw new ComposeError(`request.componentName must be PascalCase, got ${JSON.stringify(componentName)}`);
  }
  if (!HTML_NAME_RE.test(element ?? "")) {
    throw new ComposeError(`request.element must be an HTML tag name, got ${JSON.stringify(element)}`);
  }
  if (typeof baseClass !== "string" || baseClass.length === 0) {
    throw new ComposeError("request.baseClass must be a non-empty canonical class name");
  }
  if (!Array.isArray(sourceClasses) || sourceClasses.length === 0) {
    throw new ComposeError(
      "request.sourceClasses must be a non-empty array (the canonical DS classes the wrapper may emit)",
    );
  }
  if (!Array.isArray(variants)) throw new ComposeError("request.variants must be an array");
  if (!Array.isArray(decorations)) throw new ComposeError("request.decorations must be an array");

  // DS-compliance: every variant role binding must exist in the client's design system.
  const dsRoles = rolesOf(description);
  const cleanVariants = [];
  for (const v of variants) {
    if (!v || typeof v !== "object") throw new ComposeError("each variant must be an object");
    if (typeof v.prop !== "string" || v.prop.length === 0) throw new ComposeError("variant.prop must be a non-empty string");
    if (typeof v.value !== "string" || v.value.length === 0) throw new ComposeError("variant.value must be a non-empty string");
    if (typeof v.class !== "string" || v.class.length === 0) throw new ComposeError("variant.class must be a non-empty string");
    if (v.role !== undefined) {
      if (typeof v.role !== "string" || !dsRoles.has(v.role)) {
        throw new ComposeError(
          `variant "${v.prop}=${v.value}" binds role "${v.role}", which the client's design system does not define ` +
            `(known roles: ${[...dsRoles].sort().join(", ") || "none"}) — component not DS-compliant`,
        );
      }
    }
    // The role binding is a compliance fact, not part of the rendered spec; the output adapter
    // renders class toggles. Carry only the render-relevant fields forward.
    cleanVariants.push({ prop: v.prop, value: v.value, class: v.class });
  }

  // The spec the output adapter consumes. Every emittable class must be declared in
  // sourceClasses (the adapter re-checks this; we surface it here too, before handing off).
  const declared = new Set(sourceClasses);
  if (!declared.has(baseClass)) {
    throw new ComposeError(`baseClass "${baseClass}" is not declared in request.sourceClasses`);
  }
  for (const v of cleanVariants) {
    if (!declared.has(v.class)) {
      throw new ComposeError(`variant class "${v.class}" is not declared in request.sourceClasses`);
    }
  }
  for (const d of decorations) {
    if (!d || typeof d !== "object") throw new ComposeError("each decoration must be an object");
    if (!HTML_NAME_RE.test(d.element ?? "")) throw new ComposeError("decoration.element must be an HTML tag name");
    if (typeof d.class !== "string" || !declared.has(d.class)) {
      throw new ComposeError(`decoration class "${JSON.stringify(d.class)}" is not declared in request.sourceClasses`);
    }
  }

  return {
    componentName,
    element,
    baseClass,
    variants: cleanVariants,
    decorations: decorations.map((d) => ({ element: d.element, class: d.class, ariaHidden: !!d.ariaHidden })),
    sourceClasses: [...sourceClasses],
  };
}
