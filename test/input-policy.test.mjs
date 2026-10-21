import test from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_CATALOG, AGENT_INPUT_NEEDS, getAgentInputPolicy, getAgentWorkspace } from '../src/index.mjs';
import { LOCAL_IMAGE_LIMITS } from '../src/browser-runtime.mjs';
import { runCanvasLab } from '../src/canvas-lab.mjs';
import { VISION_LIMITS } from '../src/vision-runtime.mjs';
import { CAMERA_LIMITS } from '../src/camera-runtime.mjs';
import { AGENT_3D_LIMITS } from '../src/scene-3d.mjs';
import { FRAME_SCULPTURE_LIMITS } from '../src/frame-sculpture.mjs';

const byKind = (kind) => AGENT_CATALOG.filter((agent) => agent.workspace.kind === kind).map((agent) => getAgentInputPolicy(agent.id));

test('every template has a frozen, self-consistent input policy', () => {
  assert.equal(getAgentInputPolicy('missing-agent'), undefined);
  assert.equal(getAgentInputPolicy(undefined), undefined);
  for (const agent of AGENT_CATALOG) {
    const policy = getAgentInputPolicy(agent.id);
    assert.ok(Object.isFrozen(policy) && Object.isFrozen(policy.needs) && Object.isFrozen(policy.optional), agent.id);
    assert.deepEqual(Object.keys(policy), ['minFiles', 'maxFiles', 'accept', 'maxBytes', 'needs', 'optional', 'onDevice']);
    assert.ok(Number.isInteger(policy.minFiles) && policy.minFiles >= 0 && policy.minFiles <= policy.maxFiles, agent.id);
    assert.equal(policy.maxFiles === 0, policy.accept === '' && policy.maxBytes === 0, agent.id);
    assert.ok([...policy.needs, ...policy.optional].every((need) => AGENT_INPUT_NEEDS.includes(need)), agent.id);
    assert.ok(!policy.needs.some((need) => policy.optional.includes(need)), agent.id);
  }
});

test('policies replace host-side file limits for canvas compositions', () => {
  const files = Object.fromEntries(AGENT_CATALOG.filter((agent) => agent.workspace.kind === 'canvas').map((agent) => [agent.workspace.operation, [getAgentInputPolicy(agent.id).minFiles, getAgentInputPolicy(agent.id).maxFiles]]));
  assert.deepEqual(files, { mockup: [1, 1], 'image-filter': [1, 1], blend: [2, 2], 'image-grid': [1, 8], 'type-overlay': [1, 1], bento: [1, 8], poster: [0, 1], transition: [2, 2], glitch: [1, 1], letter: [0, 1] });
  assert.equal(getAgentInputPolicy('reference-blend').minFiles, 2);
  assert.ok(byKind('canvas').every((policy) => policy.accept === 'image/png,image/jpeg,image/webp' && policy.maxBytes === LOCAL_IMAGE_LIMITS.bytes && policy.onDevice));
  assert.ok(byKind('canvas').every((policy) => policy.maxFiles <= LOCAL_IMAGE_LIMITS.files));
});

test('canvas policies agree with the counts the engine enforces', async () => {
  const image = () => ({ type: 'image/png', size: 8 });
  for (const operation of ['mockup', 'poster', 'bento', 'glitch', 'letter', 'blend', 'transition']) {
    const agent = AGENT_CATALOG.find((item) => item.workspace.kind === 'canvas' && item.workspace.operation === operation);
    const { minFiles, maxFiles } = getAgentInputPolicy(agent.id);
    await assert.rejects(runCanvasLab(operation, Array.from({ length: maxFiles + 1 }, image)), /Choose up to/, operation);
    if (minFiles > 0) await assert.rejects(runCanvasLab(operation, Array.from({ length: minFiles - 1 }, image)), /Add an image|Choose two/, operation);
  }
});

test('byte caps and needs match each engine and workspace', () => {
  assert.ok(byKind('vision').every((policy) => policy.minFiles === 1 && policy.maxBytes === VISION_LIMITS.inputBytes && policy.needs.includes('wasm')));
  assert.ok(byKind('camera').every((policy) => policy.maxBytes === CAMERA_LIMITS.imageBytes && policy.minFiles === 0 && policy.optional.includes('camera') && !policy.needs.includes('camera')));
  assert.ok(byKind('3d').every((policy) => policy.maxBytes === AGENT_3D_LIMITS.bytes && policy.accept.includes('.glb') && policy.needs.includes('webgl')));
  assert.ok(byKind('frame').every((policy) => policy.maxBytes === FRAME_SCULPTURE_LIMITS.bytes && /video\/mp4/.test(policy.accept) && /image\/png/.test(policy.accept)));
  assert.ok(byKind('music').every((policy) => policy.minFiles === 1 && policy.accept.startsWith('audio/') && policy.needs.includes('web-audio')));
  // Writing can fall back to a local Ollama runtime, so WebGPU never blocks it.
  assert.ok(byKind('writing').every((policy) => policy.maxFiles === 0 && policy.needs.length === 0 && policy.optional.includes('webgpu')));
});

test('onDevice is false only where a host production step follows', () => {
  const off = AGENT_CATALOG.filter((agent) => !getAgentInputPolicy(agent.id).onDevice).map((agent) => getAgentWorkspace(agent.id).kind);
  assert.deepEqual([...new Set(off)].sort(), ['sketch', 'workflow']);
  assert.equal(AGENT_CATALOG.filter((agent) => getAgentInputPolicy(agent.id).onDevice).length, 24);
  assert.ok(byKind('workflow').every((policy) => policy.minFiles === 0 && policy.maxFiles === 1 && policy.needs.length === 0));
});
