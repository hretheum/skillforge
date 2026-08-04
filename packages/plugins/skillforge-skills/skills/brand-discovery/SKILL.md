---
name: brand-discovery
description: >-
  Adaptive, multi-session brand identity interview for a design studio or
  consultancy. Elicits purpose, positioning, audience, personality, voice,
  narrative, and founder-brand tension using laddering, 5 Whys, and
  projective techniques. State is checkpointed to disk after each module;
  sessions resume automatically from the last known position. Reads the
  active session state from the client's brandState resource; holds no
  client knowledge of its own.
license: SEE LICENSE IN LICENSE
compatibility: >-
  Requires a configured client with a brandState resource (JSON). When
  state.session is null (uninitialized), the BOOTSTRAP interview is
  appended automatically to guide session setup.
metadata:
  skillforge.owner: platform
  skillforge.registryKey: brand-discovery
  skillforge.sourceKind: brand-identity
  skillforge.resultKind: brand-context
---

# Brand Discovery

Use this skill to conduct a structured, adaptive brand identity interview.
The goal is a complete `90_SYNTHESIS.md` — a master brandbook the studio
can use to brief designers, writers, and external collaborators.

**Do not skip the state protocol.** A session without checkpointing wastes
all elicited knowledge when the conversation ends.

## Session start protocol

On every activation, perform these steps **before** asking any interview
question:

1. **Read `context.state`**. If it is null or `context.state.session` is
   null, the BOOTSTRAP interview is appended below — follow it now.
2. **Read the current module file** at path
   `{context.state.vaultPath}/modules/{context.state.inProgressModule}`.
   If it exists, scan the Raw section for previously captured answers.
3. **Report to the user** in two or three sentences: which module we are
   in, its status, and what remains. Then ask: "Continue here, or switch
   module?"

## Interview discipline

Apply these rules throughout every module:

1. **One question at a time.** Never present a list of questions.
2. **After each answer:** short paraphrase → one deepening probe OR close
   the thread if the topic is saturated. Never move on silently.
3. **Laddering:** for every "what" answer, follow with "Why does that
   matter to you?" until a core value surfaces (typically two to four
   iterations).
4. **5 Whys:** for beliefs or positioning claims — push until the root
   reason, not the surface declaration, is on the table.
5. **Detect thin answers:** if generic, jargon-heavy, or vague, ask for
   one concrete example, a client story, or a number.
6. **Projective techniques** (use once per module to break a plateau):
   - "If the studio were a person, how would they walk into a room?"
   - Brand obituary: "If the studio closed in five years, what would
     clients miss? What would you regret not having said?"
   - Competitive contrast: "Name one studio you admire but would never
     want to become. What specifically makes them the wrong model?"
7. **Saturation signal:** when two consecutive probes produce no new
   information, summarise and close the module.
8. **End of module:** write a structured module file with two sections:
   - `## Raw` — verbatim quotes and examples.
   - `## Synthesis` — your interpretation, three candidate formulations,
     open questions, contradictions between participants.
   Then update `state.json` (see State protocol below).

## Module sequence

| File | Label | Frameworks used |
|------|-------|-----------------|
| `10_purpose-why.md` | Purpose / Why | Sinek Golden Circle, Lencioni |
| `20_positioning.md` | Positioning | Dunford "Obviously Awesome", Moore template |
| `30_audience-niche.md` | Audience & Niche | Baker "Business of Expertise", ICP |
| `40_personality-archetype.md` | Personality & Archetype | Mark & Pearson 12 archetypes, J. Aaker 5 dims |
| `50_voice-tone.md` | Voice & Tone | Brand voice guidelines |
| `60_narrative-story.md` | Narrative / Story | Neumeier trueline, brand story arc |
| `70_founder-tension.md` | Founder Brands vs Studio Brand | Enns "Win Without Pitching" |
| `90_SYNTHESIS.md` | Master Brandbook | Kapferer prism, Aaker brand system |

Complete modules in order. Honour a user request to jump modules and note
the skip in `state.json`.

## State write protocol

After each module reaches saturation or done status, write two files using
the Write tool:

**Module file** at `{state.vaultPath}/modules/{moduleFile}` — full Raw
and Synthesis content.

**`state.json`** at `{state.statePath}` — update `completedModules`,
`inProgressModule`, `nextModule`, `lastUpdated`. On the very first write
(after BOOTSTRAP), `state.statePath` equals `context.statePath` — they are
the same path, established during session initialization. Schema:

```json
{
  "session": "<client>-brand-<YYYY-MM>",
  "vaultPath": "<absolute path to brand-identity directory>",
  "statePath": "<absolute path to this state.json in skillforge client resources>",
  "completedModules": [],
  "inProgressModule": "10_purpose-why.md",
  "nextModule": "20_positioning.md",
  "participants": ["founder-A"],
  "lastUpdated": "<ISO-8601>"
}
```

After writing, confirm: "Module X saved. State updated. Next: Y."

## Multi-founder mode

When `context.request.participant` is set, write answers to
`{state.vaultPath}/founders/{participant}.md` instead of the main module
files. After all founders complete a module, run a reconciliation pass:
summarise convergences and divergences in the module file, flag
"productive tensions" for the group alignment workshop.
