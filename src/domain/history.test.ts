import { describe, expect, it } from 'vitest';
import { createInitialScene, cloneMeshEntity } from './scene';
import { createHistoryStore } from './history';
import type { MeshEntity, OperationCommand } from './actions';

const baseMesh: MeshEntity = {
  id: 'mesh-1',
  name: 'turbofan-core',
  sourceFormat: 'procedural',
  visible: true,
  locked: false,
  selected: true,
  color: '#4fb3ff',
  opacity: 1,
  bounds: [-1, 1, -1, 1, -1, 1],
  stats: { points: 24, cells: 12, triangles: 12 },
  transform: {
    position: [0, 0, 0],
    rotationDeg: [0, 0, 0],
    scale: [1, 1, 1],
  },
};

describe('history store', () => {
  it('records applied actions and restores previous scene on undo', () => {
    const initialScene = createInitialScene([baseMesh]);
    const history = createHistoryStore(initialScene);
    const command: OperationCommand = {
      id: 'act-1',
      type: 'rotateMesh',
      target: { meshId: 'mesh-1' },
      params: { axis: 'z', angleDeg: 45, pivot: 'boundsCenter', space: 'world' },
      source: 'agent',
      rawText: '把当前对象绕 Z 轴旋转 45 度',
    };

    history.record(command, {
      ...initialScene,
      meshes: [
        {
          ...baseMesh,
          transform: { ...baseMesh.transform, rotationDeg: [0, 0, 45] },
        },
      ],
      selection: ['mesh-1'],
    });

    expect(history.current().meshes[0].transform.rotationDeg).toEqual([0, 0, 45]);
    expect(history.entries()).toHaveLength(1);

    const undoResult = history.undo();

    expect(undoResult.status).toBe('applied');
    expect(history.current().meshes[0].transform.rotationDeg).toEqual([0, 0, 0]);
    expect(history.canRedo()).toBe(true);
  });

  it('clones mesh entities with independent identity and translated position', () => {
    const clone = cloneMeshEntity(baseMesh, {
      id: 'mesh-copy-1',
      name: 'turbofan-core-copy-1',
      offset: [20, 0, 0],
    });

    expect(clone.id).toBe('mesh-copy-1');
    expect(clone.name).toBe('turbofan-core-copy-1');
    expect(clone.transform.position).toEqual([20, 0, 0]);
    expect(clone.selected).toBe(false);
    expect(baseMesh.transform.position).toEqual([0, 0, 0]);
  });
});