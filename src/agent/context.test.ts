import { describe, expect, it } from 'vitest';
import { buildAgentContext } from './context';
import type { MeshEntity, OperationCommand } from '../domain/actions';
import type { HistoryEntry } from '../domain/history';
import type { SceneState } from '../domain/scene';

type MeshWithUnsafePayload = MeshEntity & {
  importedFileContents: string;
  vtkDataset: { raw: number[] };
};

const meshWithGeometry: MeshWithUnsafePayload = {
  id: 'fan-1',
  name: 'Turbofan stage',
  sourceFormat: 'procedural',
  visible: true,
  locked: false,
  selected: true,
  color: '#4fb3ff',
  opacity: 1,
  bounds: [-40, 40, -35, 35, -20, 20],
  stats: { points: 1200, cells: 800, triangles: 760 },
  transform: {
    position: [1, 2, 3],
    rotationDeg: [0, 15, 30],
    scale: [1, 1, 1],
  },
  clipping: {
    plane: { origin: [0, 0, 0], normal: [1, 0, 0] },
    keepSide: 'positive',
    cap: true,
  },
  geometry: {
    type: 'fanStage',
    bladeCount: 24,
    radius: 32,
    bladeLength: 18,
    bladeRadius: 1.2,
    x: 0,
  },
  importedFileContents: 'solid secret-stl-data facet normal 0 0 1 endsolid',
  vtkDataset: { raw: [1, 2, 3, 4, 5] },
};

const scene: SceneState = {
  unit: 'mm',
  displayMode: 'wireframe',
  selection: ['fan-1'],
  meshes: [meshWithGeometry],
};

describe('buildAgentContext', () => {
  it('summarizes scene metadata without raw geometry or imported data', () => {
    const context = buildAgentContext(scene);
    const meshContext = context.scene.meshes[0];
    const serialized = JSON.stringify(context);

    expect(context.scene).toMatchObject({
      unit: 'mm',
      displayMode: 'wireframe',
      selectedMeshIds: ['fan-1'],
    });
    expect(meshContext).toEqual({
      id: 'fan-1',
      name: 'Turbofan stage',
      visible: true,
      locked: false,
      source: 'procedural',
      stats: { points: 1200, cells: 800, triangles: 760 },
      bounds: [-40, 40, -35, 35, -20, 20],
      transform: {
        position: [1, 2, 3],
        rotationDeg: [0, 15, 30],
        scale: [1, 1, 1],
      },
      clipping: {
        active: true,
        plane: { origin: [0, 0, 0], normal: [1, 0, 0] },
        keepSide: 'positive',
        cap: true,
      },
    });
    expect(meshContext).not.toHaveProperty('geometry');
    expect(JSON.stringify(meshContext)).not.toContain('geometry');
    expect(serialized).not.toContain('secret-stl-data');
    expect(serialized).not.toContain('vtkDataset');
    expect(serialized).not.toContain('bladeCount');
  });

  it('keeps recent history to command type and compact raw text', () => {
    const historyEntries = Array.from({ length: 7 }, (_, index) => createHistoryEntry(index + 1));

    const context = buildAgentContext(scene, historyEntries);
    const serialized = JSON.stringify(context);

    expect(context.recentHistory).toHaveLength(5);
    expect(context.recentHistory.map((entry) => entry.type)).toEqual([
      'rotateMesh',
      'rotateMesh',
      'rotateMesh',
      'rotateMesh',
      'rotateMesh',
    ]);
    expect(context.recentHistory[0].rawText).toMatch(/^command 3 /);
    expect(context.recentHistory[0].rawText).not.toContain('\n');
    expect(context.recentHistory[0].rawText?.length).toBeLessThanOrEqual(160);
    expect(context.recentHistory[4].rawText).toMatch(/^command 7 /);
    expect(serialized).not.toContain('previous-geometry');
    expect(serialized).not.toContain('before-only-mesh');
    expect(serialized).not.toContain('after-only-mesh');
  });

  it('includes action names and safety rules for controlled agent output', () => {
    const context = buildAgentContext(scene);

    expect(context.supportedActions).toEqual([
      'selectMesh',
      'rotateMesh',
      'cloneMesh',
      'setMeshScale',
      'clipMesh',
      'resetView',
      'setMeshVisibility',
      'setMeshLocked',
      'setDisplayMode',
      'importMesh',
    ]);
    expect(context.safetyRules.join(' ')).toContain('Do not request raw geometry');
  });
});

function createHistoryEntry(index: number): HistoryEntry {
  const command: OperationCommand = {
    id: `history-${index}`,
    type: 'rotateMesh',
    target: { meshId: 'fan-1' },
    params: { axis: 'z', angleDeg: index * 5, pivot: 'boundsCenter', space: 'world' },
    source: 'agent',
    rawText: `command ${index}\n${'rotate the selected fan stage with extra wording '.repeat(8)}`,
  };

  return {
    id: command.id,
    command,
    before: sceneWithNamedGeometry('before-only-mesh', 'previous-geometry'),
    after: sceneWithNamedGeometry('after-only-mesh', 'previous-geometry'),
    timestamp: `2026-05-14T00:00:0${index}.000Z`,
  };
}

function sceneWithNamedGeometry(id: string, marker: string): SceneState {
  const mesh: MeshWithUnsafePayload = {
    ...meshWithGeometry,
    id,
    name: id,
    geometry: {
      type: 'box',
      center: [0, 0, 0],
      size: [1, 1, 1],
      opacity: 0.5,
    },
    importedFileContents: marker,
    vtkDataset: { raw: [9, 8, 7] },
  };

  return {
    ...scene,
    meshes: [mesh],
    selection: [id],
  };
}
