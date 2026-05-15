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

const clipRequest = validateAgentRequest({
  id: 'clip-request',
  text: '沿x,z平面切开整个模型，保留y轴正坐标部分',
  scene: request.scene,
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

test('normalizes simple geometryCut drafts into viewer clip actions', () => {
  const response = validateAgentResponse({
    kind: 'backendJobDraft',
    title: '几何切割作业',
    description: '沿 xz 平面切开模型并保留 y 正坐标一侧。',
    jobKind: 'geometryCut',
    risk: {
      level: 'high',
      summary: '需要本地后端作业执行。',
      warnings: ['当前不会直接修改视窗。'],
      requiresConfirmation: true,
      reversible: false,
    },
  }, clipRequest);

  assert.equal(response.kind, 'actionDraft');
  assert.equal(response.action.type, 'clipMesh');
  assert.deepEqual(response.action.target, { source: 'allVisible' });
  assert.deepEqual(response.action.params, {
    plane: { origin: [0, 0, 0], normal: [0, 1, 0] },
    keepSide: 'positive',
    mode: 'applyVisualClip',
    cap: true,
  });
  assert.equal(response.risk.requiresConfirmation, true);
  assert.equal(response.risk.reversible, true);
});

test('normalizes unnecessary clip clarifications into viewer clip actions', () => {
  const response = validateAgentResponse({
    kind: 'clarification',
    question: '请确认需要可视切割还是永久裁剪并烘焙几何？是否需要在切割面封口？',
    suggestions: ['可视切割，封口开启', '永久裁剪并烘焙，封口开启'],
  }, clipRequest);

  assert.equal(response.kind, 'actionDraft');
  assert.equal(response.action.type, 'clipMesh');
  assert.deepEqual(response.action.target, { source: 'allVisible' });
  assert.deepEqual(response.action.params.plane, { origin: [0, 0, 0], normal: [0, 1, 0] });
  assert.equal(response.action.params.keepSide, 'positive');
  assert.equal(response.action.params.mode, 'applyVisualClip');
});