#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { emitCommand } from '../src/cli/emit-command.js';
import { skillsAddCommand, skillsListCommand, skillsActivateCommand, skillsDeactivateCommand } from '../src/cli/skills-command.js';
import { writeConfig } from '../src/cli/config-command.js';
import { initCommand } from '../src/cli/init-command.js';

function readVersion() {
  const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));
  return JSON.parse(readFileSync(pkgPath, 'utf8')).version;
}

const TOP_USAGE = `skillforge — composable skill engine CLI

Usage:
  skillforge <command> [options]
  skillforge --help
  skillforge --version

Commands:
  init    Configure the Claude Desktop MCP server for skillforge
  emit    Emit skill artifacts for a target flavour
  skills  Manage the global skill store (add, list)
  mcp     Start the stdio MCP server (Model Context Protocol)

Run "skillforge <command> --help" for command-specific options.`;

const INIT_USAGE = `skillforge init — configure the Claude Desktop MCP server

Usage:
  skillforge init [options]

Writes (or updates) the skillforge MCP server entry in Claude Desktop's
claude_desktop_config.json so Claude Desktop can reach this engine. Idempotent:
re-running with an unchanged target makes no change. Restart Claude Desktop to
apply.

Options:
  --skills <bundle>   Also install a skill bundle (e.g. ecc)
  -h, --help          Show this help`;

const EMIT_USAGE = `skillforge emit — emit skill artifacts for a target profile

Usage:
  skillforge emit --skill <path> [options]

Options:
  --skill <path>      Path to the SKILL.md to emit (required)
  --profile <name>    Emit profile (open-core, claude, codex; default: open-core)
  --registry <path>   Registry JSON (default: skillforge.registry.json in cwd)
  --out <dir>         Output directory (default: current directory)
  -h, --help          Show this help`;

const SKILLS_USAGE = `skillforge skills — manage the global skill store (~/.skillforge/skills)

Usage:
  skillforge skills add <source>         Install a skill bundle into the store
  skillforge skills list                 List installed skills
  skillforge skills activate <name>      Emit an installed skill into a harness
  skillforge skills deactivate <name>    Remove an activated skill from the harness
  skillforge skills config <key> <val>   Set a persisted config flag

A <source> is an npm package (e.g. @skillforge-core/ecc-bundle), a curated alias
(e.g. "ecc" -> @skillforge-core/ecc-bundle), or a local bundle directory holding
skills/<name>/SKILL.md per skill.

skills activate emits an installed skill and writes it as <name>.md into the
target harness skills directory (default: ~/.claude/skills, overridable via the
CLAUDE_SKILLS_DIR env var). Idempotent — re-running overwrites in place.

  --target <name>   Activation target. Required unless a default-target is set
                    via "skills config" — there is no built-in default
  --list            List which installed skills are activated in the target dir

Config keys:
  auto-update <true|false>   When true, the MCP server installs newer bundle
                             versions on startup instead of only notifying.
  default-target <name>      Default target for "skills activate".

Options:
  -h, --help          Show this help`;

const MCP_USAGE = `skillforge mcp — start the stdio MCP server

Usage:
  skillforge mcp

Speaks the Model Context Protocol over stdio (stdin/stdout are the JSON-RPC
channel). Point an MCP client (e.g. Claude Desktop) at this command. Exposes
the tools: skillforge_emit, skillforge_list_profiles, skillforge_list_skills.

Options:
  -h, --help          Show this help`;

async function runInit(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      help: { type: 'boolean', short: 'h', default: false },
      skills: { type: 'string' }
    },
    allowPositionals: true
  });

  if (values.help) {
    process.stdout.write(INIT_USAGE + '\n');
    process.exit(0);
  }

  const { wasUpdated } = await initCommand({ skillsSource: values.skills });
  if (wasUpdated) {
    process.stdout.write('Configured Claude Desktop MCP server. Restart Claude Desktop to apply.\n');
  } else {
    process.stdout.write('skillforge already configured in Claude Desktop.\n');
  }
}

async function runEmit(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      help: { type: 'boolean', short: 'h', default: false },
      skill: { type: 'string' },
      profile: { type: 'string' },
      registry: { type: 'string' },
      out: { type: 'string' }
    },
    allowPositionals: true
  });

  if (values.help) {
    process.stdout.write(EMIT_USAGE + '\n');
    process.exit(0);
  }

  const result = await emitCommand(values);
  for (const file of result.outputFiles) {
    process.stdout.write(file + '\n');
  }
}

async function runSkills(argv) {
  const action = argv[0];

  if (action === '--help' || action === '-h' || action === undefined) {
    process.stdout.write(SKILLS_USAGE + '\n');
    process.exit(0);
  }

  if (action === 'add') {
    const source = argv[1];
    if (!source || source === '--help' || source === '-h') {
      process.stdout.write(SKILLS_USAGE + '\n');
      process.exit(source ? 0 : 1);
    }
    const { installed, skipped } = await skillsAddCommand(source);
    for (const name of installed) process.stdout.write(`installed ${name}\n`);
    for (const name of skipped) process.stdout.write(`skipped ${name} (already installed)\n`);
    return;
  }

  if (action === 'list') {
    const skills = skillsListCommand();
    if (skills.length === 0) {
      process.stdout.write('(no skills installed)\n');
      return;
    }
    for (const skill of skills) {
      const version = skill.version || '(unknown)';
      const source = skill.source ? ` <- ${skill.source}` : '';
      process.stdout.write(`${skill.name}  ${version}${source}\n`);
    }
    return;
  }

  if (action === 'activate') {
    const { values, positionals } = parseArgs({
      args: argv.slice(1),
      options: {
        help: { type: 'boolean', short: 'h', default: false },
        target: { type: 'string' },
        list: { type: 'boolean', default: false },
      },
      allowPositionals: true,
    });
    if (values.help) {
      process.stdout.write(SKILLS_USAGE + '\n');
      process.exit(0);
    }

    if (values.list) {
      const { activated } = skillsActivateCommand(undefined, { list: true, target: values.target });
      if (activated.length === 0) {
        process.stdout.write('(no skills activated)\n');
        return;
      }
      for (const name of activated) process.stdout.write(`${name}\n`);
      return;
    }

    const name = positionals[0];
    if (!name) {
      process.stderr.write('skills activate requires a <name>\n');
      process.stderr.write(SKILLS_USAGE + '\n');
      process.exit(1);
    }
    const result = skillsActivateCommand(name, { target: values.target });
    process.stdout.write(`activated ${result.activated} -> ${result.outputFile} (target: ${result.target})\n`);
    return;
  }

  if (action === 'deactivate') {
    const { values, positionals } = parseArgs({
      args: argv.slice(1),
      options: { help: { type: 'boolean', short: 'h', default: false } },
      allowPositionals: true,
    });
    if (values.help) { process.stdout.write(SKILLS_USAGE + '\n'); process.exit(0); }
    const name = positionals[0];
    if (!name) {
      process.stderr.write('skills deactivate requires a <name>\n');
      process.stderr.write(SKILLS_USAGE + '\n');
      process.exit(1);
    }
    const result = skillsDeactivateCommand(name);
    process.stdout.write(result.wasActive
      ? `deactivated ${result.deactivated}\n`
      : `${result.deactivated} was not activated (nothing to remove)\n`);
    return;
  }

  if (action === 'config') {
    const key = argv[1];
    const val = argv[2];
    if (!key || !val) {
      process.stderr.write('skills config requires <key> and <value>\n');
      process.stderr.write(SKILLS_USAGE + '\n');
      process.exit(1);
    }
    const { key: setKey, value } = writeConfig(key, val);
    process.stdout.write(`Set ${setKey} = ${value}\n`);
    return;
  }

  process.stderr.write(`unknown skills action: ${action}\n`);
  process.stderr.write(`Run "skillforge skills --help" for usage.\n`);
  process.exit(1);
}

async function main() {
  const subcommand = process.argv[2];

  if (subcommand === '--help' || subcommand === '-h' || subcommand === undefined) {
    process.stdout.write(TOP_USAGE + '\n');
    process.exit(0);
  }

  if (subcommand === '--version' || subcommand === '-v') {
    process.stdout.write(readVersion() + '\n');
    process.exit(0);
  }

  if (subcommand === 'init') {
    await runInit(process.argv.slice(3));
    return;
  }

  if (subcommand === 'emit') {
    await runEmit(process.argv.slice(3));
    return;
  }

  if (subcommand === 'skills') {
    await runSkills(process.argv.slice(3));
    return;
  }

  if (subcommand === 'mcp') {
    const rest = process.argv.slice(3);
    if (rest.includes('--help') || rest.includes('-h')) {
      process.stdout.write(MCP_USAGE + '\n');
      process.exit(0);
    }
    const { startMcpServer } = await import('../src/mcp/server.js');
    await startMcpServer();
    return;
  }

  process.stderr.write(`unknown command: ${subcommand}\n`);
  process.stderr.write(`Run "skillforge --help" for usage.\n`);
  process.exit(1);
}

main().catch((err) => {
  process.stderr.write((err && err.message ? err.message : String(err)) + '\n');
  process.exit(1);
});
