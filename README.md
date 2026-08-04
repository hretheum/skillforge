# skillforge

> Composable skills for agent pipelines — one engine, swappable client configs.

[![License: Apache 2.0 + Commons Clause](https://img.shields.io/badge/license-Apache--2.0%20%2B%20Commons%20Clause-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](package.json)
[![Tests](https://img.shields.io/badge/tests-passing-brightgreen.svg)](#)
[![Codebase wiki](https://img.shields.io/badge/wiki-cubic.dev-8b5cf6.svg)](https://www.cubic.dev/wiki/hretheum/skillforge?page=page-intro)

Other languages: [Polski](docs/README.pl.md) · [Русский](docs/README.ru.md)

## What this is

**skillforge** is one generic engine that, from a swappable per-client config, produces ready-made
**skills** — reusable capabilities an agent can invoke (for example, "create a component that conforms
to this client's design system"). Instead of hand-writing the same prompt for every client, you describe
the client once as data; the engine assembles the skill. The engine knows nothing about any specific
client — all client knowledge lives in separate config + referenced resources, so the same engine serves
many clients with no code changes.

It is an **independent work written from scratch from the concept alone** (clean-room). The membrane is
one-way: the *concept* crosses, the *code never does*. No line of anyone else's code, configuration, or
confidential data is carried in — only ideas and "how it should work".


## Key features

- **Generic engine** — `src/` contains zero client knowledge; swapping the config produces a different
  set of skills with no engine change.
- **Six skill kinds** — `artifact` · `instruction` · `validation` · `analysis` · `transformation` ·
  `sync`, each with its own stage subset and governance class.
- **Dual interface** — a CLI (`skillforge …`) and an MCP server (Model Context Protocol over stdio) for
  any MCP-compatible agent or IDE.
- **Global skill store** — installed skills live in `~/.skillforge/skills/`, shared across projects.
- **Three emit profiles** — `open-core` (default, a strict no-op that returns the SKILL.md unchanged),
  `claude`, and `codex` (purely additive companions for those runtimes).
- **Minimal runtime footprint** — the only third-party runtime dependency is the MCP SDK; everything
  else is the Node standard library.

## Quick start

### Claude Code plugins (recommended)

This repository is a self-hosted Claude Code **plugin marketplace**. The skills ship as 11 thematic
plugins, so you install only the buckets you need — with versioned, one-command updates:

```bash
claude plugin marketplace add hretheum/skillforge

claude plugin install skillforge-skills@skillforge     # skillforge's own skills (brand discovery, competitive analysis, benchmarking)
claude plugin install ecc-testing-quality@skillforge   # ...plus any ECC buckets you want
```

Available plugins: `skillforge-skills`, `ecc-ai-agents`, `ecc-backend-data`, `ecc-cloud-infra`,
`ecc-docs-research`, `ecc-frontend-design`, `ecc-misc`, `ecc-mobile`, `ecc-product-biz`,
`ecc-security`, `ecc-testing-quality`. Inspect any of them before installing with
`claude plugin details <name>@skillforge` (also shows the projected token cost).

Skills are active from the next Claude Code session. Day-to-day management:

```bash
claude plugin marketplace update skillforge   # refresh the catalog from GitHub
claude plugin update <plugin>                 # pick up a new plugin version
claude plugin disable <plugin>                # switch off without uninstalling
```

Everything above is also available interactively via `/plugin` inside a Claude Code session.

### "I don't know what git is — and I don't want to"

You just want the skills as `/skill-name` slash commands in **Claude Code**. No terminal, no git,
no Node.js:

1. Download the skills ZIP from [**Releases**](https://github.com/hretheum/skillforge/releases)
   (asset `skillforge-skills-<version>.zip`)
2. Unpack it and move the skill folders into `~/.claude/skills/`
   (in Finder: **Cmd+Shift+G** → type `~/.claude/skills`)
3. Restart Claude Code — all 266 skills work as slash commands: `/brand-discovery`,
   `/brand-voice`, `/api-design`, …

Or, if a single Terminal line is acceptable (uses only tools preinstalled on macOS):

```bash
curl -L https://github.com/hretheum/skillforge/releases/download/skills-v0.2.1/skillforge-skills-0.2.1.zip -o /tmp/sf.zip && mkdir -p ~/.claude/skills && unzip -oq /tmp/sf.zip -d ~/.claude/skills
```

This path installs the skills only — no CLI, no MCP server, nothing executes at install time.
If you want the full engine, read on.

### "I'm a developer"

**Pick one** of the two installation options below, then optionally add the MCP server and a skill bundle.

#### Option A — Global CLI (recommended)

Install once, use from anywhere:

```bash
git clone https://github.com/hretheum/skillforge.git
cd skillforge
npm install
npm install -g .
skillforge --help
```

#### Option B — Run directly without installing

If you prefer not to install globally, run from the cloned directory:

```bash
git clone https://github.com/hretheum/skillforge.git
cd skillforge
npm install
node bin/skillforge.js --help
```

> All examples in this README use `skillforge …`. If you chose Option B, replace that with
> `node bin/skillforge.js …`.

---

### Add the MCP server (optional)

The MCP server lets Claude Desktop (and any other MCP-compatible client) call skillforge tools directly
from a conversation.

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

`SKILLFORGE_STATE_DIR` is where the MCP server is allowed to read and write files (skill session state,
brand-discovery checkpoints, etc.). Set it to any directory you own. Restart Claude Desktop after saving.

**Or let skillforge write the entry for you:**

```bash
skillforge init
```

**Other MCP clients** — start the server on stdio and point your client at it:

```bash
skillforge mcp
```

---

### Install a skill bundle (optional)

Install 266 community skills from the [ECC](https://github.com/affaan-m/ECC) collection into your
global skill store with one command:

```bash
skillforge skills add ecc
```

List what's installed:

```bash
skillforge skills list
```

---

## CLI: emit

`emit` projects a skill's `SKILL.md` onto a target runtime through a chosen emit profile.

| Flag | Description |
|---|---|
| `--skill <path>` | Path to the `SKILL.md` to emit (required) |
| `--profile <name>` | Emit profile: `open-core` (default), `claude`, `codex` |
| `--registry <path>` | Registry JSON (default: `skillforge.registry.json` in the cwd) |
| `--out <dir>` | Output directory (default: current directory) |
| `-h, --help` | Show command help |

```bash
# Open-core (default): returns the SKILL.md byte-identical, no companions
skillforge emit --skill skills/create-component/SKILL.md

# Claude profile: emits the SKILL.md plus its Claude companion
skillforge emit --skill skills/create-component/SKILL.md --profile claude

# Codex profile, explicit registry and output directory
skillforge emit --skill skills/create-component/SKILL.md --profile codex \
  --registry skillforge.registry.json --out ./dist
```

## CLI: skills

Manage the global skill store at `~/.skillforge/skills/`.

```bash
# Install a bundle (curated alias, npm package name, or local directory)
skillforge skills add ecc                        # ECC community bundle (266 skills)
skillforge skills add @skillforge-core/ecc-bundle  # same, explicit package name

# List installed skills with versions and source
skillforge skills list

# Persist a config flag (e.g. auto-update on MCP startup)
skillforge skills config auto-update true

# Activate an installed skill as a native slash command in Claude Code
skillforge skills activate brand-voice --target superpowers

# Deactivate (remove from the harness directory)
skillforge skills deactivate brand-voice
```

## Skill kinds

A skill's *kind* fixes which engine stages run and how its side effects are governed. `write` and
`bidirectional` kinds pass through the tool-governance gate; the read-only kinds return a typed result
with no file write.

| Kind | Description | Governance | Example skill |
|---|---|---|---|
| `artifact` | Produces a concrete artifact (a component, a file) via output adapters | `write` | `create-component` |
| `instruction` | Emits step-by-step agent directives from client references | `none` | `verdex-create-component` |
| `validation` | Returns a typed `{pass, violations}` verdict — never a file write | `none` | `verdex-disclosure-check` |
| `analysis` | Structured read-only reasoning over client resources | `none` | `verdex-analytics` |
| `transformation` | Reshapes or converts existing content into a new artifact | `write` | — |
| `sync` | Two-way reconciliation between a source and a target | `bidirectional` | `sync-example` |

## Project layout

```
src/
  engine/      runSkill() — the sole public API + the GenericExecutor
  registry/    skill-kind descriptors (the six kinds) + catalog
  governance/  tool-governance gate, audit trail, secret scan, skill_result
  loader/      client-config loading + activation
  adapters/    input/output adapter contracts and run edges
  skills/      compose steps + the data-driven compose-registry
  emit/        export layer: open-core / claude / codex profiles
  core/        prompt rendering, session + cache telemetry attributes
  mcp/         the stdio MCP server
clients/       per-client configs (data only): one dir per client, e.g. glasshouse, verdex, …
test/          node --test suite
tools/         gates: registry-lint, determinism, secret-scan, cleanroom, …
docs/          the full specification
```

## Documentation

The full specification lives across the `docs/` tree — covering the vision, architecture, client model,
adapters, the normalized form, skills, the loader, governance, deployment profiles, security, and cost.
Start with [`docs/getting-started.md`](docs/getting-started.md) or [`docs/vision-and-problem.md`](docs/vision-and-problem.md).

## Contributing

Contributions are welcome — bug reports, new skill kinds, adapter implementations, docs fixes.

**Before you start:**

- Read [`docs/vision-and-problem.md`](docs/vision-and-problem.md) — understand what skillforge is and
  is not before proposing changes.
- Read [`docs/architecture-overview.md`](docs/architecture-overview.md) — the map of all sub-documents
  and the engine's layered structure.
- Read [`CLAUDE.md`](CLAUDE.md) — project rules that apply to all work here (clean-room policy,
  validation directive, doc closure requirement).

**Relevant docs by area:**

| Area | Document |
|---|---|
| Adding a new skill kind | [`docs/skill-type-system.md`](docs/skill-type-system.md) · [`docs/skill-manifest-and-registry.md`](docs/skill-manifest-and-registry.md) |
| Writing a client config | [`docs/client-model.md`](docs/client-model.md) · [`docs/normalized-form.md`](docs/normalized-form.md) |
| Input/output adapters | [`docs/adapters.md`](docs/adapters.md) |
| Governance and tool gates | [`docs/tool-governance.md`](docs/tool-governance.md) |
| Security model | [`docs/security.md`](docs/security.md) |
| Loader and activation | [`docs/loader-and-activation.md`](docs/loader-and-activation.md) |
| Emit profiles | [`docs/deployment-profiles.md`](docs/deployment-profiles.md) |
| Glossary | [`docs/glossary.md`](docs/glossary.md) |

## Troubleshooting

**Activated skills not visible as slash commands in Claude Code**

Before v0.1.1, `skills activate` wrote flat `~/.claude/skills/<name>.md` files. Claude Code requires
skills to be in `~/.claude/skills/<name>/SKILL.md` directory format. If you activated skills with an
older version, re-run:

```bash
# Remove old flat files
ls ~/.skillforge/skills/ | while read skill; do
  rm -f ~/.claude/skills/${skill}.md
done

# Re-activate in the correct format
ls ~/.skillforge/skills/ | while read skill; do
  skillforge skills activate "$skill" --target superpowers
done
```

---

**Skills don't respond to `/skill-name` in Claude Desktop chat**

Claude Desktop's chat `/` menu only lists Anthropic cloud skills — it does not surface MCP prompts or
tools from connected servers until the model has a reason to use them. To run a store skill in
Desktop chat, mention the server explicitly, e.g.:

> use the skillforge mcp skill api-design

The model will then call `skillforge_get_skill` and follow the skill. In **Claude Code** (CLI and
desktop app) activated skills work as native `/skill-name` commands — see
[`docs/getting-started.md`](docs/getting-started.md), section 9.

---

**Contributing a skill to ECC** (the community bundle):

skillforge ships the [ECC](https://github.com/affaan-m/ECC) bundle. If you want to add a skill to
the community collection, open a PR there — skills accepted upstream are automatically included in the
next bundle release.

## License

**Apache 2.0 + Commons Clause.** You may use, modify, and distribute skillforge freely for personal and
community use. The Commons Clause addendum prohibits *selling* the software — including paid hosting or
consulting/support services whose value derives substantially from skillforge's functionality.
Commercial use of that kind requires a separate commercial licence. See [LICENSE](LICENSE) for the full
text.
