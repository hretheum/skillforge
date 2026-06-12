# Getting started with skillforge

This guide takes you from a clean machine to your first emitted skill. skillforge is a CLI that reads
a `SKILL.md` source and **emits** ready-to-use skill artifacts for a chosen *profile* — a target
flavour such as `open-core` (the dependency-free default), `claude`, or `codex`. The engine itself
knows nothing about any specific client: everything specific arrives as data (the `SKILL.md` you point
at, and, for harness profiles, a registry entry).

If you just want the flag reference, jump to the [Options reference](#5-options-reference).

## 1. Prerequisites

- **Node.js 18 or newer.** Check with `node --version`.
- **Git.**

## 2. Install

**Pick one option and stick with it.**

### Option A — Global CLI (recommended)

```bash
git clone https://github.com/hretheum/skillforge.git
cd skillforge
npm install
npm install -g .
```

Verify:

```bash
skillforge --version
```

### Option B — Run directly without installing globally

```bash
git clone https://github.com/hretheum/skillforge.git
cd skillforge
npm install
node bin/skillforge.js --version
```

> All examples below use `skillforge …`. If you chose Option B, replace that with
> `node bin/skillforge.js …` throughout.

## 3. Your first emit

Create (or pick) a `SKILL.md` file, then emit it with the default `open-core` profile. `open-core`
needs no registry, so this is the simplest possible run:

```bash
skillforge emit --skill MY-SKILL.md --profile open-core --out ./output
```

skillforge derives the skill name from the filename (`MY-SKILL.md` → `MY-SKILL`), writes
`./output/MY-SKILL.md`, and prints the path of every file it wrote — one per line. If the profile
produces companion files, they appear alongside it under `./output`.

## 4. Using the `claude` profile with a registry

The non-`open-core` profiles (`claude`, `codex`) need a **registry** — a JSON file whose `skills`
object holds one entry per skill name. The entry carries the extra data those harness flavours emit.

Create a minimal `skillforge.registry.json` in your working directory:

```json
{
  "skills": {
    "MY-SKILL": {
      "description": "What this skill does, in one line."
    }
  }
}
```

The top-level key under `skills` must match the skill name derived from your `--skill` filename
(`MY-SKILL.md` → `MY-SKILL`). Now emit with the `claude` profile:

```bash
skillforge emit --skill MY-SKILL.md --profile claude --out ./output
```

Because the file is named `skillforge.registry.json` and lives in the current directory, skillforge
**auto-discovers** it — you do not pass `--registry`. To use a registry under a different name or
path, point at it explicitly:

```bash
skillforge emit --skill MY-SKILL.md --profile claude --registry ./config/my-registry.json --out ./output
```

## 5. Options reference

| Flag | Default | Description |
|---|---|---|
| `--skill <path>` | *(required)* | Path to the `SKILL.md` to emit. The skill name is the filename without its extension. |
| `--profile <name>` | `open-core` | Emit profile: `open-core`, `claude`, or `codex`. |
| `--registry <path>` | `skillforge.registry.json` in cwd | Registry JSON. Consulted only for non-`open-core` profiles; auto-discovered from the cwd when omitted. |
| `--out <dir>` | current directory | Output directory. Created automatically if it does not exist. |
| `-h`, `--help` | — | Show help. Works at the top level (`skillforge --help`) and per command (`skillforge emit --help`). |

## 6. Add the MCP server (optional)

The MCP server lets Claude Desktop (and any other MCP-compatible client) call skillforge tools
directly from a conversation — list skills, emit profiles, persist session state.

**Claude Desktop** — add this to `claude_desktop_config.json`
(on macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "skillforge": {
      "command": "skillforge",
      "args": ["mcp"],
      "env": {
        "SKILLFORGE_STATE_DIR": "/Users/you/Documents/skillforge-state"
      }
    }
  }
}
```

`SKILLFORGE_STATE_DIR` is the directory the MCP server is allowed to read and write (skill session
checkpoints, brand-discovery state, etc.). Set it to any directory you own. Restart Claude Desktop
after saving.

Or let skillforge write the entry automatically:

```bash
skillforge init
```

**Other MCP clients** — start the server on stdio:

```bash
skillforge mcp
```

## 7. Install a skill bundle (optional)

Install 266 community skills from the [ECC](https://github.com/affaan-m/ECC) collection:

```bash
skillforge skills add ecc
```

List what's installed:

```bash
skillforge skills list
```

## 8. Troubleshooting

**`emit requires --skill <path-to-SKILL.md>`**
You ran `emit` without `--skill` (or passed an empty value). Provide a path to a `SKILL.md` file.

**`--skill path does not exist: …`**
The path after `--skill` does not resolve to a file. Paths are resolved relative to the current
working directory — check for a typo or a wrong directory.

**`unknown profile "…" (known profiles: claude, codex, open-core)`**
The value after `--profile` is not one of the supported profiles. Use `open-core`, `claude`, or
`codex`.

**`profile "…" requires a registry, but none was found …`**
You chose a non-`open-core` profile but no registry was found. Either add a `skillforge.registry.json`
to the current directory, or pass `--registry <path>` pointing at your registry file.

**`skill "…" not found in registry "…"`**
The registry was found, but it has no entry whose key matches your skill name. Remember the name comes
from the `--skill` filename (`MY-SKILL.md` → `MY-SKILL`); add a matching key under `skills`.

**`registry "…" is not valid JSON: …`**
The registry file could not be parsed. Check it is well-formed JSON (no trailing commas, quoted keys).

**`skills activate requires a target`**
You ran `skillforge skills activate <name>` without `--target` and without a `default-target` in config.
Either pass `--target superpowers` explicitly, or set a default once:
```bash
skillforge skills config default-target superpowers
```

## 9. Activate a skill for Claude Code (optional)

If you use [superpowers](https://github.com/georgejung/superpowers) with Claude Code, you can
activate any installed skill as a native slash command:

```bash
skillforge skills activate brand-voice --target superpowers
```

This writes `~/.claude/skills/brand-voice.md` so Claude Code picks it up automatically.
To avoid typing `--target` every time, set a default:

```bash
skillforge skills config default-target superpowers
skillforge skills activate brand-voice   # uses default
```

List which skills are currently activated:

```bash
skillforge skills activate --list
```
