import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAgentRequest, validateAgentResponse } from './validation.js';

const request = validateAgentRequest({
  id: 'test-request',
  text: '把当前对象绕 Z 轴旋转 30 度',
  scene: {
    unit: 'mm',
    displayMode: 'surface',
    selection: ['fan-1'],
    meshes: [
      {
        id: 'fan-1',
        name: 'Turbofan fan',
        sourceFormat: 'procedural',
        visible: true,
        locked: false,
        selected: true,
        bounds: [-40, 40, -35, 35, -20, 20],
        stats: { points: 1200, cells: 800, triangles: 760 },
        transform: { position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
      },
    ],
  },
  conversation: [],
});

test('normalizes schema-wrapper actions returned by an LLM', () => {
  const response = validateAgentResponse({
    kind: 'actionDraft',
    action: {
      common: {
        source: 'agent',
        rawText: '把当前对象绕 Z 轴旋转 30 度',
        confirmed: false,
      },
      target: [{ source: 'selection' }],
      commands: {
        rotateMesh: {
          params: {
            axis: 'z',
            angleDeg: 30,
            pivot: 'boundsCenter',
            space: 'world',
          },
        },
      },
    },
    explanation: 'Rotate the selected mesh around Z.',
    confidence: 0.95,
  }, request);

  assert.equal(response.kind, 'actionDraft');
  assert.equal(response.action.type, 'rotateMesh');
  assert.deepEqual(response.action.target, { source: 'selection' });
  assert.deepEqual(response.action.params, {
    axis: 'z',
    angleDeg: 30,
    pivot: 'boundsCenter',
    space: 'world',
  });
  assert.equal(response.action.source, 'agent');
  assert.equal(response.action.rawText, '把当前对象绕 Z 轴旋转 30 度');
});

test('normalizes boolean-like strings in LLM clone payloads', () => {
  const response = validateAgentResponse({
    kind: 'actionDraft',
    action: {
      id: 'clone-1',
      type: 'cloneMesh',
      target: { source: 'selection' },
      params: {
        count: 3,
        offset: [20, 0, 0],
        unit: 'mm',
        shareGeometry: 'true',
        namePattern: '{name}-copy-{n}',
      },
      source: 'agent',
      rawText: '复制 3 个对象',
    },
    explanation: 'Clone the selected mesh.',
    confidence: 0.94,
  }, request);

  assert.equal(response.kind, 'actionDraft');
  assert.equal(response.action.type, 'cloneMesh');
  assert.equal(response.action.params.shareGeometry, true);
});