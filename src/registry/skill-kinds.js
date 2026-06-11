// Sources: concept + first principles, zero files from any third-party skills-factory codebase (clean-room).
import { artifactDescriptor } from './kinds/artifact.js';
import { instructionDescriptor } from './kinds/instruction.js';
import { validationDescriptor } from './kinds/validation.js';
import { analysisDescriptor } from './kinds/analysis.js';
import { transformationDescriptor } from './kinds/transformation.js';
import { syncDescriptor } from './kinds/sync.js';

export function createSkillKinds(seed = {}) {
  const catalog = new Map(Object.entries(seed));
  return {
    get(kind) {
      if (!catalog.has(kind)) {
        throw new Error(
          `unknown skillKind "${kind}" (known: ${[...catalog.keys()].join(', ')})`
        );
      }
      return catalog.get(kind);
    },
    has(kind) { return catalog.has(kind); },
    kinds() { return [...catalog.keys()]; },
  };
}

export function defaultSkillKinds() {
  return createSkillKinds({
    [artifactDescriptor.kind]: artifactDescriptor,
    [instructionDescriptor.kind]: instructionDescriptor,
    [validationDescriptor.kind]: validationDescriptor,
    [analysisDescriptor.kind]: analysisDescriptor,
    [transformationDescriptor.kind]: transformationDescriptor,
    [syncDescriptor.kind]: syncDescriptor,
  });
}
