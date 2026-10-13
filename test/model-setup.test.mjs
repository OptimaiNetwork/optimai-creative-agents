import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getModelSetupPolicy } from '../src/model-setup.mjs';
test('normal browser prepares only the selected model automatically', () => {
  assert.equal(getModelSetupPolicy({ bytes: 3758596 }, { browser: true }).mode, 'automatic');
  assert.equal(getModelSetupPolicy({ bytes: 453000000, requiresWebGPU: true }, { webGPU: true }).mode, 'automatic');
});
test('connection hints preserve a manual path without declaring the browser unsupported', () => {
  for (const environment of [{ saveData: true }, { effectiveType: '2g' }, { effectiveType: 'slow-2g' }]) assert.equal(getModelSetupPolicy({ bytes: 3758596 }, environment).mode, 'manual');
  assert.equal(getModelSetupPolicy({ bytes: 453000000 }, { effectiveType: '3g' }).mode, 'manual');
  assert.equal(getModelSetupPolicy({ bytes: 3758596 }, { effectiveType: '3g' }).mode, 'automatic');
});
test('hardware fallback is specific to model needs', () => {
  assert.equal(getModelSetupPolicy({ requiresWebGPU: true }, { webGPU: false }).mode, 'unsupported');
  assert.equal(getModelSetupPolicy({}, { webGPU: false }).mode, 'automatic');
  assert.equal(getModelSetupPolicy({ bytes: 453000000 }, { deviceMemory: 2 }).mode, 'manual');
  assert.equal(getModelSetupPolicy({}, { browser: false }).mode, 'unsupported');
});
