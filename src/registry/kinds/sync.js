// Sources: concept + first principles, zero files from any third-party skills-factory codebase (clean-room).
//
// The `sync` skill kind: a BIDIRECTIONAL, multi-write skill in the adapter family. It reads a
// normalized DESCRIPTION through an input adapter (inputSource:'adapter') and composes a non-empty
// array of INTENTS — the writes for BOTH sides of the sync (e.g. code→design and design→code). Like
// `transformation` it fans out to many writes, so sideEffects projects every composed intent as a
// tool call and the gate (HITL approve → apply) sees the full blast radius of BOTH directions before
// anything is applied. governance:'bidirectional' (vs transformation's 'write') — same gated stage
// set, but the governance class names that the writes flow in two directions, and every gated intent
// is recorded on the audit trail (the executor's generic audit tap over deps.auditTrail) so the
// two-way sync is fully attributable. stages include read+build+gate (the gated path).

export const syncDescriptor = Object.freeze({
  kind: 'sync',
  compose: {
    inputSource: 'adapter',
    validateOutput: (o) =>
      o && Array.isArray(o.intents) && o.intents.length > 0
        ? []
        : ['sync compose must return intents[] for both sides'],
  },
  stages: new Set(['load', 'activate', 'read', 'compose', 'build', 'gate', 'emit', 'telemetry']),
  governance: 'bidirectional',
  sideEffects: (parts) => parts.composed.intents,
  envelope: (p) => ({
    intents: p.composed.intents,
    activation: p.activation,
  }),
});
