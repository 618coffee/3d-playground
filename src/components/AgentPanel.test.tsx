import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentPanel } from './AgentPanel';
import { createInitialScene } from '../domain/scene';
import type { ActionResult } from '../domain/actions';
import type { AgentResponse } from '../domain/protocol';

const actionDraft: AgentResponse = {
  kind: 'actionDraft',
  action: {
    id: 'reset-1',
    type: 'resetView',
    target: { scope: 'viewer' },
    params: { fit: 'visible', orientation: 'isometric' },
    source: 'agent',
    rawText: '重置视角',
    confirmed: false,
  },
  explanation: '重置当前视角。',
  confidence: 0.91,
  risk: {
    level: 'low',
    summary: '浏览器内可撤销的查看器操作。',
    warnings: [],
    requiresConfirmation: false,
    reversible: true,
  },
};

const cloneDraft: AgentResponse = {
  kind: 'actionDraft',
  action: {
    id: 'clone-1',
    type: 'cloneMesh',
    target: { source: 'selection' },
    params: { count: 3, offset: [20, 0, 0], unit: 'mm', shareGeometry: true, namePattern: '{name}-copy-{n}' },
    source: 'agent',
    rawText: '将当前选中的对象复制 3 个，并沿世界坐标 X 方向按 20 mm 的间距依次排布。',
    confirmed: false,
  },
  explanation: '复制当前选中的对象。',
  confidence: 0.96,
  risk: {
    level: 'medium',
    summary: '需要确认复制预览。',
    warnings: [],
    requiresConfirmation: true,
    reversible: true,
  },
};

describe('AgentPanel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the LLM API label only in the prompt header without a footer frame', () => {
    render(
      <AgentPanel
        scene={createInitialScene()}
        historyEntries={[]}
        pendingCommand={null}
        onExecute={vi.fn()}
      />,
    );

    expect(screen.getByText('LLM API')).toBeInTheDocument();
    expect(screen.queryByText(/LLM API 已就绪/)).not.toBeInTheDocument();
    expect(document.querySelector('.agent-status-footer')).not.toBeInTheDocument();
  });

  it('lets users discard an action draft without executing it', async () => {
    const execute = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(actionDraft), { status: 200 })));

    render(
      <AgentPanel
        scene={createInitialScene()}
        historyEntries={[]}
        pendingCommand={null}
        onExecute={execute}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /解析审阅/ }));

    expect(await screen.findByRole('button', { name: /丢弃草稿/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /丢弃草稿/ }));

    expect(screen.getByText('暂无操作草稿。')).toBeInTheDocument();
    expect(execute).not.toHaveBeenCalled();
  });

  it('cancels a pending viewer preview when discarding the active draft', async () => {
    const execute = vi.fn();
    const cancelPending = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(actionDraft), { status: 200 })));

    const props = {
      scene: createInitialScene(),
      historyEntries: [],
      pendingCommand: actionDraft.action,
      onExecute: execute,
      onCancelPending: cancelPending,
    };

    render(<AgentPanel {...props} />);

    fireEvent.click(screen.getByRole('button', { name: /解析审阅/ }));
    fireEvent.click(await screen.findByRole('button', { name: /丢弃草稿/ }));

    expect(cancelPending).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
  });

  it('requests a viewer preview when a clone action draft arrives', async () => {
    const execute = vi.fn();
    const previewDraft = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(cloneDraft), { status: 200 })));

    render(
      <AgentPanel
        scene={createInitialScene()}
        historyEntries={[]}
        pendingCommand={null}
        onExecute={execute}
        onPreviewDraft={previewDraft}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /解析审阅/ }));

    await screen.findByRole('button', { name: /确认执行/ });

    expect(previewDraft).toHaveBeenCalledWith(cloneDraft.action);
    expect(execute).not.toHaveBeenCalled();
  });

  it('routes an active pending draft button to pending confirmation', async () => {
    const execute = vi.fn();
    const confirmPending = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(cloneDraft), { status: 200 })));

    render(
      <AgentPanel
        scene={createInitialScene()}
        historyEntries={[]}
        pendingCommand={cloneDraft.action}
        onExecute={execute}
        onConfirmPending={confirmPending}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /解析审阅/ }));
    fireEvent.click(await screen.findByRole('button', { name: /确认应用/ }));

    expect(confirmPending).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
  });

  it('clears a draft after its pending command is resolved outside the panel', async () => {
    const execute = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(cloneDraft), { status: 200 })));

    const { rerender } = render(
      <AgentPanel
        scene={createInitialScene()}
        historyEntries={[]}
        pendingCommand={cloneDraft.action}
        onExecute={execute}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /解析审阅/ }));
    expect(await screen.findByRole('button', { name: /确认应用/ })).toBeInTheDocument();

    rerender(
      <AgentPanel
        scene={createInitialScene()}
        historyEntries={[]}
        pendingCommand={null}
        onExecute={execute}
      />,
    );

    expect(await screen.findByText('暂无操作草稿。')).toBeInTheDocument();
  });

  it('clears an immediately applied action draft', async () => {
    const execute = vi.fn((): ActionResult => ({
      actionId: actionDraft.action.id,
      status: 'applied',
      message: '已重置视角。',
      affectedMeshIds: [],
      requiresConfirmation: false,
      warnings: [],
    }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(actionDraft), { status: 200 })));

    render(
      <AgentPanel
        scene={createInitialScene()}
        historyEntries={[]}
        pendingCommand={null}
        onExecute={execute}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /解析审阅/ }));
    fireEvent.click(await screen.findByRole('button', { name: /确认执行/ }));

    expect(await screen.findByText('暂无操作草稿。')).toBeInTheDocument();
  });
});