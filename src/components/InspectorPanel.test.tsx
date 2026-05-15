import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InspectorPanel } from './InspectorPanel';
import type { OperationCommand } from '../domain/actions';
import { createInitialScene } from '../domain/scene';

const clipCommand: OperationCommand = {
  id: 'clip-1',
  type: 'clipMesh',
  target: { source: 'allVisible' },
  params: {
    plane: { origin: [0, 0, 0], normal: [0, 1, 0] },
    keepSide: 'positive',
    mode: 'applyVisualClip',
    cap: true,
  },
  source: 'agent',
};

const cloneCommand: OperationCommand = {
  id: 'clone-1',
  type: 'cloneMesh',
  target: { source: 'selection' },
  params: { count: 3, offset: [20, 0, 0], unit: 'mm', shareGeometry: true, namePattern: '{name}-copy-{n}' },
  source: 'agent',
};

describe('InspectorPanel', () => {
  it('uses contextual confirmation labels for pending operations', () => {
    const props = {
      scene: createInitialScene(),
      selectedMeshes: [],
      historyEntries: [],
      onConfirmPending: vi.fn(),
      onCancelPending: vi.fn(),
      onExecute: vi.fn(),
    };

    const { rerender } = render(<InspectorPanel {...props} pendingCommand={clipCommand} />);

    expect(screen.getByRole('button', { name: /确认应用/ })).toBeInTheDocument();

    rerender(<InspectorPanel {...props} pendingCommand={cloneCommand} />);

    expect(screen.getByRole('button', { name: /确认复制/ })).toBeInTheDocument();
  });
});