// Sources: concept + first principles, zero files from any third-party skills-factory codebase (clean-room).
import { join } from 'node:path';

function artifactPathFor(clientContext, artifact) {
  const outputDir = clientContext.skillParameters?.componentOutputDir ?? 'components';
  // The OUTPUT ADAPTER owns the filename (react → Button.tsx, web-components → x-button.js); use
  // it, never a hardcoded extension, or the gated Write mis-names a non-react client (the latent
  // P3 genericity defect). Fall back to componentName only when the artifact carries no filename.
  const filename = artifact.filename ?? `${artifact.componentName}.tsx`;
  return join(outputDir, filename);
}

export const artifactDescriptor = Object.freeze({
  kind: 'artifact',
  compose: {
    inputSource: 'adapter',
    validateOutput: (spec) =>
      spec && spec.componentName ? [] : ['artifact compose must return a spec with componentName'],
  },
  stages: new Set(['load', 'activate', 'read', 'compose', 'build', 'gate', 'emit', 'telemetry']),
  governance: 'write',
  sideEffects: (parts) => [
    {
      tool: 'Write',
      toolInput: {
        file_path: artifactPathFor(parts.clientContext, parts.artifact),
        content: parts.artifact.source,
      },
    },
  ],
  envelope: (p) => ({
    artifact: p.artifact,
    activation: p.activation,
    description: p.description,
    result: p.result,
    gate: p.gate,
    promptTiers: p.promptTiers,
  }),
});
