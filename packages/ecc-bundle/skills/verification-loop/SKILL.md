---
name: verification-loop
description: "Six-phase quality gate for Claude Code sessions: build, types, lint, tests, secret scan, and diff review. Use before creating a PR, after a feature lands, or after any significant refactor to confirm quality gates pass before integration."
origin: ECC
---

# Verification Loop Skill

A six-phase verification system for Claude Code sessions. Runs build, type-check, lint, test suite, secret scan, and diff review in sequence, then emits a structured report with an overall READY/NOT READY verdict.

## When to Use

Invoke this skill:
- After completing a feature or significant code change
- Before creating a PR
- When you want to ensure quality gates pass before integration
- After refactoring to confirm nothing regressed
- When an automated CI check is not yet available locally and you need confidence before pushing

## Verification Phases

### Phase 1: Build Verification
```bash
# Check if project builds
npm run build 2>&1 | tail -20
# OR
pnpm build 2>&1 | tail -20
```

If build fails, STOP and fix before continuing.

### Phase 2: Type Check
```bash
# TypeScript projects
npx tsc --noEmit 2>&1 | head -30

# Python projects
pyright . 2>&1 | head -30
```

Report all type errors. Fix critical ones before continuing.

### Phase 3: Lint Check
```bash
# JavaScript/TypeScript
npm run lint 2>&1 | head -30

# Python
ruff check . 2>&1 | head -30
```

### Phase 4: Test Suite
```bash
# Run tests with coverage
npm run test -- --coverage 2>&1 | tail -50

# Check coverage threshold
# Target: 80% minimum
```

Report:
- Total tests: X
- Passed: X
- Failed: X
- Coverage: X%

### Phase 5: Security Scan

Scan for hardcoded secrets across common source file types:

```bash
# OpenAI / Anthropic / generic API keys
grep -rn "sk-[a-zA-Z0-9]" \
  --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
  --include="*.py" --include="*.rb" --include="*.go" --include="*.java" \
  --include="*.env" --include="*.env.*" --include="*.yaml" --include="*.yml" \
  . 2>/dev/null | grep -v ".env.example" | head -20

# Generic secret patterns
grep -rn -iE "(api_key|api_secret|secret_key|private_key|access_token|auth_token|client_secret)\s*=\s*['\"][^'\"]{8,}" \
  --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
  --include="*.py" --include="*.rb" --include="*.go" --include="*.java" \
  --include="*.json" --include="*.yaml" --include="*.yml" \
  . 2>/dev/null | grep -v ".env.example" | head -20

# AWS credentials
grep -rn "AKIA[0-9A-Z]{16}" \
  --include="*.ts" --include="*.js" --include="*.py" --include="*.json" \
  --include="*.yaml" --include="*.yml" \
  . 2>/dev/null | head -10

# GitHub personal access tokens / fine-grained tokens
grep -rn -E "ghp_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{82}" \
  --include="*.ts" --include="*.js" --include="*.py" --include="*.yaml" \
  . 2>/dev/null | head -10

# Stripe secret keys
grep -rn "sk_live_[a-zA-Z0-9]" \
  --include="*.ts" --include="*.js" --include="*.py" \
  . 2>/dev/null | head -10

# Check for console.log left in source
grep -rn "console.log" --include="*.ts" --include="*.tsx" src/ 2>/dev/null | head -10
```

Report any hits. For each hit: file path, line number, pattern matched, and recommended action (move to environment variable, rotate key, or confirm it is a safe placeholder).

### Phase 6: Diff Review
```bash
# Show what changed
git diff --stat
git diff HEAD~1 --name-only
```

Review each changed file for:
- Unintended changes
- Missing error handling
- Potential edge cases

## Output Format

After running all phases, produce a verification report:

```
VERIFICATION REPORT
==================

Build:     [PASS/FAIL]
Types:     [PASS/FAIL] (X errors)
Lint:      [PASS/FAIL] (X warnings)
Tests:     [PASS/FAIL] (X/Y passed, Z% coverage)
Security:  [PASS/FAIL] (X issues)
Diff:      [X files changed]

Overall:   [READY/NOT READY] for PR

Issues to Fix:
1. ...
2. ...
```

## Continuous Mode

For long sessions, run verification every 15 minutes or after major changes:

```markdown
Set a mental checkpoint:
- After completing each function
- After finishing a component
- Before moving to next task

Run: /verify
```

## Integration with Hooks

This skill complements PostToolUse hooks but provides deeper verification.
Hooks catch issues immediately; this skill provides comprehensive review.
