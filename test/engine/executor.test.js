// Sources: concept + first principles, zero files from any third-party skills-factory codebase (clean-room).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execute, STAGE_ORDER } from '../../src/engine/executor.js';
import { artifactDescriptor, instructionDescriptor } from '../../src/registry/kinds/index.js';

// --- shared fakes ------------------------------------------------------------------------
// A client context with the two adapter names + a references map + an output dir. The fakes
// name NO concrete adapter/skill — they stand in for the injected layer surface (deps).
function fakeClientContext() {
  return {
    identifier: 'fake-client',
    adapters: { input: 'fake-input', output: 'fake-output' },
    references: { 'tokens.json': '{}' },
    profile: null,
    skillParameters: { componentOutputDir: 'out' },
  };
}

function recordingDeps(overrides = {}) {
  const calls = [];
  const base = {
    loadClientConfig: (args) => { calls.push(['load', args]); return fakeClientContext(); },
    activate: (args) => { calls.push(['activate', args]); return { skill: args.skillName, client: 'fake-client', project: args.project, entry: {} }; },
    getInputAdapter: (name) => { calls.push(['getInput', name]); return { read: () => ({ payload: 'ds' }) }; },
    readInput: (args) => { calls.push(['read', args]); return { kind: 'design-system', tokens: { color: 'red' } }; },
    getOutputAdapter: (name) => { calls.push(['getOutput', name]); return { makeResult: () => ({}), render: () => ({}) }; },
    buildResult: (args) => { calls.push(['build', args]); return { result: { kind: 'frontend-component' }, artifact: { filename: 'Button.tsx', source: 'export const Button = () => null;', componentName: 'Button' } }; },
    preToolUseHook: { check: (intent) => { calls.push(['gate', intent]); return { decision: 'allow' }; } },
    emitTelemetry: (sink, ctx) => { calls.push(['telemetry', ctx]); },
  };
  return { deps: { ...base, ...overrides }, calls };
}

const registry = { skills: { 'fake-skill': { requiredTools: ['Write'] } } };

// --- artifact family ---------------------------------------------------------------------

test('STAGE_ORDER is the canonical fixed order', () => {
  assert.deepStrictEqual(STAGE_ORDER, [
    'load', 'activate', 'read', 'resolveRefs', 'compose', 'build', 'gate', 'emit', 'telemetry',
  ]);
});

test('artifact kind runs the full pipeline and returns the artifact envelope', async () => {
  const { deps, calls } = recordingDeps();
  const compose = ({ description }) => ({ componentName: 'Button', description });
  const out = await execute({
    descriptor: artifactDescriptor,
    request: { componentName: 'Button' },
    skillName: 'fake-skill',
    client: 'fake-client',
    project: null,
    compose,
    deps,
    loadArgs: { clientsDir: '/x' },
    registry,
    policyLayers: { client: [] },
    telemetrySink: () => {},
  });

  // Envelope shape (artifactDescriptor.envelope).
  assert.ok(out.artifact && out.artifact.filename === 'Button.tsx');
  assert.ok(out.result && out.result.kind === 'frontend-component');
  assert.ok(out.gate && out.gate.decision === 'allow');
  assert.ok(out.activation);
  assert.ok(out.description);
  assert.ok(out.promptTiers);

  // The stages that ran, in order — resolveRefs is SKIPPED (not in artifact.stages).
  const stages = calls.map((c) => c[0]);
  assert.deepStrictEqual(stages, ['load', 'activate', 'getInput', 'read', 'getOutput', 'build', 'gate', 'telemetry']);
});

test('artifact compose may be ASYNC — the executor awaits it (CC-09)', async () => {
  // A genuinely async compose returns a Promise; the executor must await it so validateOutput/build
  // see the RESOLVED spec, not a pending Promise. This is the corner case the Verdex client proves.
  const { deps } = recordingDeps();
  const compose = async () => {
    await Promise.resolve();
    return { componentName: 'Async' };
  };
  const out = await execute({
    descriptor: artifactDescriptor, request: {}, skillName: 'fake-skill', client: 'fake-client',
    compose, deps, loadArgs: {}, registry,
  });
  assert.ok(out.artifact, 'an async compose resolves to a real spec and the artifact is built');
});

test('artifact gate names the OUTPUT-ADAPTER filename, not a hardcoded .tsx (P3 genericity)', async () => {
  // A web-components-shaped artifact: filename is x-button.js, NOT .tsx.
  const { deps, calls } = recordingDeps({
    buildResult: () => ({ result: { kind: 'frontend-component' }, artifact: { filename: 'x-button.js', source: 'customElements.define()', componentName: 'XButton' } }),
  });
  const compose = () => ({ componentName: 'XButton' });
  await execute({
    descriptor: artifactDescriptor, request: {}, skillName: 'fake-skill', client: 'fake-client',
    compose, deps, loadArgs: {}, registry,
  });
  const gateCall = calls.find((c) => c[0] === 'gate');
  assert.ok(gateCall, 'gate stage ran');
  assert.strictEqual(gateCall[1].toolInput.file_path, 'out/x-button.js');
});

test("artifact gate folds the client config's orgBaseline into the org layer", async () => {
  // The loaded client context carries orgBaseline rules; the gate must SEE them as its org layer
  // even when the caller passes no policyLayers — otherwise orgBaseline is documentation only.
  const orgBaseline = [{ pattern: 'Write', decision: 'allow' }];
  const { deps, calls } = recordingDeps({
    loadClientConfig: () => ({ ...fakeClientContext(), orgBaseline }),
  });
  const compose = () => ({ componentName: 'Button' });
  await execute({
    descriptor: artifactDescriptor, request: {}, skillName: 'fake-skill', client: 'fake-client',
    compose, deps, loadArgs: {}, registry, // no policyLayers passed
  });
  const gateCall = calls.find((c) => c[0] === 'gate');
  assert.ok(gateCall, 'gate stage ran');
  assert.deepStrictEqual(gateCall[1].layers.org, orgBaseline);
});

test('artifact: a denied gate aborts the run (deny-first)', async () => {
  const { deps } = recordingDeps({
    preToolUseHook: { check: () => ({ decision: 'deny', reason: 'no Write scope' }) },
  });
  const compose = () => ({ componentName: 'Button' });
  await assert.rejects(
    () => execute({ descriptor: artifactDescriptor, request: {}, skillName: 'fake-skill', client: 'fake-client', compose, deps, loadArgs: {}, registry }),
    /denied at the PreToolUse gate: no Write scope/,
  );
});

test('artifact: a compose output missing componentName fails loud at compose', async () => {
  const { deps } = recordingDeps();
  const compose = () => ({ notAComponent: true });
  await assert.rejects(
    () => execute({ descriptor: artifactDescriptor, request: {}, skillName: 'fake-skill', client: 'fake-client', compose, deps, loadArgs: {}, registry }),
    /violates its kind contract/,
  );
});

// --- instruction family ------------------------------------------------------------------

test('instruction kind runs the references pipeline, no read/build/gate, returns instruction envelope', async () => {
  const { deps, calls } = recordingDeps();
  const compose = ({ references }) => ({
    instructions: 'do the thing',
    context: { refs: Object.keys(references) },
    request: null,
  });
  const out = await execute({
    descriptor: instructionDescriptor,
    request: null,
    skillName: 'fake-instruction',
    client: 'fake-client',
    compose,
    deps,
    loadArgs: { clientsDir: '/x' },
    registry: { skills: { 'fake-instruction': {} } },
    telemetrySink: () => {},
  });

  assert.strictEqual(out.instructions, 'do the thing');
  assert.deepStrictEqual(out.context, { refs: ['tokens.json'] });
  assert.strictEqual(out.request, null);
  assert.ok(out.activation);

  // resolveRefs ran; read/getInput/getOutput/build/gate did NOT.
  const stages = calls.map((c) => c[0]);
  assert.deepStrictEqual(stages, ['load', 'activate', 'telemetry']);
  assert.ok(!stages.includes('read'));
  assert.ok(!stages.includes('build'));
  assert.ok(!stages.includes('gate'));
});

test('instruction: a compose output missing instructions fails loud at compose', async () => {
  const { deps } = recordingDeps();
  const compose = () => ({ context: {} }); // no instructions string
  await assert.rejects(
    () => execute({ descriptor: instructionDescriptor, request: null, skillName: 'fake-instruction', client: 'fake-client', compose, deps, loadArgs: {}, registry: { skills: { 'fake-instruction': {} } } }),
    /violates its kind contract/,
  );
});

// --- guards ------------------------------------------------------------------------------
// execute is async (CC-09): a synchronous arg-validation throw becomes a REJECTED promise, so the
// guards assert on rejection, not a synchronous throw.

test('execute requires a descriptor with a stages Set', async () => {
  await assert.rejects(() => execute({ descriptor: {}, compose: () => ({}), deps: {} }), /stages` Set/);
});

test('execute requires a compose function', async () => {
  await assert.rejects(() => execute({ descriptor: artifactDescriptor, deps: {} }), /requires a compose function/);
});

test('execute requires injected deps', async () => {
  await assert.rejects(() => execute({ descriptor: artifactDescriptor, compose: () => ({}) }), /requires an injected `deps`/);
});

test('a throwing telemetry dep never fails the run (executor guarantees the invariant)', async () => {
  const { deps } = recordingDeps({
    emitTelemetry: () => { throw new Error('sink blew up'); },
  });
  const compose = () => ({ componentName: 'Button' });
  // The telemetry stage runs LAST and is best-effort: the executor swallows a throwing dep so a
  // broken observability path can never take down a generation that already produced its artifact.
  const out = await execute({ descriptor: artifactDescriptor, request: {}, skillName: 'fake-skill', client: 'fake-client', compose, deps, loadArgs: {}, registry });
  assert.ok(out.artifact, 'the run completed and returned the artifact despite the telemetry throw');
});
