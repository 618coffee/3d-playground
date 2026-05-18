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

test('defaults request mode and model router metadata', () => {
  const parsed = validateAgentRequest({
    id: 'metadata-defaults',
    text: '重置视角',
    scene: request.scene,
    conversation: [],
  });

  assert.equal(parsed.sessionId, undefined);
  assert.equal(parsed.mode, 'edit');
  assert.equal(parsed.modelRouterId, 'default-router');
});

test('preserves valid request session mode and model router metadata', () => {
  const parsed = validateAgentRequest({
    id: 'metadata-explicit',
    sessionId: 'session-abc123',
    text: '解释当前场景',
    mode: 'ask',
    modelRouterId: 'default-router',
    scene: request.scene,
    conversation: [],
  });

  assert.equal(parsed.sessionId, 'session-abc123');
  assert.equal(parsed.mode, 'ask');
  assert.equal(parsed.modelRouterId, 'default-router');
});

test('preserves valid mesh references and drops invalid references', () => {
  const parsed = validateAgentRequest({
    id: 'mesh-reference-request',
    text: '旋转 @Fan 45 度',
    scene: request.scene,
    meshReferences: [
      { label: '@Fan', meshId: 'fan-1' },
      { label: '', meshId: 'fan-1' },
      { label: '@Missing', meshId: 'missing-mesh' },
      { label: '@Bad' },
      null,
    ],
    conversation: [],
  });

  assert.deepEqual(parsed.meshReferences, [{ label: '@Fan', meshId: 'fan-1' }]);
});

test('validates deleteMesh action drafts', () => {
  const response = validateAgentResponse({
    kind: 'actionDraft',
    action: {
      type: 'deleteMesh',
      target: { source: 'selection' },
      params: {},
      source: 'agent',
      rawText: 'delete selected mesh',
    },
    explanation: 'Delete the selected mesh.',
    confidence: 0.9,
    risk: { level: 'low', summary: 'Undoable deletion.', warnings: [], requiresConfirmation: false, reversible: true },
  }, request);

  assert.equal(response.action.type, 'deleteMesh');
  assert.deepEqual(response.action.params, {});
});

test('rejects invalid request mode and model router metadata', () => {
  assert.throws(() => validateAgentRequest({
    id: 'bad-mode',
    text: '解释当前场景',
    mode: 'review',
    scene: request.scene,
    conversation: [],
  }), /mode/);

  assert.throws(() => validateAgentRequest({
    id: 'bad-router',
    text: '解释当前场景',
    modelRouterId: 'other-router',
    scene: request.scene,
    conversation: [],
  }), /modelRouterId/);
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

test('validates moveMesh action drafts returned by an LLM', () => {
  const response = validateAgentResponse({
    kind: 'actionDraft',
    action: {
      id: 'move-1',
      type: 'moveMesh',
      target: { source: 'selection' },
      params: { offset: [10, -5, 2], unit: 'mm' },
      source: 'agent',
      rawText: '把当前对象沿 X 轴移动 10mm，沿 Y 轴移动 -5mm，沿 Z 轴移动 2mm',
    },
    explanation: 'Move the selected mesh by a relative offset.',
    confidence: 0.9,
  }, request);

  assert.equal(response.kind, 'actionDraft');
  assert.equal(response.action.type, 'moveMesh');
  assert.deepEqual(response.action.params, { offset: [10, -5, 2], unit: 'mm' });
  assert.equal(response.risk.requiresConfirmation, false);
});

test('normalizes schema-wrapper moveMesh commands returned by an LLM', () => {
  const response = validateAgentResponse({
    kind: 'actionDraft',
    action: {
      common: { source: 'agent', rawText: '把当前对象沿 X 轴移动 10mm', confirmed: false },
      target: [{ source: 'selection' }],
      commands: {
        moveMesh: {
          params: { offset: [10, 0, 0], unit: 'mm' },
        },
      },
    },
    explanation: 'Move selected mesh.',
    confidence: 0.9,
  }, request);

  assert.equal(response.kind, 'actionDraft');
  assert.equal(response.action.type, 'moveMesh');
  assert.deepEqual(response.action.target, { source: 'selection' });
  assert.deepEqual(response.action.params, { offset: [10, 0, 0], unit: 'mm' });
});

test('preserves mesh colors and derives color labels for provider targeting', () => {
  const colorRequest = validateAgentRequest({
    id: 'color-request',
    text: '把橙色对象绕着 y 轴旋转 30 度',
    scene: {
      unit: 'mm',
      displayMode: 'surface',
      selection: [],
      meshes: [
        {
          id: 'stator-vanes',
          name: 'Warm stator vane stage',
          sourceFormat: 'procedural',
          visible: true,
          locked: false,
          selected: false,
          color: '#f08a4b',
          bounds: [-16, -4, -28, 28, -28, 28],
          stats: { points: 252, cells: 144, triangles: 144 },
          transform: { position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
        },
        {
          id: 'compressor-core',
          name: 'Compressor core shaft',
          sourceFormat: 'procedural',
          visible: true,
          locked: false,
          selected: false,
          color: '#d5a553',
          bounds: [-45, 45, -11, 11, -11, 11],
          stats: { points: 128, cells: 64, triangles: 64 },
          transform: { position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
        },
      ],
    },
    conversation: [],
  });

  assert.equal(colorRequest.scene.meshes[0].color, '#f08a4b');
  assert.equal(colorRequest.scene.meshes[0].colorLabel, 'orange');
  assert.equal(colorRequest.scene.meshes[1].color, '#d5a553');
  assert.equal(colorRequest.scene.meshes[1].colorLabel, 'gold');
});

test('narrows color-targeted selection commands to the uniquely matching mesh', () => {
  const colorRequest = validateAgentRequest({
    id: 'color-selection-request',
    text: '把选中的橙色对象绕着 y 轴旋转 30 度',
    scene: {
      unit: 'mm',
      displayMode: 'surface',
      selection: ['compressor-core', 'stator-vanes'],
      meshes: [
        {
          id: 'compressor-core',
          name: 'Compressor core shaft',
          sourceFormat: 'procedural',
          visible: true,
          locked: false,
          selected: true,
          color: '#d5a553',
          bounds: [-45, 45, -11, 11, -11, 11],
          stats: { points: 128, cells: 64, triangles: 64 },
          transform: { position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
        },
        {
          id: 'stator-vanes',
          name: 'Warm stator vane stage',
          sourceFormat: 'procedural',
          visible: true,
          locked: false,
          selected: true,
          color: '#f08a4b',
          bounds: [-16, -4, -28, 28, -28, 28],
          stats: { points: 252, cells: 144, triangles: 144 },
          transform: { position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
        },
      ],
    },
    conversation: [],
  });

  const response = validateAgentResponse({
    kind: 'actionDraft',
    action: {
      id: 'rotate-color-selection',
      type: 'rotateMesh',
      target: { source: 'selection' },
      params: { axis: 'y', angleDeg: 30, pivot: 'boundsCenter', space: 'world' },
      source: 'agent',
      rawText: '把选中的橙色对象绕着 y 轴旋转 30 度',
      confirmed: false,
    },
    explanation: 'Rotate the selected orange object.',
    confidence: 0.9,
  }, colorRequest);

  assert.equal(response.kind, 'actionDraft');
  assert.deepEqual(response.action.target, { meshId: 'stator-vanes' });
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