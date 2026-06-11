// Sources: concept + first principles, zero files from any third-party skills-factory codebase (clean-room).
//
// The `analysis` skill kind: a read-only skill that reads client resources directly (references
// family, like instruction/validation) and composes a schema'd report object — {report:...}.
// Unlike validation (PASS/FAIL verdict) the result is descriptive: an arbitrary report payload
// under the `report` field. No adapters, no governance side effect (governance:'none').
// The stage subset mirrors the instruction family (no read/build/gate).

export const analysisDescriptor = Object.freeze({
  kind: 'analysis',
  compose: {
    inputSource: 'references',
    validateOutput: (o) =>
      o && typeof o === 'object' && o.report
        ? []
        : ['analysis compose must return an object with a report field'],
  },
  stages: new Set(['load', 'activate', 'resolveRefs', 'compose', 'emit', 'telemetry']),
  governance: 'none',
  sideEffects: () => [],
  envelope: (p) => ({
    report: p.composed.report,
    activation: p.activation,
  }),
});
