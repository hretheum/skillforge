// codex-flavour — the OPT-IN Codex/OpenAI emit profile. The second harness adapter,
// proving the cross-harness contract (src/emit/adapter.js) carries more than one target.
//
// Sources: the public Agent Skills open standard (agentskills.io/specification) and the public
// OpenAI function-calling format (platform.openai.com/docs — a `functions`/`tools` array whose
// entries carry `name`, `description`, and a JSON-Schema `parameters`). The projection design is
// original to this project. Zero files from any third-party skills-factory codebase (clean-room).
//
// WHAT THIS IS. A harness adapter, the same swappable-edge shape as the Claude flavour: it
// PROJECTS the open core (a portable SKILL.md + the registry entry) onto a Codex/OpenAI runtime's
// native surface — the function-calling tool descriptor — ADDING Codex-specific capability:
//
//   - a function/tool descriptor      — `{ name, description, parameters }` in OpenAI's
//                                       function-calling shape, the explicit way an OpenAI-
//                                       compatible agent (Codex) is offered the skill as a tool;
//   - tool-allowlist provenance       — registry requiredTools recorded on the descriptor so the
//                                       host can pre-approve them (advisory, like Claude's
//                                       allowed-tools — not a boundary);
//   - skillforge provenance frontmatter — metadata.skillforge.emitProfile = "codex" (+ version),
//                                       mirroring the Claude flavour's additive metadata.
//
// THE INVARIANT (shared with every adapter). Purely additive and reversible:
//   1. ADD, NEVER REPLACE — apply() only INSERTS fenced additive frontmatter and emits a
//      companion descriptor; it never edits/removes an open-core field or the body.
//   2. REVERSIBLE — strip(apply(x).skillMd) === x byte-for-byte (the portability proof).
//   3. NEVER REQUIRED — the descriptor only adds capability when the runtime is Codex/OpenAI; a
//      skill authored to the open core runs UNCHANGED elsewhere.
//
// Generic by construction: this file names no client. Every projected value comes from the open
// SKILL.md + the registry entry — both DATA — never from anything hardcoded here.

import { splitFrontmatter, topLevelKeys, metadataKeys } from "./skill-frontmatter.js";

/** The Codex/OpenAI emit-profile name (this adapter's dispatch key). */
export const CODEX_PROFILE = "codex";

/** Marker comments fencing the additive frontmatter block so it is reversible/auditable. */
const FLAVOUR_BEGIN = "# --- skillforge:codex-flavour (additive; safe to remove) ---";
const FLAVOUR_END = "# --- end skillforge:codex-flavour ---";

function assert(cond, msg) {
  if (!cond) throw new TypeError(msg);
}

/**
 * The additive frontmatter lines the Codex flavour contributes, derived ENTIRELY from the
 * registry entry — provenance only, never inventing capability the open core did not declare.
 *
 * @param {object} registryEntry
 * @param {{present:boolean,childKeys:Set<string>}} meta
 * @returns {string[]} additive frontmatter lines (no fences; caller fences them).
 */
function codexFrontmatterAdditions(registryEntry, meta) {
  const lines = [];
  const metaChildren = [];
  const wantChild = (k, v) => {
    if (v == null) return;
    if (!meta.childKeys.has(k)) metaChildren.push(`  skillforge.${k}: ${v}`);
  };
  wantChild("emitProfile", CODEX_PROFILE);
  if (registryEntry.version) wantChild("registryVersion", registryEntry.version);
  if (metaChildren.length > 0) {
    if (!meta.present) lines.push("metadata:");
    lines.push(...metaChildren);
  }
  return lines;
}

/**
 * Build the OpenAI/Codex function-calling descriptor companion — the harness-native surface that
 * offers the skill as a callable tool. Shape: a `tools` array of `{ type:"function", function:{
 * name, description, parameters } }` entries, the format an OpenAI-compatible agent (Codex)
 * consumes. `parameters` is a JSON Schema; the open core declares no structured arguments, so we
 * emit a permissive object schema (the minimal valid descriptor). requiredTools, when present,
 * are recorded as advisory pre-approval metadata.
 *
 * @param {string} name
 * @param {string} description
 * @param {object} registryEntry
 * @returns {{ path: string, content: string }}
 */
function functionDescriptorArtifact(name, description, registryEntry) {
  const fn = {
    name,
    description,
    parameters: {
      type: "object",
      properties: {
        request: {
          type: "string",
          description: `The current request to run the "${name}" skill for.`,
        },
      },
      required: ["request"],
      additionalProperties: false,
    },
  };
  const descriptor = {
    tools: [{ type: "function", function: fn }],
  };
  if (Array.isArray(registryEntry.requiredTools) && registryEntry.requiredTools.length > 0) {
    // Advisory pre-approval (mirrors Claude's allowed-tools): NOT a boundary, just a hint to the
    // host of which tools the skill expects to use.
    descriptor.x_skillforge = { requiredTools: [...registryEntry.requiredTools] };
  }
  return {
    path: `codex/${name}.function.json`,
    content: JSON.stringify(descriptor, null, 2) + "\n",
  };
}

/**
 * Apply the Codex flavour to one skill's open-core SKILL.md text.
 *
 * @param {object} args
 * @param {string} args.skillText  the open-core SKILL.md source (authoritative input).
 * @param {object} args.registryEntry  the skill's registry entry (governance data).
 * @param {string} [args.name]  the skill's name; defaults to the registry/frontmatter name.
 * @returns {{ skillMd: string, companions: Array<{path:string,content:string}>, additions: string[] }}
 */
export function applyCodexFlavour({ skillText, registryEntry, name }) {
  assert(typeof skillText === "string" && skillText.length > 0, "skillText must be a non-empty string");
  assert(registryEntry && typeof registryEntry === "object", "registryEntry must be an object");

  const split = splitFrontmatter(skillText);
  assert(split, "SKILL.md does not open with a `---` frontmatter block (malformed open core)");

  const nameMatch = split.frontmatter.match(/^name:\s*(.+)$/m);
  const skillName = name || (nameMatch ? nameMatch[1].trim() : registryEntry.name);
  assert(skillName, "cannot determine skill name (no `name` in frontmatter, none passed)");

  const meta = metadataKeys(split.frontmatter);
  // topLevelKeys is read to honor the ADD-never-replace contract symmetrically with the Claude
  // flavour; the Codex flavour adds no top-level fields, only metadata children, so it is a guard
  // against a future top-level addition silently clobbering an open-core field.
  topLevelKeys(split.frontmatter);
  const additions = codexFrontmatterAdditions(registryEntry, meta);

  let skillMd = skillText;
  if (additions.length > 0) {
    const lines = skillText.split("\n");
    const fenced = [FLAVOUR_BEGIN, ...additions, FLAVOUR_END];
    lines.splice(split.endLine, 0, ...fenced); // insert before the closing fence line
    skillMd = lines.join("\n");
  }

  const descMatch = split.frontmatter.match(/description:\s*([\s\S]*?)(?:\n[A-Za-z0-9_.-]+:|$)/);
  // Strip YAML block/fold scalar markers (>-, >, |->, |, >+, |+) that appear when the frontmatter
  // uses a block scalar form: `description: >-\n  actual text`. Without stripping, the marker
  // leaks verbatim into the function descriptor.
  // Match only marker-then-newline (^[>|][+-]?\n) — not \s* — so a description that starts with
  // "> " as literal text (not a block scalar) is left untouched.
  const rawDesc = descMatch ? descMatch[1].trim() : "";
  const description = (rawDesc.replace(/^[>|][+\-]?\n/, "").replace(/\s+/g, " ").trim()) || skillName;

  const companions = [functionDescriptorArtifact(skillName, description, registryEntry)];

  return { skillMd, companions, additions };
}

/**
 * Reverse the flavour: strip the fenced additive block, recovering the open-core SKILL.md.
 * @param {string} skillMd
 * @returns {string}
 */
export function stripCodexFlavour(skillMd) {
  const lines = skillMd.split("\n");
  const begin = lines.indexOf(FLAVOUR_BEGIN);
  if (begin === -1) return skillMd;
  let end = -1;
  for (let i = begin + 1; i < lines.length; i++) {
    if (lines[i] === FLAVOUR_END) {
      end = i;
      break;
    }
  }
  if (end === -1) return skillMd;
  lines.splice(begin, end - begin + 1);
  return lines.join("\n");
}

/**
 * The Codex flavour as a harness adapter conforming to the shared contract (src/emit/adapter.js).
 * @type {{ profile: string, apply: typeof applyCodexFlavour, strip: typeof stripCodexFlavour }}
 */
export const codexAdapter = Object.freeze({
  profile: CODEX_PROFILE,
  apply: applyCodexFlavour,
  strip: stripCodexFlavour,
});
