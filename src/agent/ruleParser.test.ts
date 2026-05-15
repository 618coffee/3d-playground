import { describe, expect, it } from 'vitest';
import { createRuleParser } from './ruleParser';
import type { SceneState } from '../domain/scene';

const scene: SceneState = {
  meshes: [
    {
      id: 'fan-1',
      name: 'turbofan fan',
      sourceFormat: 'procedural',
      visible: true,
      locked: false,
      selected: true,
      color: '#4fb3ff',
      opacity: 1,
      bounds: [-40, 40, -40, 40, -20, 20],
      stats: { points: 120, cells: 80, triangles: 80 },
      transform: {
        position: [0, 0, 0],
        rotationDeg: [0, 0, 0],
        scale: [1, 1, 1],
      },
    },
    {
      id: 'fan-stage',
      name: 'Blue titanium fan stage',
      sourceFormat: 'procedural',
      visible: true,
      locked: false,
      selected: false,
      color: '#7bd389',
      opacity: 1,
      bounds: [-60, -20, -35, 35, -35, 35],
      stats: { points: 240, cells: 160, triangles: 160 },
      transform: {
        position: [-38, 0, 0],
        rotationDeg: [0, 0, 0],
        scale: [1, 1, 1],
      },
    },
    {
      id: 'compressor-core',
      name: 'Compressor core',
      sourceFormat: 'procedural',
      visible: true,
      locked: false,
      selected: false,
      color: '#f59e0b',
      opacity: 1,
      bounds: [-20, 35, -22, 22, -22, 22],
      stats: { points: 320, cells: 220, triangles: 220 },
      transform: {
        position: [8, 0, 0],
        rotationDeg: [0, 0, 0],
        scale: [1, 1, 1],
      },
    },
  ],
  selection: ['fan-1'],
  unit: 'mm',
  displayMode: 'surface',
};

describe('rule parser', () => {
  const parser = createRuleParser();

  it('parses Chinese rotation commands for current selection', () => {
    const result = parser.parse('把当前对象绕 Z 轴旋转 30 度', scene);

    expect(result.kind).toBe('action');
    if (result.kind !== 'action') return;
    expect(result.action.type).toBe('rotateMesh');
    expect(result.action.target).toEqual({ source: 'selection' });
    expect(result.action.params).toMatchObject({ axis: 'z', angleDeg: 30 });
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it('parses Chinese named-target rotation without falling back to selection', () => {
    const result = parser.parse('旋转 fan-stage 30 度', scene);

    expect(result.kind).toBe('action');
    if (result.kind !== 'action') return;
    expect(result.action.type).toBe('rotateMesh');
    expect(result.action.target).toEqual({ meshId: 'fan-stage' });
    expect(result.action.params).toMatchObject({ axis: 'z', angleDeg: 30 });
  });

  it('parses Chinese named-target selection', () => {
    const result = parser.parse('选择 fan', scene);

    expect(result.kind).toBe('action');
    if (result.kind !== 'action') return;
    expect(result.action.type).toBe('selectMesh');
    expect(result.action.target).toEqual({ name: 'fan', match: 'fuzzy' });
    expect(result.action.params).toEqual({ mode: 'replace' });
  });

  it('parses Chinese named-target clone commands', () => {
    const result = parser.parse('复制 compressor 2 个', scene);

    expect(result.kind).toBe('action');
    if (result.kind !== 'action') return;
    expect(result.action.type).toBe('cloneMesh');
    expect(result.action.target).toEqual({ meshId: 'compressor-core' });
    expect(result.action.params).toMatchObject({ count: 2, offset: [20, 0, 0], unit: 'mm' });
  });

  it('parses clone commands with count and x offset', () => {
    const result = parser.parse('复制选中对象 3 个，沿 X 方向间隔 20mm', scene);

    expect(result.kind).toBe('action');
    if (result.kind !== 'action') return;
    expect(result.action.type).toBe('cloneMesh');
    expect(result.action.params).toMatchObject({ count: 3, offset: [20, 0, 0], unit: 'mm' });
  });

  it('parses English rotate and clone commands with named targets', () => {
    const rotate = parser.parse('rotate fan-stage around z by 45 degrees', scene);
    const clone = parser.parse('clone compressor 2 copies along y offset 15mm', scene);

    expect(rotate.kind).toBe('action');
    if (rotate.kind !== 'action') return;
    expect(rotate.action.type).toBe('rotateMesh');
    expect(rotate.action.target).toEqual({ meshId: 'fan-stage' });
    expect(rotate.action.params).toMatchObject({ axis: 'z', angleDeg: 45 });

    expect(clone.kind).toBe('action');
    if (clone.kind !== 'action') return;
    expect(clone.action.type).toBe('cloneMesh');
    expect(clone.action.target).toEqual({ meshId: 'compressor-core' });
    expect(clone.action.params).toMatchObject({ count: 2, offset: [0, 15, 0] });
  });

  it('parses English select commands with named targets', () => {
    const result = parser.parse('select compressor', scene);

    expect(result.kind).toBe('action');
    if (result.kind !== 'action') return;
    expect(result.action.type).toBe('selectMesh');
    expect(result.action.target).toEqual({ meshId: 'compressor-core' });
  });

  it('parses center clip commands as preview actions requiring confirmation', () => {
    const result = parser.parse('沿 X=0 平面切开当前对象，只保留右半边', scene);

    expect(result.kind).toBe('action');
    if (result.kind !== 'action') return;
    expect(result.action.type).toBe('clipMesh');
    expect(result.action.params).toMatchObject({
      plane: { origin: [0, 0, 0], normal: [1, 0, 0] },
      keepSide: 'positive',
      mode: 'preview',
    });
    expect(result.requiresConfirmation).toBe(true);
  });

  it('parses axis-pair plane clips across the whole visible model', () => {
    const result = parser.parse('沿x,z平面切开整个模型，保留y轴正坐标部分', scene);

    expect(result.kind).toBe('action');
    if (result.kind !== 'action') return;
    expect(result.action.type).toBe('clipMesh');
    expect(result.action.target).toEqual({ source: 'allVisible' });
    expect(result.action.params).toMatchObject({
      plane: { origin: [0, 0, 0], normal: [0, 1, 0] },
      keepSide: 'positive',
      mode: 'preview',
    });
    expect(result.requiresConfirmation).toBe(true);
  });

  it('parses English clip side and origin for a named target', () => {
    const result = parser.parse('clip fan-stage along z at -5 keep lower side', scene);

    expect(result.kind).toBe('action');
    if (result.kind !== 'action') return;
    expect(result.action.type).toBe('clipMesh');
    expect(result.action.target).toEqual({ meshId: 'fan-stage' });
    expect(result.action.params).toMatchObject({
      plane: { origin: [0, 0, -5], normal: [0, 0, 1] },
      keepSide: 'negative',
      mode: 'preview',
    });
    expect(result.requiresConfirmation).toBe(true);
  });

  it('parses Chinese clip side and nonzero origin', () => {
    const result = parser.parse('沿 Y=10 平面切开 compressor，只保留前侧', scene);

    expect(result.kind).toBe('action');
    if (result.kind !== 'action') return;
    expect(result.action.type).toBe('clipMesh');
    expect(result.action.target).toEqual({ meshId: 'compressor-core' });
    expect(result.action.params).toMatchObject({
      plane: { origin: [0, 10, 0], normal: [0, 1, 0] },
      keepSide: 'positive',
    });
  });

  it('asks for an angle when a named rotation target omits the angle', () => {
    const result = parser.parse('旋转 fan-stage', { ...scene, selection: [] });

    expect(result.kind).toBe('clarification');
    if (result.kind !== 'clarification') return;
    expect(result.question).toContain('多少度');
  });

  it('asks for a target when no mesh is selected', () => {
    const result = parser.parse('旋转 30 度', { ...scene, selection: [] });

    expect(result.kind).toBe('clarification');
    if (result.kind !== 'clarification') return;
    expect(result.question).toContain('对象');
  });

  it('parses reset view commands', () => {
    const result = parser.parse('重置视角', scene);

    expect(result.kind).toBe('action');
    if (result.kind !== 'action') return;
    expect(result.action.type).toBe('resetView');
    expect(result.action.params).toEqual({ fit: 'visible', orientation: 'isometric' });
  });

  it('parses English reset view commands', () => {
    const result = parser.parse('reset view', scene);

    expect(result.kind).toBe('action');
    if (result.kind !== 'action') return;
    expect(result.action.type).toBe('resetView');
    expect(result.action.target).toEqual({ scope: 'viewer' });
  });
});
