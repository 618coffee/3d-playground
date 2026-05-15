import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentPanel } from './AgentPanel';
import { createInitialScene } from '../domain/scene';
import type { ActionResult, MeshEntity } from '../domain/actions';
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

  it('uses a compact send control and removes retry, stop, and parse-review actions', () => {
    render(
      <AgentPanel
        scene={createInitialScene()}
        selectedMeshes={[]}
        historyEntries={[]}
        pendingCommand={null}
        onExecute={vi.fn()}
      />,
    );

    expect(screen.getByText('LLM API')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发送指令' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /重试/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /停止/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /解析审阅/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/LLM API 已就绪/)).not.toBeInTheDocument();
    expect(document.querySelector('.agent-status-footer')).not.toBeInTheDocument();
  });

  it('places the model chip and send button in a footer below the full-width prompt input', () => {
    render(
      <AgentPanel
        scene={createInitialScene()}
        selectedMeshes={[]}
        historyEntries={[]}
        pendingCommand={null}
        onExecute={vi.fn()}
      />,
    );

    const input = screen.getByLabelText('AI 指令输入');
    const footer = document.querySelector('.agent-prompt-footer');
    const sendButton = screen.getByRole('button', { name: '发送指令' });

    expect(footer).toContainElement(screen.getByText('LLM API'));
    expect(footer).toContainElement(sendButton);
    expect(input.compareDocumentPosition(footer as Element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(input.parentElement).not.toBe(sendButton.parentElement);
  });

  it('renders selection context pills for empty, single, and multiple selections', () => {
    const meshA = createMesh('fan-stage', 'Blue titanium fan stage', true);
    const meshB = createMesh('compressor-core', 'Compressor core shaft', true);
    const scene = createInitialScene([meshA, meshB]);
    const props = {
      scene,
      historyEntries: [],
      pendingCommand: null,
      onExecute: vi.fn(),
    };

    const { rerender } = render(<AgentPanel {...props} selectedMeshes={[]} />);

    expect(screen.getByText('未选择对象')).toBeInTheDocument();

    rerender(<AgentPanel {...props} selectedMeshes={[meshA]} />);

    expect(screen.getByText('Blue titanium fan stage')).toBeInTheDocument();

    rerender(<AgentPanel {...props} selectedMeshes={[meshA, meshB]} />);

    expect(screen.getByText('2 个对象')).toBeInTheDocument();
    expect(screen.getByText('Blue titanium fan stage')).toBeInTheDocument();
    expect(screen.getByText('Compressor core shaft')).toBeInTheDocument();
  });

  it('lets users discard an action draft without executing it', async () => {
    const execute = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(actionDraft), { status: 200 })));

    render(
      <AgentPanel
        scene={createInitialScene()}
        selectedMeshes={[]}
        historyEntries={[]}
        pendingCommand={null}
        onExecute={execute}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '发送指令' }));

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
      selectedMeshes: [],
      historyEntries: [],
      pendingCommand: actionDraft.action,
      onExecute: execute,
      onCancelPending: cancelPending,
    };

    render(<AgentPanel {...props} />);

    fireEvent.click(screen.getByRole('button', { name: '发送指令' }));
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
        selectedMeshes={[]}
        historyEntries={[]}
        pendingCommand={null}
        onExecute={execute}
        onPreviewDraft={previewDraft}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '发送指令' }));

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
        selectedMeshes={[]}
        historyEntries={[]}
        pendingCommand={cloneDraft.action}
        onExecute={execute}
        onConfirmPending={confirmPending}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '发送指令' }));
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
        selectedMeshes={[]}
        historyEntries={[]}
        pendingCommand={cloneDraft.action}
        onExecute={execute}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '发送指令' }));
    expect(await screen.findByRole('button', { name: /确认应用/ })).toBeInTheDocument();

    rerender(
      <AgentPanel
        scene={createInitialScene()}
        selectedMeshes={[]}
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
        selectedMeshes={[]}
        historyEntries={[]}
        pendingCommand={null}
        onExecute={execute}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '发送指令' }));
    fireEvent.click(await screen.findByRole('button', { name: /确认执行/ }));

    expect(await screen.findByText('暂无操作草稿。')).toBeInTheDocument();
  });

  it('keeps the prompt editable while loading and aborts stale requests before resending', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      if (fetchMock.mock.calls.length === 1) {
        return new Promise<Response>((resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
          void resolve;
        });
      }
      return Promise.resolve(new Response(JSON.stringify(actionDraft), { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AgentPanel
        scene={createInitialScene()}
        selectedMeshes={[]}
        historyEntries={[]}
        pendingCommand={null}
        onExecute={vi.fn()}
      />,
    );

    const input = screen.getByLabelText('AI 指令输入');
    fireEvent.click(screen.getByRole('button', { name: '发送指令' }));

    expect(input).not.toBeDisabled();
    expect(screen.getByRole('button', { name: '停止生成' })).toBeInTheDocument();

    fireEvent.change(input, { target: { value: '重置视角' } });
    fireEvent.click(screen.getByRole('button', { name: '停止生成' }));

    expect((fetchMock.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).text).toBe('重置视角');
    expect(await screen.findByRole('button', { name: /确认执行/ })).toBeInTheDocument();
  });

  it('keeps the stop control enabled while loading even when the prompt is cleared', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      return new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        void resolve;
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AgentPanel
        scene={createInitialScene()}
        selectedMeshes={[]}
        historyEntries={[]}
        pendingCommand={null}
        onExecute={vi.fn()}
      />,
    );

    const input = screen.getByLabelText('AI 指令输入');
    fireEvent.click(screen.getByRole('button', { name: '发送指令' }));
    fireEvent.change(input, { target: { value: '' } });

    const stopButton = screen.getByRole('button', { name: '停止生成' });
    expect(stopButton).not.toBeDisabled();

    fireEvent.click(stopButton);

    expect((fetchMock.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
    expect(await screen.findByText('请求已取消。')).toBeInTheDocument();
  });

  it('ignores a cancelled response if an adapter resolves after abort', async () => {
    let resolveResponse: (value: Response) => void = () => undefined;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      void input;
      return new Promise<Response>((resolve) => {
        resolveResponse = resolve;
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AgentPanel
        scene={createInitialScene()}
        selectedMeshes={[]}
        historyEntries={[]}
        pendingCommand={null}
        onExecute={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '发送指令' }));
    fireEvent.click(screen.getByRole('button', { name: '停止生成' }));
    resolveResponse(new Response(JSON.stringify(actionDraft), { status: 200 }));

    expect(await screen.findByText('请求已取消。')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: /确认执行/ })).not.toBeInTheDocument());
  });
});

function createMesh(id: string, name: string, selected: boolean): MeshEntity {
  return {
    id,
    name,
    sourceFormat: 'procedural',
    visible: true,
    locked: false,
    selected,
    color: '#43b7ff',
    opacity: 1,
    bounds: [-1, 1, -1, 1, -1, 1],
    stats: { points: 8, cells: 6 },
    transform: { position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
  };
}