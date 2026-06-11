// Sources: concept + first principles, zero files from any third-party skills-factory codebase (clean-room).
//
// The `transformation` skill kind: a multi-write skill in the adapter family (like artifact).
// It reads a normalized DESCRIPTION through an input adapter (inputSource:'adapter') and composes
// a PLAN — an ordered, non-empty array of intended changes ({plan:[...]}). Unlike artifact (a
// single emitted spec → one Write) a transformation fans out to MANY writes; sideEffects projects
// every plan entry as a tool call, so the gate (plan→approve→apply) sees the full blast radius
// before anything is applied. governance:'write'; stages include read+build+gate (the gated path).

export const transformationDescriptor = Object.freeze({
  kind: 'transformation',
  compose: {
    inputSource: 'adapter',
    validateOutput: (o) =>
      o && Array.isArray(o.plan) && o.plan.length > 0
        ? []
        : ['transformation compose must return {plan:[...]} with a non-empty plan array'],
  },
  stages: new Set(['load', 'activate', 'read', 'compose', 'build', 'gate', 'emit', 'telemetry']),
  governance: 'write',
  sideEffects: (parts) => parts.composed.plan,
  envelope: (p) => ({
    plan: p.composed.plan,
    activation: p.activation,
  }),
});
