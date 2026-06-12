// mcp/server — a stdio MCP server that exposes skillforge over the Model Context Protocol
// (/61/62). It is a thin PRESENTATION edge, like the bin layer: it parses an MCP tool
// call into plain arguments, delegates to the shared core (emitCommand, emitProfileNames), and
// formats the result. No engine logic lives here; the same emit workflow the CLI uses is reused
// verbatim.
//
// PROTOCOL DISCIPLINE. Under stdio transport, stdout IS the JSON-RPC channel. Nothing here may
// write to stdout — every diagnostic goes to stderr. Tool handlers never throw out of band:
// a failure is returned as an MCP tool result with isError set, so a bad call surfaces to the
// client as content, not as an unhandled rejection that would corrupt the stream.
//
// Generic by construction: this file names no client and no skill. Specifics arrive as DATA
// (the tool-call arguments — skill path, profile, registry path).

import { readFileSync, writeFileSync, existsSync, mkdirSync, lstatSync } from 'node:fs';
import { resolve as resolvePath, isAbsolute, dirname, join, sep } from 'node:path';
import { homedir } from 'node:os';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { readConfig } from '../cli/config-command.js';
import { emitCommand } from '../cli/emit-command.js';
import { skillsAddCommand } from '../cli/skills-command.js';
import { emitProfileNames } from '../emit/index.js';
import { STORE_PATH, listSkills } from '../store/index.js';
import { discoverSkills } from '../store/discovery.js';
import { readManifest } from '../store/manifest.js';
import { checkForUpdates } from './update-checker.js';

let updateNotices = [];

export const TOOLS = [
  {
    name: 'skillforge_emit',
    description:
      'Emit skill artifacts from a SKILL.md for a target profile. Returns the list of files written.',
    inputSchema: {
      type: 'object',
      properties: {
        skill_path: {
          type: 'string',
          description:
            'Path to the SKILL.md to emit. Provide this or skill_name; if both are given, skill_path wins.',
        },
        skill_name: {
          type: 'string',
          description:
            'Bare skill name to resolve from .claude/skills/ (local) then ~/.skillforge/skills (global). Alternative to skill_path.',
        },
        profile: {
          type: 'string',
          description: 'Emit profile (open-core, claude, codex). Default: open-core.',
        },
        out_dir: { type: 'string', description: 'Output directory. Default: current directory.' },
        registry_path: {
          type: 'string',
          description: 'Registry JSON path. Auto-discovered as skillforge.registry.json otherwise.',
        },
      },
    },
  },
  {
    name: 'skillforge_list_profiles',
    description: 'List the available emit profiles.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'skillforge_list_skills',
    description:
      'List the skills registered in skillforge.registry.json (or a given registry). Returns an empty list when no registry is found.',
    inputSchema: {
      type: 'object',
      properties: {
        registry_path: {
          type: 'string',
          description: 'Registry JSON path. Auto-discovered as skillforge.registry.json otherwise.',
        },
      },
    },
  },
  {
    name: 'skillforge_skills_update',
    description:
      'Update all installed skill bundles to their latest versions. Re-fetches each bundle from its source and re-installs. Returns a summary of what was updated.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'skillforge_write_file',
    description:
      'Write text content to a file on disk. Creates parent directories as needed. Use this to persist skill session state (e.g. brand-discovery checkpoints, module files).',
    inputSchema: {
      type: 'object',
      required: ['path', 'content'],
      properties: {
        path: { type: 'string', description: 'Absolute path of the file to write.' },
        content: { type: 'string', description: 'Text content to write.' },
      },
    },
  },
  {
    name: 'skillforge_read_file',
    description: 'Read text content from a file on disk. Returns the file content or an error if the file does not exist.',
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string', description: 'Absolute path of the file to read.' },
      },
    },
  },
];

function textResult(text) {
  return { content: [{ type: 'text', text }] };
}

function errorResult(text) {
  return { content: [{ type: 'text', text }], isError: true };
}

async function handleEmit(args) {
  const skill = args.skill_path || args.skill_name;
  if (!skill) {
    return errorResult('skillforge_emit requires skill_path or skill_name');
  }
  const result = await emitCommand({
    skill,
    profile: args.profile,
    out: args.out_dir,
    registry: args.registry_path,
  });
  return textResult(result.outputFiles.join('\n'));
}

function handleListProfiles() {
  return textResult(JSON.stringify({ profiles: emitProfileNames() }));
}

function handleListSkills(args) {
  // Resolution order for a registry file:
  //   1. explicit registry_path arg
  //   2. SKILLFORGE_REGISTRY env var
  //   3. skillforge.registry.json in cwd
  // When an explicit path is given but missing → return empty (caller asked for that exact file).
  // When auto-discovery produces no file → fall back to the global skill store.
  const explicitPath = args.registry_path
    ? resolvePath(process.cwd(), args.registry_path)
    : null;
  const envPath = !explicitPath && process.env.SKILLFORGE_REGISTRY
    ? resolvePath(process.cwd(), process.env.SKILLFORGE_REGISTRY)
    : null;
  const cwdPath = !explicitPath && !envPath
    ? resolvePath(process.cwd(), 'skillforge.registry.json')
    : null;

  const resolvedPath = explicitPath || envPath || cwdPath;
  const isExplicit = Boolean(explicitPath || envPath);

  if (existsSync(resolvedPath)) {
    const raw = JSON.parse(readFileSync(resolvedPath, 'utf8'));
    const registrySkills = raw && typeof raw === 'object' ? raw.skills : null;
    const skills =
      registrySkills && typeof registrySkills === 'object'
        ? Object.entries(registrySkills).map(([name, entry]) => ({
            name,
            description: entry && typeof entry.description === 'string' ? entry.description : '',
          }))
        : [];
    return textResult(
      JSON.stringify({ skills, ...(updateNotices.length ? { updateNotices } : {}) }),
    );
  }

  // Explicit path requested but missing — return empty list (do not silently substitute).
  if (isExplicit) {
    return textResult(JSON.stringify({ skills: [] }));
  }

  // Auto-discovery found nothing — fall back to the global skill store (~/.skillforge/skills/).
  const globalSkills = listSkills().map(({ name, source, version }) => ({
    name,
    ...(source ? { source } : {}),
    ...(version ? { version } : {}),
  }));
  return textResult(
    JSON.stringify({
      skills: globalSkills,
      source: 'global-store',
      ...(updateNotices.length ? { updateNotices } : {}),
    }),
  );
}

export async function handleSkillsUpdate(opts = {}) {
  const storeDir = opts.storeDir || STORE_PATH;
  const manifest = readManifest(storeDir);

  const sources = [
    ...new Set(
      Object.values(manifest.skills)
        .map((entry) => (entry && typeof entry.source === 'string' ? entry.source.trim() : ''))
        .filter((source) => source !== ''),
    ),
  ];

  if (sources.length === 0) {
    return textResult(JSON.stringify({ alreadyLatest: true, message: 'no bundles installed' }));
  }

  const updated = [];
  const alreadyLatest = [];
  const errors = {};

  for (const source of sources) {
    try {
      const { installed, skipped } = await skillsAddCommand(source, { storeDir });
      updated.push(...installed);
      alreadyLatest.push(...skipped);
    } catch (err) {
      errors[source] = err && err.message ? err.message : String(err);
    }
  }

  return textResult(JSON.stringify({ updated, alreadyLatest, errors }));
}

// All file I/O is confined to a single root directory.
// Default: ~/.skillforge/state/   Override: SKILLFORGE_STATE_DIR env var.
const STATE_ROOT = resolvePath(
  process.env.SKILLFORGE_STATE_DIR || resolvePath(homedir(), '.skillforge', 'state'),
);

// Resolve `p` relative to STATE_ROOT (if relative) or as-is (if absolute),
// then assert the normalised result stays inside STATE_ROOT.
// Also rejects any symlink found along the resolved path.
function resolveStateFile(p) {
  if (!p || typeof p !== 'string' || p.trim() === '') {
    return { error: 'path must be a non-empty string' };
  }
  const abs = isAbsolute(p) ? resolvePath(p) : resolvePath(STATE_ROOT, p);
  const root = STATE_ROOT.endsWith(sep) ? STATE_ROOT : STATE_ROOT + sep;
  if (abs !== STATE_ROOT && !abs.startsWith(root)) {
    return { error: `path must be inside SKILLFORGE_STATE_DIR (${STATE_ROOT}): ${abs}` };
  }
  // Reject any symlink in the path components that already exist.
  const parts = abs.slice(root.length).split(sep).filter(Boolean);
  let walking = STATE_ROOT;
  for (const part of parts) {
    walking = resolvePath(walking, part);
    if (existsSync(walking)) {
      try {
        const stat = lstatSync(walking);
        if (stat.isSymbolicLink()) {
          return { error: `symlink not allowed in state path: ${walking}` };
        }
      } catch {
        // path disappeared between existsSync and lstatSync — harmless, proceed
      }
    }
  }
  return { abs };
}

function handleWriteFile(args) {
  if (typeof args.content !== 'string') {
    return errorResult('skillforge_write_file requires a string content');
  }
  const { abs, error } = resolveStateFile(args.path);
  if (error) return errorResult(error);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, args.content, { encoding: 'utf8', mode: 0o600 });
  return textResult(JSON.stringify({ written: abs, stateRoot: STATE_ROOT }));
}

function handleReadFile(args) {
  const { abs, error } = resolveStateFile(args.path);
  if (error) return errorResult(error);
  if (!existsSync(abs)) {
    return errorResult(`file not found: ${abs}`);
  }
  return textResult(readFileSync(abs, 'utf8'));
}

async function dispatch(name, args) {
  switch (name) {
    case 'skillforge_emit':
      return handleEmit(args);
    case 'skillforge_list_profiles':
      return handleListProfiles();
    case 'skillforge_list_skills':
      return handleListSkills(args);
    case 'skillforge_skills_update':
      return handleSkillsUpdate();
    case 'skillforge_write_file':
      return handleWriteFile(args);
    case 'skillforge_read_file':
      return handleReadFile(args);
    default:
      return errorResult(`unknown tool: ${name}`);
  }
}

const FRONTMATTER_DESC = /^---[\s\S]*?^description:\s*(.+?)(?=\n\w|\n---)/m;
const SAFE_SKILL_NAME = /^[A-Za-z0-9_.-]+$/;

function assertSafeSkillName(name) {
  if (!name || !SAFE_SKILL_NAME.test(name) || name === '..') {
    throw new Error(`invalid skill name: "${name}"`);
  }
  const resolved = resolvePath(STORE_PATH, name, 'SKILL.md');
  const root = resolvePath(STORE_PATH) + sep;
  if (!resolved.startsWith(root)) {
    throw new Error(`invalid skill name: "${name}"`);
  }
}

function readSkillDescription(skillName) {
  try {
    assertSafeSkillName(skillName);
    const text = readFileSync(join(STORE_PATH, skillName, 'SKILL.md'), 'utf8');
    const m = text.match(FRONTMATTER_DESC);
    return m ? m[1].trim().replace(/\n\s*/g, ' ') : '';
  } catch {
    return '';
  }
}

export async function startMcpServer() {
  const server = new Server(
    { name: 'skillforge', version: '0.1.0' },
    { capabilities: { tools: {}, prompts: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: discoverSkills(STORE_PATH).map((skill) => ({
      name: skill.name,
      description: readSkillDescription(skill.name),
    })),
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name } = request.params;
    assertSafeSkillName(name);
    const skillMd = join(STORE_PATH, name, 'SKILL.md');
    if (!existsSync(skillMd)) {
      throw new Error(`skill "${name}" not found in store`);
    }
    return {
      messages: [{
        role: 'user',
        content: { type: 'text', text: readFileSync(skillMd, 'utf8') },
      }],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      return await dispatch(name, args || {});
    } catch (err) {
      return errorResult(err && err.message ? err.message : String(err));
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  checkForUpdates()
    .then(async (notices) => {
      const updates = notices.filter((n) => n.updateAvailable);
      const { autoUpdate } = readConfig();
      if (autoUpdate && updates.length > 0) {
        // Auto-install silently and suppress the notice — the update has already happened.
        for (const n of updates) {
          await skillsAddCommand(n.source).catch(() => {});
        }
      } else {
        updateNotices = updates;
      }
    })
    .catch(() => {});
}
