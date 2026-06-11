// claude-flavour — the OPT-IN Claude emit profile (T-P4-06; docs/05 §"Open core vs the
// optional Claude flavour", docs/12 §"Claude flavour — an optional emit-adapter", docs/13
// §"Hardened tier").
//
// Sources: the public Agent Skills open standard (agentskills.io/specification) and public
// Claude Code documentation (code.claude.com/docs/en/skills, /permissions). The projection
// design is original to this project. Zero files from any third-party skills-factory codebase
// (clean-room).
//
// WHAT THIS IS. An emit-adapter — a swappable edge with a generic interior, the same shape the
// rest of the spec uses (docs/04 adapters, docs/11 secrets, docs/12). It PROJECTS the open core
// (a portable SKILL.md + the JSON registry entry) onto Claude Code's native surfaces, ADDING
// Claude-specific capability:
//
//   - slash-command invocation        — an explicit `/name` command that fires the skill
//                                        (docs/05 §"Where commands live in the standard");
//   - file-path gating                 — Claude's `allowed-tools` + permission Read/Edit rules
//                                        narrowed to the skill's declared paths (docs/13);
//   - runtime context injection        — a directive to run a shell command and inline its
//                                        output before the agent reads the skill (docs/05);
//   - model/effort frontmatter         — registry model/effort projected as Claude fields
//                                        (docs/12 OD-6);
//   - the hardened-tier managed rules  — registry scope/enabled/requiredTools → managed
//                                        deny/allow/Skill(...) (docs/13 §"Hardened tier").
//
// THE INVARIANT THIS LAYER PROMISES (the acceptance for T-P4-06). The flavour is **purely
// additive and opt-in**:
//   1. DEFAULT OFF. With the `open-core` profile (or no profile), emit returns the SKILL.md
//      text BYTE-IDENTICAL to the input — a no-op. A skill authored to the open core therefore
//      runs UNCHANGED on a non-Claude agent.
//   2. ADD, NEVER REPLACE. The `claude` profile only INSERTS additive frontmatter lines and
//      produces COMPANION artifacts; it never edits or removes an open-core field or the body.
//      Stripping the additive lines yields the original SKILL.md byte-for-byte (the portability
//      proof in test/emit-claude-flavour.test.js).
//   3. NEVER REQUIRED. None of the projected surfaces are needed to run the skill; they only
//      add capability when the target runtime is Claude. The open layers stay authoritative;
//      this projection derives from them and is never the source of truth (docs/12).
//
// Generic by construction: this file names no client. Every value it projects comes from the
// open SKILL.md + the registry entry passed in — both DATA — never from anything hardcoded here.

import { splitFrontmatter, topLevelKeys, metadataKeys } from "./skill-frontmatter.js";

/** The profile names this layer understands (the emit-profile catalog). */
export const EMIT_PROFILES = Object.freeze({
  /** Open core: portable SKILL.md, no Claude additions. The DEFAULT. */
  OPEN_CORE: "open-core",
  /** The opt-in Claude flavour: additive surfaces projected from the registry. */
  CLAUDE: "claude",
});

/** A marker comment that fences the additive frontmatter block so it is reversible/auditable. */
const FLAVOUR_BEGIN = "# --- skillforge:claude-flavour (additive; safe to remove) ---";
const FLAVOUR_END = "# --- end skillforge:claude-flavour ---";

function assert(cond, msg) {
  if (!cond) throw new TypeError(msg);
}

/**
 * Build the additive frontmatter lines the Claude flavour contributes, derived ENTIRELY from
 * the registry entry. Each line is conditional on the registry actually carrying that datum, so
 * the projection never invents capability the open core did not declare.
 *
 * @param {object} registryEntry  the skill's `skillforge.registry.json` entry.
 * @param {Set<string>} existingTop  top-level keys already in the open-core frontmatter.
 * @param {{present:boolean,childKeys:Set<string>}} meta  the open-core metadata block state.
 * @returns {string[]} additive frontmatter lines (no fences; caller fences them).
 */
function claudeFrontmatterAdditions(registryEntry, existingTop, meta) {
  const lines = [];

  // model / effort (docs/12 OD-6) — projected only when the registry sets a concrete value and
  // the open core did not already declare the field (ADD, never replace).
  if (
    registryEntry.model &&
    registryEntry.model !== "inherit" &&
    !existingTop.has("model")
  ) {
    lines.push(`model: ${registryEntry.model}`);
  }
  if (registryEntry.effort && !existingTop.has("effort")) {
    lines.push(`effort: ${registryEntry.effort}`);
  }

  // file-path gating + tool pre-approval (docs/13). `allowed-tools` is ADVISORY pre-approval,
  // not a boundary (OD-3) — the enforced boundary is the managed rules below + the resolver.
  if (Array.isArray(registryEntry.requiredTools) && registryEntry.requiredTools.length > 0) {
    if (!existingTop.has("allowed-tools")) {
      lines.push(`allowed-tools: ${registryEntry.requiredTools.join(" ")}`);
    }
  }

  // skillforge provenance under metadata.skillforge.* (doc 12 §"How skillforge uses the open
  // fields"). We only emit children that are not already declared; if there is no metadata
  // block at all we open one.
  const metaChildren = [];
  const wantChild = (k, v) => {
    if (v == null) return;
    if (!meta.childKeys.has(k)) metaChildren.push(`  skillforge.${k}: ${v}`);
  };
  wantChild("emitProfile", EMIT_PROFILES.CLAUDE);
  if (registryEntry.version) wantChild("registryVersion", registryEntry.version);
  if (metaChildren.length > 0) {
    if (!meta.present) lines.push("metadata:");
    lines.push(...metaChildren);
  }

  return lines;
}

/**
 * Build the slash-command companion artifact (docs/05 §"Where commands live in the standard").
 * An explicit `/name` command that fires the skill — a Claude convenience, NOT part of the
 * portable format, so it lives as a separate file the flavour emits alongside the skill.
 *
 * @param {string} name  the skill's open `name`.
 * @param {string} description  the skill's open `description` (first sentence used as summary).
 * @returns {{ path: string, content: string }}
 */
function slashCommandArtifact(name, description) {
  const summary = String(description).split(/(?<=\.)\s/)[0].trim();
  const content = [
    "---",
    `description: ${summary}`,
    `# Fires the open-core skill "${name}" explicitly (docs/05 §command).`,
    "---",
    "",
    `Run the **${name}** skill now for the current request.`,
    "",
  ].join("\n");
  return { path: `commands/${name}.md`, content };
}

/**
 * Build a runtime-context-injection directive (docs/05 §"runtime context injection"): a small
 * JSON descriptor telling the Claude runtime to run a shell command and inline its output
 * before the agent reads the skill. Emitted ONLY when the registry declares one
 * (`metadata.skillforge.contextInjection` shape carried on the registry entry); otherwise the
 * flavour adds nothing here, keeping the projection faithful to declared capability.
 *
 * @param {object} registryEntry
 * @returns {{ path: string, content: string } | null}
 */
function contextInjectionArtifact(name, registryEntry) {
  const inj = registryEntry.contextInjection;
  if (!inj || typeof inj.command !== "string" || inj.command.length === 0) return null;
  const descriptor = {
    skill: name,
    runBeforeSkill: inj.command,
    inlineAs: inj.inlineAs || "context",
  };
  return {
    path: `context/${name}.inject.json`,
    content: JSON.stringify(descriptor, null, 2) + "\n",
  };
}

/**
 * The hardened-tier managed-permission projection (docs/13 §"Hardened tier"). Registry
 * scope/enabled/requiredTools → Claude managed deny/allow/Skill(...) rules — the layer "user,
 * project, and even CLI args cannot override". This is the BONUS that makes the boundary
 * unbypassable; it is data, derived from the registry, never authoritative on its own.
 *
 * @param {string} name
 * @param {object} registryEntry
 * @returns {{ path: string, content: string }}
 */
function managedSettingsArtifact(name, registryEntry) {
  const allow = [];
  const deny = [];
  // enabled:false → a hard Skill deny (doc 12: "a Skill(<name>) deny rule").
  if (registryEntry.enabled === false) {
    deny.push(`Skill(${name})`);
  } else {
    // scope → Skill(<name> *) allow projection (doc 12).
    allow.push(`Skill(${name})`);
  }
  // requiredTools → managed allow pre-approval that the resolver still clamps (doc 13 Layer 4).
  if (Array.isArray(registryEntry.requiredTools)) {
    for (const t of registryEntry.requiredTools) allow.push(t);
  }
  const settings = {
    // The shape Claude managed settings expect (docs/13 §hardened tier); deny-first.
    permissions: { allow, ask: [], deny },
  };
  return {
    path: `managed/${name}.settings.json`,
    content: JSON.stringify(settings, null, 2) + "\n",
  };
}

/**
 * Apply the Claude flavour to one skill's open-core SKILL.md text.
 *
 * @param {object} args
 * @param {string} args.skillText  the open-core SKILL.md source (authoritative input).
 * @param {object} args.registryEntry  the skill's registry entry (governance data).
 * @param {string} [args.name]  the skill's name; defaults to the registry/frontmatter name.
 * @returns {{ skillMd: string, companions: Array<{path:string,content:string}>, additions: string[] }}
 *   `skillMd` is the augmented SKILL.md (open core + fenced additive frontmatter); `companions`
 *   are the separate Claude-native files; `additions` are the additive lines (for the proof).
 */
export function applyClaudeFlavour({ skillText, registryEntry, name }) {
  assert(typeof skillText === "string" && skillText.length > 0, "skillText must be a non-empty string");
  assert(registryEntry && typeof registryEntry === "object", "registryEntry must be an object");

  const split = splitFrontmatter(skillText);
  assert(split, "SKILL.md does not open with a `---` frontmatter block (malformed open core)");

  // Resolve the skill name from the open frontmatter when not given.
  const nameMatch = split.frontmatter.match(/^name:\s*(.+)$/m);
  const skillName = name || (nameMatch ? nameMatch[1].trim() : registryEntry.name);
  assert(skillName, "cannot determine skill name (no `name` in frontmatter, none passed)");

  const existingTop = topLevelKeys(split.frontmatter);
  const meta = metadataKeys(split.frontmatter);
  const additions = claudeFrontmatterAdditions(registryEntry, existingTop, meta);

  // Build the augmented SKILL.md by INSERTING the fenced additive block just before the closing
  // `---` fence. We rebuild from the original line array so every open-core byte is preserved.
  let skillMd = skillText;
  if (additions.length > 0) {
    const lines = skillText.split("\n");
    const fenced = [FLAVOUR_BEGIN, ...additions, FLAVOUR_END];
    lines.splice(split.endLine, 0, ...fenced); // insert before the closing fence line
    skillMd = lines.join("\n");
  }

  const companions = [];
  const descMatch = split.frontmatter.match(/description:\s*([\s\S]*?)(?:\n[A-Za-z0-9_.-]+:|$)/);
  const description = descMatch ? descMatch[1].replace(/\s+/g, " ").trim() : skillName;
  companions.push(slashCommandArtifact(skillName, description));
  const inj = contextInjectionArtifact(skillName, registryEntry);
  if (inj) companions.push(inj);
  companions.push(managedSettingsArtifact(skillName, registryEntry));

  return { skillMd, companions, additions };
}

/**
 * Reverse the flavour: strip the fenced additive block, recovering the open-core SKILL.md. The
 * portability proof asserts strip(apply(x)) === x byte-for-byte.
 *
 * @param {string} skillMd  an (optionally) flavoured SKILL.md.
 * @returns {string} the open-core SKILL.md with any flavour block removed.
 */
export function stripClaudeFlavour(skillMd) {
  const lines = skillMd.split("\n");
  const begin = lines.indexOf(FLAVOUR_BEGIN);
  if (begin === -1) return skillMd;
  // find the matching end at or after begin
  let end = -1;
  for (let i = begin + 1; i < lines.length; i++) {
    if (lines[i] === FLAVOUR_END) {
      end = i;
      break;
    }
  }
  if (end === -1) return skillMd; // unfenced/partial — leave untouched
  lines.splice(begin, end - begin + 1);
  return lines.join("\n");
}

/**
 * The Claude flavour as a harness adapter conforming to the shared contract (src/emit/adapter.js):
 * `{ profile, apply, strip }`. Same behavior as the named exports above, packaged as the
 * cross-harness interface so emit() can dispatch on it as data alongside other harnesses.
 * @type {{ profile: string, apply: typeof applyClaudeFlavour, strip: typeof stripClaudeFlavour }}
 */
export const claudeAdapter = Object.freeze({
  profile: EMIT_PROFILES.CLAUDE,
  apply: applyClaudeFlavour,
  strip: stripClaudeFlavour,
});
