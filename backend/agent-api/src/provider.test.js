import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProviderPayload, systemPrompt } from './provider.js';

const request = {
  text: '解释当前场景',
  mode: 'ask',
  modelRouterId: 'default-router',
  scene: { meshes: [], selection: [], unit: 'mm', displayMode: 'surface' },
  conversation: [],
};

test('provider payload includes chat mode and model router', () => {
  const payload = buildProviderPayload(request);

  assert.equal(payload.text, '解释当前场景');
  assert.equal(payload.mode, 'ask');
  assert.equal(payload.modelRouterId, 'default-router');
});

test('system prompt includes Ask Edit and Agent mode guidance', () => {
  const prompt = systemPrompt();

  assert.match(prompt, /Ask mode/);
  assert.match(prompt, /Edit mode/);
  assert.match(prompt, /Agent mode/);
  assert.match(prompt, /moveMesh/);
  assert.match(prompt, /Ask mode.*sceneAnswer/s);
  assert.match(prompt, /Edit mode.*actionDraft/s);
  assert.match(prompt, /Agent mode.*actionPlan/s);
});