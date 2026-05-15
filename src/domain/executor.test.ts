import { describe, expect, it } from 'vitest';
import type { MeshEntity, OperationCommand } from './actions';
import { createOperationExecutor } from './executor';
import { createHistoryStore } from './history';
import { createInitialScene } from './scene';

const mesh: MeshEntity = {
  id: 'fan-1',
  name: 'turbofan fan',
  sourceFormat: 'procedural',
  visible: true,
  locked: false,
  selected: true,
  color: '#4fb3ff',
  opacity: 1,
  bounds: [-10, 10, -10, 10, -10, 10],
  stats: { points: 100, cells: 60, triangles: 60 },
  transform: {
    position: [0, 0, 0],
    rotationDeg: [0, 0, 0],
    scale: [1, 1, 1],
  },
};

describe('operation executor', () => {
  it('rotates selected meshes without recording history', () => {
    const history = createHistoryStore(createInitialScene([mesh]));
    const executor = createOperationExecutor(history);
    const command: OperationCommand = {
      id: 'rotate-1',
      type: 'rotateMesh',
      target: { source: 'selection' },
      params: { axis: 'z', angleDeg: 30, pivot: 'boundsCenter', space: 'world' },
      source: 'agent',
    };

    const result = executor.execute(command);

    expect(result.status).toBe('applied');
    expect(result.affectedMeshIds).toEqual(['fan-1']);
    expect(history.current().meshes[0].transform.rotationDeg).toEqual([0, 0, 30]);
    expect(history.entries()).toHaveLength(0);
  });

  it('skips repeated selection entries while keeping changed selections', () => {
    const otherMesh = { ...mesh, id: 'fan-2', name: 'second fan', selected: false };
    const history = createHistoryStore(createInitialScene([mesh, otherMesh]));
    const executor = createOperationExecutor(history);

    const repeated = executor.execute({
      id: 'select-same',
      type: 'selectMesh',
      target: { meshId: 'fan-1' },
      params: { mode: 'replace' },
      source: 'ui',
    });
    const changed = executor.execute({
      id: 'select-other',
      type: 'selectMesh',
      target: { meshId: 'fan-2' },
      params: { mode: 'replace' },
      source: 'ui',
    });
    executor.execute({
      id: 'select-other-again',
      type: 'selectMesh',
      target: { meshId: 'fan-2' },
      params: { mode: 'replace' },
      source: 'ui',
    });

    expect(repeated.message).toBe('选择未变化。');
    expect(changed.message).toBe('已更新选择。');
    expect(history.current().selection).toEqual(['fan-2']);
    expect(history.entries().map((entry) => entry.id)).toEqual(['select-other']);
  });

  it('clones selected mesh multiple times using incremental offsets', () => {
    const history = createHistoryStore(createInitialScene([mesh]));
    const executor = createOperationExecutor(history);

    executor.execute({
      id: 'clone-1',
      type: 'cloneMesh',
      target: { source: 'selection' },
      params: { count: 2, offset: [15, 0, 0], unit: 'mm', shareGeometry: true, namePattern: '{name}-copy-{n}' },
      source: 'ui',
    });

    const current = history.current();
    expect(current.meshes).toHaveLength(3);
    expect(current.meshes[1].transform.position).toEqual([15, 0, 0]);
    expect(current.meshes[2].transform.position).toEqual([30, 0, 0]);
  });

  it('requires confirmation before large clone commands are applied', () => {
    const history = createHistoryStore(createInitialScene([mesh]));
    const executor = createOperationExecutor(history);

    executor.execute({
      id: 'clone-a',
      type: 'cloneMesh',
      target: { source: 'selection' },
      params: { count: 2, offset: [10, 0, 0], unit: 'mm', shareGeometry: true, namePattern: '{name}-copy-{n}' },
      source: 'agent',
    });
    const preview = executor.execute({
      id: 'clone-b',
      type: 'cloneMesh',
      target: { source: 'selection' },
      params: { count: 1000, offset: [10, 0, 0], unit: 'mm', shareGeometry: true, namePattern: '{name}-copy-{n}' },
      source: 'agent',
    });

    expect(preview.status).toBe('preview');
    expect(preview.requiresConfirmation).toBe(true);

    executor.execute({
      id: 'clone-b',
      type: 'cloneMesh',
      target: { source: 'selection' },
      params: { count: 1000, offset: [10, 0, 0], unit: 'mm', shareGeometry: true, namePattern: '{name}-copy-{n}' },
      source: 'agent',
      confirmed: true,
    });

    const ids = history.current().meshes.map((item) => item.id);
    expect(ids).toHaveLength(15);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('creates clip previews that require confirmation', () => {
    const history = createHistoryStore(createInitialScene([mesh]));
    const executor = createOperationExecutor(history);
    const command: OperationCommand = {
      id: 'clip-1',
      type: 'clipMesh',
      target: { source: 'selection' },
      params: {
        plane: { origin: [0, 0, 0], normal: [1, 0, 0] },
        keepSide: 'positive',
        mode: 'preview',
        cap: true,
      },
      source: 'agent',
    };

    const result = executor.execute(command);

    expect(result.status).toBe('preview');
    expect(result.requiresConfirmation).toBe(true);
    expect(history.entries()).toHaveLength(0);
  });

  it('applies visual clips only after confirmation and stores them in history', () => {
    const history = createHistoryStore(createInitialScene([mesh]));
    const executor = createOperationExecutor(history);
    const command: OperationCommand = {
      id: 'clip-apply-1',
      type: 'clipMesh',
      target: { source: 'selection' },
      params: {
        plane: { origin: [5, 0, 0], normal: [1, 0, 0] },
        keepSide: 'negative',
        mode: 'applyVisualClip',
        cap: true,
      },
      source: 'agent',
    };

    expect(executor.execute(command).status).toBe('preview');

    const result = executor.execute({ ...command, confirmed: true });

    expect(result.status).toBe('applied');
    expect(history.current().meshes[0].clipping).toMatchObject({
      plane: { origin: [5, 0, 0], normal: [-1, 0, 0] },
      keepSide: 'negative',
    });
    expect(history.entries()).toHaveLength(1);
  });

  it('rejects baked geometry cuts in the MVP', () => {
    const history = createHistoryStore(createInitialScene([mesh]));
    const executor = createOperationExecutor(history);

    const result = executor.execute({
      id: 'clip-bake-1',
      type: 'clipMesh',
      target: { source: 'selection' },
      params: {
        plane: { origin: [0, 0, 0], normal: [1, 0, 0] },
        keepSide: 'positive',
        mode: 'bakeGeometry',
        cap: true,
      },
      source: 'agent',
      confirmed: true,
    });

    expect(result.status).toBe('failed');
    expect(history.entries()).toHaveLength(0);
  });

  it('records import, visibility, lock, and display mode operations', () => {
    const history = createHistoryStore(createInitialScene([mesh]));
    const executor = createOperationExecutor(history);
    const imported = { ...mesh, id: 'imported-1', name: 'imported pump', selected: true };

    executor.execute({ id: 'import-1', type: 'importMesh', target: { scope: 'scene' }, params: { mesh: imported }, source: 'ui' });
    executor.execute({ id: 'hide-1', type: 'setMeshVisibility', target: { meshId: 'imported-1' }, params: { visible: false }, source: 'ui' });
    executor.execute({ id: 'lock-1', type: 'setMeshLocked', target: { meshId: 'fan-1' }, params: { locked: true }, source: 'ui' });
    executor.execute({ id: 'display-1', type: 'setDisplayMode', target: { scope: 'viewer' }, params: { mode: 'wireframe' }, source: 'ui' });

    const current = history.current();
    expect(current.meshes).toHaveLength(2);
    expect(current.meshes.find((item) => item.id === 'imported-1')?.visible).toBe(false);
    expect(current.meshes.find((item) => item.id === 'fan-1')?.locked).toBe(true);
    expect(current.displayMode).toBe('wireframe');
    expect(history.entries()).toHaveLength(4);
  });

  it('can select hidden objects and hide locked objects without unlocking them', () => {
    const hidden = { ...mesh, id: 'hidden-1', name: 'hidden mesh', visible: false, selected: false };
    const locked = { ...mesh, id: 'locked-1', name: 'locked mesh', locked: true, selected: false };
    const history = createHistoryStore(createInitialScene([mesh, hidden, locked]));
    const executor = createOperationExecutor(history);

    const selectResult = executor.execute({
      id: 'select-hidden',
      type: 'selectMesh',
      target: { meshId: 'hidden-1' },
      params: { mode: 'replace' },
      source: 'ui',
    });
    const hideResult = executor.execute({
      id: 'hide-locked',
      type: 'setMeshVisibility',
      target: { meshId: 'locked-1' },
      params: { visible: false },
      source: 'ui',
    });
    const rotateResult = executor.execute({
      id: 'rotate-locked',
      type: 'rotateMesh',
      target: { meshId: 'locked-1' },
      params: { axis: 'z', angleDeg: 20, pivot: 'boundsCenter', space: 'world' },
      source: 'ui',
    });

    expect(selectResult.status).toBe('applied');
    expect(hideResult.status).toBe('applied');
    expect(rotateResult.status).toBe('failed');
    expect(history.current().meshes.find((item) => item.id === 'locked-1')?.visible).toBe(false);
  });

  it('rejects malformed agent payloads before touching scene state', () => {
    const history = createHistoryStore(createInitialScene([mesh]));
    const executor = createOperationExecutor(history);

    const result = executor.execute({
      id: 'bad-agent-command',
      type: 'rotateMesh',
      target: { meshId: 'fan-1' },
      params: { axis: 'z', angleDeg: 'thirty', pivot: 'boundsCenter', space: 'world' },
      source: 'agent',
    } as unknown as OperationCommand);

    expect(result.status).toBe('failed');
    expect(history.current().meshes[0].transform.rotationDeg).toEqual([0, 0, 0]);
    expect(history.entries()).toHaveLength(0);
  });
});
