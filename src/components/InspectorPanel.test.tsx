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

const uiClipCommand: OperationCommand = {
  ...clipCommand,
  id: 'clip-ui-1',
  source: 'ui',
};

describe('InspectorPanel', () => {
  it('labels the right panel as an operation workspace with manual and AI assistant tabs', () => {
    render(
      <InspectorPanel
        scene={createInitialScene()}
        selectedMeshes={[]}
        historyEntries={[]}
        pendingCommand={null}
        onConfirmPending={vi.fn()}
        onCancelPending={vi.fn()}
        onExecute={vi.fn()}
        onHidePanel={vi.fn()}
      />,
    );

    expect(screen.getByText('操作台')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '隐藏操作台' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /手动/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /AI 助手/ })).toBeInTheDocument();
  });

  it('keeps the AI chat composer visible when no object is selected', () => {
    render(
      <InspectorPanel
        scene={createInitialScene()}
        selectedMeshes={[]}
        historyEntries={[]}
        pendingCommand={null}
        onConfirmPending={vi.fn()}
        onCancelPending={vi.fn()}
        onExecute={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('AI 指令输入')).toBeInTheDocument();
    expect(screen.getByText('未选择对象')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /属性/ })).not.toBeInTheDocument();
  });

  it('does not duplicate agent draft confirmation above the chat', () => {
    const props = {
      scene: createInitialScene(),
      selectedMeshes: [],
      historyEntries: [],
      onConfirmPending: vi.fn(),
      onCancelPending: vi.fn(),
      onExecute: vi.fn(),
    };

    render(<InspectorPanel {...props} pendingCommand={clipCommand} />);

    expect(screen.queryByText('待确认切割')).not.toBeInTheDocument();
    expect(screen.queryByText(/预览已经显示在视窗中/)).not.toBeInTheDocument();
  });

  it('uses contextual confirmation labels for non-agent pending operations', () => {
    const props = {
      scene: createInitialScene(),
      selectedMeshes: [],
      historyEntries: [],
      onConfirmPending: vi.fn(),
      onCancelPending: vi.fn(),
      onExecute: vi.fn(),
    };

    const { rerender } = render(<InspectorPanel {...props} pendingCommand={uiClipCommand} />);

    expect(screen.getByRole('button', { name: /确认应用/ })).toBeInTheDocument();

    rerender(<InspectorPanel {...props} pendingCommand={{ ...cloneCommand, source: 'ui' }} />);

    expect(screen.getByRole('button', { name: /确认复制/ })).toBeInTheDocument();
  });
});