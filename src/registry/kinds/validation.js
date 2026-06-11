// Sources: concept + first principles, zero files from any third-party skills-factory codebase (clean-room).
//
// The `validation` skill kind: a read-only skill that reads client resources directly (references
// family, like instruction) and composes a typed PASS/FAIL verdict — {pass:boolean, violations:string[]}.
// It has no adapters and no governance side effect (governance:'none'); the verdict is the result,
// never a file write. The stage subset mirrors the instruction family (no read/build/gate).

export const validationDescriptor = Object.freeze({
  kind: 'validation',
  compose: {
    inputSource: 'references',
    validateOutput: (o) =>
      o && typeof o.pass === 'boolean' && Array.isArray(o.violations)
        ? []
        : ['validation compose must return {pass:boolean, violations:string[]}'],
  },
  stages: new Set(['load', 'activate', 'resolveRefs', 'compose', 'emit', 'telemetry']),
  governance: 'none',
  sideEffects: () => [],
  envelope: (p) => ({
    pass: p.composed.pass,
    violations: p.composed.violations,
    activation: p.activation,
  }),
});
