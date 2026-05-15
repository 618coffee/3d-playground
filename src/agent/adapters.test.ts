import { describe, expect, it } from 'vitest';
import { createRuleParserAdapter, parseResultToAgentResponse } from './adapters';
import type { AgentParseResult } from './types';
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
      bounds: [-10, 10, -10, 10, -10, 10],
      stats: { points: 100, cells: 60, triangles: 60 },
      transform: { position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
    },
  ],
  selection: ['fan-1'],
  unit: 'mm',
  displayMode: 'surface',
};

describe('agent adapters', () => {
  it('wraps the local rule parser behind the async agent contract', async () => {
    const adapter = createRuleParserAdapter();

    const response = await adapter.respond({
      id: 'req-1',
      text: '把当前对象绕 Z 轴旋转 30 度',
      scene,
      conversation: [],
      pendingCommand: null,
    });

    expect(response.kind).toBe('actionDraft');
    if (response.kind !== 'actionDraft') return;
    expect(response.action.type).toBe('rotateMesh');
    expect(response.risk.requiresConfirmation).toBe(false);
  });

  it('maps parser confirmations into review risks', () => {
    const result: AgentParseResult = {
      kind: 'action',
      action: {
        id: 'clip-1',
        type: 'clipMesh',
        target: { source: 'selection' },
        params: { plane: { origin: [0, 0, 0], normal: [1, 0, 0] }, keepSide: 'positive', mode: 'preview', cap: true },
        source: 'agent',
      },
      confidence: 0.86,
      requiresConfirmation: true,
      explanation: 'Create a clip preview.',
    };

    const response = parseResultToAgentResponse(result);

    expect(response.kind).toBe('actionDraft');
    if (response.kind !== 'actionDraft') return;
    expect(response.risk.requiresConfirmation).toBe(true);
    expect(response.risk.warnings).toHaveLength(1);
  });
});
