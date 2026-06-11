// emit — the export layer: project an open-core skill onto a target runtime via a chosen
// EMIT PROFILE (docs/12 §"Claude flavour — an optional emit-adapter", docs/05 §"Open core vs
// the optional Claude flavour").
//
// Sources: concept + first principles + the public Agent Skills / Claude Code docs cited in
// claude-flavour.js. Zero files from any third-party skills-factory codebase (clean-room).
//
// THE SHAPE. This is a swappable edge with a generic interior, like the adapter dispatch
// (src/adapters/index.js): a name → emit-profile map, resolved at export time. Three profiles:
//
//   - "open-core" (DEFAULT): a NO-OP. Returns the SKILL.md byte-identical and no companions.
//     This is the portability guarantee — a skill authored to the open core runs UNCHANGED on
//     any skills-compatible (non-Claude) runtime; emit never touches it.
//   - "claude" (OPT-IN): the additive Claude flavour (slash-command, file-path gating, runtime
//     context injection, model/effort, hardened-tier managed rules), projected from the
//     registry. Purely additive; the open core is recoverable byte-for-byte.
//   - "codex" (OPT-IN): the additive Codex/OpenAI flavour — emits an OpenAI function-calling
//     descriptor companion alongside the open-core SKILL.md. Also purely additive.
//
// Opt-in / default-off lives HERE: emit() defaults to "open-core", so the flavour is applied
// only when a caller explicitly asks for it. The open-core path imports nothing harness-specific
// at run time beyond the no-op identity.
//
// Generic by construction: this file names no client and no skill. It maps profile NAMES to
// behavior; all client/skill specifics arrive as DATA (the SKILL.md text + registry entry).

import { EMIT_PROFILES, applyClaudeFlavour, stripClaudeFlavour, claudeAdapter } from "./claude-flavour.js";
import { CODEX_PROFILE, applyCodexFlavour, stripCodexFlavour, codexAdapter } from "./codex-flavour.js";
import { validateAdapter, assertAdapter, ADAPTER_INTERFACE, ADAPTER_REQUIRED_FIELDS } from "./adapter.js";

export { EMIT_PROFILES, applyClaudeFlavour, stripClaudeFlavour, claudeAdapter };
export { CODEX_PROFILE, applyCodexFlavour, stripCodexFlavour, codexAdapter };
export { validateAdapter, assertAdapter, ADAPTER_INTERFACE, ADAPTER_REQUIRED_FIELDS };
export { splitFrontmatter, topLevelKeys, metadataKeys } from "./skill-frontmatter.js";

/**
 * The open-core profile: a strict no-op. Returns the SKILL.md unchanged and no companions.
 * This IS the portability promise made executable — emitting under the open core can never
 * alter a skill.
 *
 * @param {{ skillText: string }} args
 * @returns {{ profile: string, skillMd: string, companions: [] }}
 */
function emitOpenCore({ skillText }) {
  if (typeof skillText !== "string" || skillText.length === 0) {
    throw new TypeError("skillText must be a non-empty string");
  }
  return { profile: EMIT_PROFILES.OPEN_CORE, skillMd: skillText, companions: [] };
}

/**
 * The claude profile: the additive flavour projected from the registry entry.
 *
 * @param {{ skillText: string, registryEntry: object, name?: string }} args
 * @returns {{ profile: string, skillMd: string, companions: Array, additions: string[] }}
 */
function emitClaude({ skillText, registryEntry, name }) {
  const { skillMd, companions, additions } = applyClaudeFlavour({ skillText, registryEntry, name });
  return { profile: EMIT_PROFILES.CLAUDE, skillMd, companions, additions };
}

/**
 * The codex profile: the additive Codex/OpenAI flavour projected from the registry entry. Same
 * shape as the claude path — a second harness, dispatched the same way.
 *
 * @param {{ skillText: string, registryEntry: object, name?: string }} args
 * @returns {{ profile: string, skillMd: string, companions: Array, additions: string[] }}
 */
function emitCodex({ skillText, registryEntry, name }) {
  const { skillMd, companions, additions } = applyCodexFlavour({ skillText, registryEntry, name });
  return { profile: CODEX_PROFILE, skillMd, companions, additions };
}

// The harness adapters this layer ships, each validated against the shared contract at load time
// so a malformed adapter can never enter the dispatch table (validate before acting). The
// open-core profile is the no-op identity, not a harness adapter, so it is not in this set.
const HARNESS_ADAPTERS = [
  assertAdapter(claudeAdapter, "claude-flavour"),
  assertAdapter(codexAdapter, "codex-flavour"),
];

/** Profiles that require a registryEntry (the harness flavours; open-core does not). */
const REGISTRY_REQUIRED = new Set(HARNESS_ADAPTERS.map((a) => a.profile));

/** The profile dispatch table (profile name → emit function). */
const PROFILES = Object.freeze({
  [EMIT_PROFILES.OPEN_CORE]: emitOpenCore,
  [EMIT_PROFILES.CLAUDE]: emitClaude,
  [CODEX_PROFILE]: emitCodex,
});

/** The registered emit-profile names, sorted (stable order). */
export function emitProfileNames() {
  return Object.keys(PROFILES).sort();
}

/**
 * Emit a skill under a chosen profile. DEFAULTS to "open-core" (opt-in flavour, default off).
 *
 * @param {object} args
 * @param {string} args.skillText  the open-core SKILL.md source (authoritative).
 * @param {string} [args.profile]  the emit profile; defaults to "open-core".
 * @param {object} [args.registryEntry]  required by the harness flavours; ignored by open-core.
 * @param {string} [args.name]  optional explicit skill name.
 * @returns {{ profile: string, skillMd: string, companions: Array, additions?: string[] }}
 * @throws {Error} loud and early on an unknown profile (validate before acting).
 */
export function emit({ skillText, profile = EMIT_PROFILES.OPEN_CORE, registryEntry, name } = {}) {
  const fn = PROFILES[profile];
  if (!fn) {
    throw new Error(
      `unknown emit profile "${profile}" (known: ${emitProfileNames().join(", ")})`,
    );
  }
  if (REGISTRY_REQUIRED.has(profile) && (!registryEntry || typeof registryEntry !== "object")) {
    throw new Error(`emit profile "${profile}" requires a registryEntry`);
  }
  return fn({ skillText, registryEntry, name });
}
