// Sources: concept + first principles, zero files from any third-party skills-factory codebase (clean-room).

export const instructionDescriptor = Object.freeze({
  kind: 'instruction',
  compose: {
    inputSource: 'references',
    validateOutput: (o) =>
      typeof o?.instructions === 'string'
        ? []
        : ['instruction compose must return {instructions}'],
  },
  stages: new Set(['load', 'activate', 'resolveRefs', 'compose', 'emit', 'telemetry']),
  governance: 'none',
  sideEffects: () => [],
  envelope: (p) => ({
    instructions: p.composed.instructions,
    context: p.composed.context,
    request: p.composed.request,
    activation: p.activation,
  }),
});
