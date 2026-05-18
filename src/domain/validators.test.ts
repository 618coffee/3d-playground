import { describe, expect, it } from 'vitest';
import type { MeshEntity, OperationCommand } from './actions';
import { validateAgentResponse, validateOperationCommand } from './validators';

const mesh: MeshEntity = {
  id: 'mesh-1',
  name: 'Fan stage',
  sourceFormat: 'procedural',
  visible: true,
  locked: false,
  selected: true,
  color: '#4fb3ff',
  opacity: 1,
  bounds: [-1, 1, -1, 1, -1, 1],
  stats: { points: 24, cells: 12, triangles: 12 },
  transform: { position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
};

describe('runtime validators', () => {
  it('accepts a supported operation command', () => {
    const command: OperationCommand = {
      id: 'rotate-1',
      type: 'rotateMesh',
      target: { meshId: 'mesh-1' },
      params: { axis: 'z', angleDeg: 30, pivot: 'boundsCenter', space: 'world' },
      source: 'agent',
    };

    expect(validateOperationCommand(command).ok).toBe(true);
  });

  it('accepts relative mesh move commands and rejects malformed offsets', () => {
    const command = {
      id: 'move-1',
      type: 'moveMesh',
      target: { meshId: 'mesh-1' },
      params: { offset: [10, -5, 2], unit: 'mm' },
      source: 'agent',
    };
    const badOffset = {
      ...command,
      id: 'move-bad-offset',
      params: { offset: [10, Number.NaN, 2], unit: 'mm' },
    };

    expect(validateOperationCommand(command).ok).toBe(true);
    expect(validateOperationCommand(badOffset).ok).toBe(false);
  });

  it('accepts mesh delete commands', () => {
    const command: OperationCommand = {
      id: 'delete-1',
      type: 'deleteMesh',
      target: { meshId: 'mesh-1' },
      params: {},
      source: 'ui',
    };

    expect(validateOperationCommand(command).ok).toBe(true);
  });

  it('rejects LLM-like commands with arbitrary tool names or malformed params', () => {
    const arbitraryTool = {
      id: 'tool-1',
      type: 'runJavaScript',
      target: { scope: 'viewer' },
      params: { code: 'window.vtk.deleteEverything()' },
      source: 'agent',
    };
    const badVector = {
      id: 'scale-1',
      type: 'setMeshScale',
      target: { meshId: 'mesh-1' },
      params: { scale: [1, Number.NaN, 1] },
      source: 'agent',
    };

    expect(validateOperationCommand(arbitraryTool).ok).toBe(false);
    expect(validateOperationCommand(badVector).ok).toBe(false);
  });

  it('validates action drafts and action plans recursively', () => {
    const action: OperationCommand = {
      id: 'select-1',
      type: 'selectMesh',
      target: { meshId: 'mesh-1' },
      params: { mode: 'replace' },
      source: 'agent',
    };

    expect(validateAgentResponse({
      kind: 'actionDraft',
      action,
      explanation: 'Select the fan stage.',
      confidence: 0.92,
      risk: { level: 'low', summary: 'Selection only.', warnings: [], requiresConfirmation: false, reversible: true },
    }).ok).toBe(true);

    expect(validateAgentResponse({
      kind: 'actionPlan',
      explanation: 'Select then reset.',
      risk: { level: 'low', summary: 'Viewer-only steps.', warnings: [], requiresConfirmation: false, reversible: true },
      steps: [
        { id: 'step-1', title: 'Select fan', action },
        {
          id: 'step-2',
          title: 'Reset view',
          action: { id: 'reset-1', type: 'resetView', target: { scope: 'viewer' }, params: { fit: 'visible', orientation: 'isometric' }, source: 'agent' },
        },
      ],
    }).ok).toBe(true);
  });

  it('validates imported mesh metadata without requiring raw geometry', () => {
    const command: OperationCommand = {
      id: 'import-1',
      type: 'importMesh',
      target: { scope: 'scene' },
      params: { mesh },
      source: 'ui',
    };

    expect(validateOperationCommand(command).ok).toBe(true);
  });
});
