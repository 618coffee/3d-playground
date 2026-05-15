import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockAgentResponse } from './mock-agent.js';

const scene = {
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
};

test('creates viewer clip drafts for whole-model xz-plane commands', () => {
  const response = createMockAgentResponse({
    id: 'mock-clip-request',
    text: '沿x,z平面切开整个模型，保留y轴正坐标部分',
    scene,
    conversation: [],
  });

  assert.equal(response.kind, 'actionDraft');
  assert.equal(response.action.type, 'clipMesh');
  assert.deepEqual(response.action.target, { source: 'allVisible' });
  assert.deepEqual(response.action.params.plane, { origin: [0, 0, 0], normal: [0, 1, 0] });
  assert.equal(response.action.params.keepSide, 'positive');
});