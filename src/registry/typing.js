// Skill↔adapter result-kind typing — the start-up wiring check (docs/04 §"Skill↔adapter
// typing", docs/04a §"Output edge — the normalized result (a tagged union)", docs/12
// §requiredAdapters).
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room).
//
// THE RULE. A skill declares the result-kind it EMITS and the source-kind it CONSUMES. An
// output adapter declares the result-kinds it ACCEPTS; an input adapter the source-kinds it
// PRODUCES. The wiring is valid iff, for the adapters the skill is wired to:
//
//   * the skill's emitted result-kind is accepted by every selected OUTPUT adapter, and
//   * the skill's consumed source-kind is produced by every selected INPUT adapter.
//
// The check reads only the `kind` TAGS (from the registry entry + the engine's kinds
// catalog) — it never parses a payload, so the core stays generic (docs/04a §"the check
// reads only the envelope's kind"). A mistyped pairing therefore fails at START-UP — caught
// by the loader (T-MVP-11) and by registry-lint (T-MVP-09) — instead of producing a
// malformed artifact at the very end.
//
// This module is a pure primitive: it returns violations (or throws on the assert wrapper)
// given data. Both consumers — the engine-side registry-lint gate and the runtime loader —
// call THIS, so "valid wiring" has exactly one definition (no two implementations to drift).

/**
 * Check the skill↔adapter typing for one skill entry against the engine's kinds catalog.
 *
 * @param {object} args
 * @param {string} args.skillName  the skill's registry key (for messages).
 * @param {string|null|undefined} args.sourceKind  the source-kind the skill consumes.
 * @param {string|null|undefined} args.resultKind  the result-kind the skill emits.
 * @param {string[]} args.inputAdapters  the input adapters the skill is wired to (requiredAdapters.input).
 * @param {string[]} args.outputAdapters the output adapters the skill is wired to (requiredAdapters.output).
 * @param {{ produces:(n:string)=>string[], accepts:(n:string)=>string[], has:(e:string,n:string)=>boolean }} args.kinds
 *        the engine's adapter-kinds catalog (defaultAdapterKinds()).
 * @returns {string[]} violation messages; empty means the wiring type-checks.
 */
export function checkSkillAdapterTyping({
  skillName = "<skill>",
  sourceKind,
  resultKind,
  inputAdapters = [],
  outputAdapters = [],
  kinds,
}) {
  const violations = [];

  // A skill that declares a kind but is wired to no adapter for that edge cannot satisfy the
  // pairing — the result/ source would have nowhere to go / come from. A skill that declares
  // NO kind for an edge it does not use is fine (e.g. a skill with no input). We treat a
  // declared kind as a requirement that at least one adapter on that edge speak it.

  // --- output edge: emitted result-kind ∈ each output adapter's accepted kinds ----------
  if (resultKind != null && resultKind !== "") {
    if (outputAdapters.length === 0) {
      violations.push(
        `${skillName}: emits result-kind "${resultKind}" but is wired to no output adapter`,
      );
    }
    for (const name of outputAdapters) {
      if (!kinds.has("output", name)) {
        // Existence is registry-lint's adapter check; here we only report that we cannot
        // type-check an adapter whose kinds are unknown, so the typing result is honest.
        violations.push(
          `${skillName}: output adapter "${name}" declares no kinds in the engine catalog (cannot type-check)`,
        );
        continue;
      }
      const accepted = kinds.accepts(name);
      if (!accepted.includes(resultKind)) {
        violations.push(
          `${skillName}: result-kind "${resultKind}" is not accepted by output adapter "${name}" ` +
            `(accepts: ${accepted.join(", ") || "none"})`,
        );
      }
    }
  }

  // --- input edge: consumed source-kind ∈ each input adapter's produced kinds ------------
  if (sourceKind != null && sourceKind !== "") {
    if (inputAdapters.length === 0) {
      violations.push(
        `${skillName}: consumes source-kind "${sourceKind}" but is wired to no input adapter`,
      );
    }
    for (const name of inputAdapters) {
      if (!kinds.has("input", name)) {
        violations.push(
          `${skillName}: input adapter "${name}" declares no kinds in the engine catalog (cannot type-check)`,
        );
        continue;
      }
      const produced = kinds.produces(name);
      if (!produced.includes(sourceKind)) {
        violations.push(
          `${skillName}: source-kind "${sourceKind}" is not produced by input adapter "${name}" ` +
            `(produces: ${produced.join(", ") || "none"})`,
        );
      }
    }
  }

  return violations;
}

/**
 * Read a skill's typing facts straight off its registry entry. Centralized so the loader and
 * registry-lint pull the same fields the same way.
 *
 * @param {object} entry  a `skills.<name>` registry entry.
 * @returns {{ sourceKind: string|null, resultKind: string|null, inputAdapters: string[], outputAdapters: string[] }}
 */
export function typingFactsFromEntry(entry) {
  const ra = entry?.requiredAdapters ?? {};
  return {
    sourceKind: typeof entry?.sourceKind === "string" ? entry.sourceKind : null,
    resultKind: typeof entry?.resultKind === "string" ? entry.resultKind : null,
    inputAdapters: Array.isArray(ra.input) ? ra.input : [],
    outputAdapters: Array.isArray(ra.output) ? ra.output : [],
  };
}

/**
 * Validate a skill↔kind contract: check that the skill entry's wiring is compatible
 * with the descriptor's inputSource contract.
 *
 * The descriptor's `compose.inputSource` declares WHERE a skill's compose step gets its
 * material from: `"adapter"` (it reads a normalized DESCRIPTION through an input adapter — the
 * artifact family) or `"references"` (it reads client resources directly — the instruction
 * family, which has no adapters and no tool gate). This primitive enforces that the registry
 * ENTRY matches that contract, so a mis-categorized skill (an instruction skill that wrongly
 * declares adapters, or an artifact skill that mis-types its adapter pairing) fails at start-up,
 * not at the end with a malformed result. For the adapter family it reuses the SAME
 * adapter-typing primitive activation + registry-lint use, so "valid wiring" stays defined once.
 *
 * @param {{ entry: object, descriptor: object, kinds: object }} args
 * @returns {string[]} violations (empty = ok)
 */
export function validateKindContract({ entry, descriptor, kinds }) {
  const { inputSource } = descriptor.compose;
  if (inputSource === "adapter") {
    const facts = typingFactsFromEntry(entry);
    return checkSkillAdapterTyping({ ...facts, kinds });
  }
  if (inputSource === "references") {
    const violations = [];
    if ((entry.requiredAdapters?.input ?? []).length > 0) {
      violations.push("references-kind skill must not declare input adapters");
    }
    if ((entry.requiredAdapters?.output ?? []).length > 0) {
      violations.push("references-kind skill must not declare output adapters");
    }
    return violations;
  }
  return [`unknown inputSource "${inputSource}"`];
}

/**
 * Assert the typing for one skill entry; throws on the first violation. The loader uses this
 * at the typing link of the activation chain (validate before acting → fail loud at start-up,
 * never a malformed artifact at the end).
 *
 * @param {object} args
 * @param {string} args.skillName
 * @param {object} args.entry  the registry entry.
 * @param {object} args.kinds  the engine's adapter-kinds catalog.
 * @throws {Error} a typing error naming the mismatch.
 */
export function assertSkillAdapterTyping({ skillName, entry, kinds }) {
  const facts = typingFactsFromEntry(entry);
  const violations = checkSkillAdapterTyping({ skillName, kinds, ...facts });
  if (violations.length > 0) {
    const err = new Error(
      `skill↔adapter typing failed for "${skillName}":\n  - ${violations.join("\n  - ")}`,
    );
    err.violations = violations;
    throw err;
  }
}
