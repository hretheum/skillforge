## Summary
Brief description of what this PR does and why.

## Type of change
- [ ] Bug fix
- [ ] New feature
- [ ] Refactor
- [ ] Documentation
- [ ] Test coverage
- [ ] Chore

## Gates checklist (all must pass before merge)
- [ ] `node --test` — 0 fail
- [ ] `node tools/registry-lint.js` — 0 errors
- [ ] `node tools/determinism-gate.js` — PASS
- [ ] No client-specific data in engine code
- [ ] Clean-room rule respected (no copied external code)
- [ ] New skill (if any) has tests and sideEffects declared

## Test coverage
Describe what new or updated tests cover this change.

## Breaking changes
List any breaking changes to the public API (`runSkill()`) or CLI interface. None if not applicable.

## Documentation
- [ ] CLAUDE.md Status table updated (if public API changed)
- [ ] Relevant spec doc updated (if behaviour changed)
