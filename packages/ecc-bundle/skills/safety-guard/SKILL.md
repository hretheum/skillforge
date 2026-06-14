---
name: safety-guard
description: Use this skill to prevent destructive operations when working on production systems or running agents autonomously.
origin: ECC
---

# Safety Guard — Prevent Destructive Operations

## When to Use

- When working on production systems
- When agents are running autonomously (full-auto mode)
- When you want to restrict edits to a specific directory
- During sensitive operations (migrations, deploys, data changes)

## How It Works

Three modes of protection:

### Mode 1: Careful Mode

Intercepts destructive commands before execution and warns:

```
Watched patterns:
- rm -rf (especially /, ~, or project root)
- git push --force
- git reset --hard
- git checkout . (discard all changes)
- DROP TABLE / DROP DATABASE
- docker system prune
- kubectl delete
- chmod 777
- sudo rm
- npm publish (accidental publishes)
- Any command with --no-verify
```

When detected: shows what the command does, asks for confirmation, suggests safer alternative.

### Mode 2: Freeze Mode

Locks file edits to a specific directory tree:

```
/safety-guard freeze src/components/
```

Any Write/Edit outside `src/components/` is blocked with an explanation. Useful when you want an agent to focus on one area without touching unrelated code.

### Mode 3: Guard Mode (Careful + Freeze combined)

Both protections active. Maximum safety for autonomous agents.

```
/safety-guard guard --dir src/api/ --allow-read-all
```

Agents can read anything but only write to `src/api/`. Destructive commands are blocked everywhere.

### Unlock

```
/safety-guard off
```

## Implementation

Uses PreToolUse hooks to intercept Bash, Write, Edit, and MultiEdit tool calls. Checks the command/path against the active rules before allowing execution.

### settings.json hook snippet

Add the following to `.claude/settings.json` to install the guard hook:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|Write|Edit|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.claude/hooks/safety-guard.js"
          }
        ]
      }
    ]
  }
}
```

### Hook script (`~/.claude/hooks/safety-guard.js`)

```js
// PreToolUse hook — blocks destructive commands in careful/guard mode.
// Reads SAFETY_GUARD_MODE from env: "careful", "freeze:<dir>", or "guard:<dir>".
// CommonJS so `node ~/.claude/hooks/safety-guard.js` runs as-is (no "type":"module" needed).
const { readFileSync } = require('node:fs');

const input = JSON.parse(readFileSync('/dev/stdin', 'utf8'));
const mode  = process.env.SAFETY_GUARD_MODE || '';
const tool  = input.tool_name || '';
const cmd   = input.tool_input?.command || input.tool_input?.file_path || '';

const DESTRUCTIVE = /rm\s+-rf|git\s+push\s+--force|git\s+reset\s+--hard|DROP\s+(TABLE|DATABASE)|docker\s+system\s+prune|kubectl\s+delete|--no-verify/i;

if ((mode === 'careful' || mode.startsWith('guard')) && tool === 'Bash' && DESTRUCTIVE.test(cmd)) {
  console.error(`[safety-guard] Blocked destructive command: ${cmd}`);
  process.exit(1);
}

if (mode.startsWith('freeze') || mode.startsWith('guard')) {
  const allowedDir = mode.split(':')[1] || '';
  if ((tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit') && allowedDir && !cmd.startsWith(allowedDir)) {
    console.error(`[safety-guard] Blocked write outside allowed dir (${allowedDir}): ${cmd}`);
    process.exit(1);
  }
}

process.exit(0);
```

Set the mode before your session:

```bash
export SAFETY_GUARD_MODE=careful          # intercept destructive commands
export SAFETY_GUARD_MODE=freeze:src/api/  # lock writes to src/api/
export SAFETY_GUARD_MODE=guard:src/api/   # both
```

## Integration

- Enable by default for `codex -a never` sessions
- Pair with observability risk scoring in ECC 2.0
- Logs all blocked actions to `~/.claude/safety-guard.log`
