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

test('targets an orange mesh by color label for rotation requests', () => {
  const response = createMockAgentResponse({
    id: 'mock-color-rotate-request',
    text: '把橙色对象绕着 y 轴旋转 30 度',
    scene: {
      ...scene,
      selection: ['fan-1'],
      meshes: [
        ...scene.meshes,
        {
          id: 'stator-vanes',
          name: 'Warm stator vane stage',
          sourceFormat: 'procedural',
          visible: true,
          locked: false,
          selected: false,
          color: '#f08a4b',
          colorLabel: 'orange',
          bounds: [-16, -4, -28, 28, -28, 28],
          stats: { points: 252, cells: 144, triangles: 144 },
          transform: { position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
        },
      ],
    },
    conversation: [],
  });

  assert.equal(response.kind, 'actionDraft');
  assert.equal(response.action.type, 'rotateMesh');
  assert.deepEqual(response.action.target, { meshId: 'stator-vanes' });
  assert.equal(response.action.params.axis, 'y');
  assert.equal(response.action.params.angleDeg, 30);
});