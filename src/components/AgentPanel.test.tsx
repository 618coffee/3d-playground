import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentPanel } from './AgentPanel';
import { AGENT_CHAT_SESSIONS_STORAGE_KEY, appendAgentChatMessage, createAgentChatSession } from '../agent/chatSessions';
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

const actionPlan: AgentResponse = {
  kind: 'actionPlan',
  steps: [
    {
      id: 'step-1',
      title: '重置视角',
      action: actionDraft.action,
    },
    {
      id: 'step-2',
      title: '复制对象',
      action: cloneDraft.action,
    },
  ],
  explanation: '先重置视角，再复制当前对象。',
  risk: {
    level: 'medium',
    summary: '需要逐步检查计划。',
    warnings: [],
    requiresConfirmation: true,
    reversible: true,
  },
};

describe('AgentPanel', () => {
  beforeEach(() => {
    installLocalStorageStub();
  });

  afterEach(() => {
    cleanup();
    clearAgentChatStorage();
    vi.unstubAllGlobals();
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

    expect(screen.getByLabelText('模型 router')).toHaveValue('default-router');
    expect(screen.getByLabelText('AI mode')).toHaveValue('edit');
    expect(screen.getByRole('option', { name: 'Ask' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Agent' })).toBeInTheDocument();
    expect(screen.getByLabelText('AI 指令输入')).toHaveValue('');
    expect(screen.getByRole('button', { name: '发送指令' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /重试/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /停止/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /解析审阅/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/LLM API 已就绪/)).not.toBeInTheDocument();
    expect(document.querySelector('.agent-status-footer')).not.toBeInTheDocument();
  });

  it('keeps the history drawer mounted with collapsed and expanded states', () => {
    render(
      <AgentPanel
        scene={createInitialScene()}
        selectedMeshes={[]}
        historyEntries={[]}
        pendingCommand={null}
        onExecute={vi.fn()}
      />,
    );

    const drawer = document.querySelector('.agent-session-picker') as HTMLElement;
    expect(drawer).toHaveClass('is-collapsed');
    expect(drawer).toHaveAttribute('aria-hidden', 'true');

    fireEvent.click(screen.getByRole('button', { name: '历史会话' }));

    expect(drawer).toHaveClass('is-open');
    expect(drawer).not.toHaveAttribute('aria-hidden');
  });

  it('places the mode selector, model selector, and send button on one row below the input', () => {
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
    const mode = screen.getByLabelText('AI mode');
    const router = screen.getByLabelText('模型 router');
    const sendButton = screen.getByRole('button', { name: '发送指令' });
    const composer = screen.getByRole('region', { name: 'AI composer' });
    const controls = document.querySelector('.agent-composer-controls');

    expect(router).toHaveValue('default-router');
    expect(mode).toHaveValue('edit');
    expect(composer).toContainElement(input);
    expect(composer).toContainElement(mode);
    expect(composer).toContainElement(router);
    expect(composer).toContainElement(sendButton);
    expect(controls).toContainElement(mode);
    expect(controls).toContainElement(router);
    expect(controls).toContainElement(sendButton);
    expect(input.compareDocumentPosition(controls as Element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders starter suggestions only for an empty session and uses a bottom composer surface', async () => {
    clearAgentChatStorage();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ kind: 'message', text: '已收到。' }), { status: 200 })));

    render(
      <AgentPanel
        scene={createInitialScene()}
        selectedMeshes={[]}
        historyEntries={[]}
        pendingCommand={null}
        onExecute={vi.fn()}
      />,
    );

    const composer = screen.getByRole('region', { name: 'AI composer' });
    const starterPrompt = '把当前对象绕 Z 轴旋转 30 度';

    expect(screen.getByRole('button', { name: starterPrompt })).toBeInTheDocument();
    expect(composer).toHaveClass('agent-composer');
    expect(composer).toContainElement(screen.getByLabelText('AI 指令输入'));

    fireEvent.change(screen.getByLabelText('AI 指令输入'), { target: { value: '解释当前场景' } });
    fireEvent.click(screen.getByRole('button', { name: '发送指令' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: starterPrompt })).not.toBeInTheDocument());

    expect(screen.queryByRole('button', { name: starterPrompt })).not.toBeInTheDocument();
  });

  it('sends session mode and model router metadata with agent requests', async () => {
    clearAgentChatStorage();
    const requestBodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ kind: 'message', text: '当前场景包含默认对象。' }), { status: 200 });
    }));

    render(
      <AgentPanel
        scene={createInitialScene()}
        selectedMeshes={[]}
        historyEntries={[]}
        pendingCommand={null}
        onExecute={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('AI mode'), { target: { value: 'ask' } });
    fireEvent.change(screen.getByLabelText('AI 指令输入'), { target: { value: '解释当前场景' } });
    fireEvent.click(screen.getByRole('button', { name: '发送指令' }));

    await waitFor(() => expect(requestBodies).toHaveLength(1));
    const requestBody = requestBodies[0];
    expect(requestBody?.sessionId).toEqual(expect.stringMatching(/.+/));
    expect(requestBody?.mode).toBe('ask');
    expect(requestBody?.modelRouterId).toBe('default-router');
    expect(requestBody?.conversation).toEqual([
      expect.objectContaining({ role: 'user', text: '解释当前场景' }),
    ]);
    expect(requestBody?.scene).toMatchObject({ unit: 'mm', displayMode: 'surface' });
    expect(requestBody?.pendingCommand).toBeNull();
    expect(requestBody?.context).toMatchObject({
      scene: expect.objectContaining({ unit: 'mm', displayMode: 'surface' }),
      supportedActions: expect.arrayContaining(['rotateMesh', 'resetView']),
      safetyRules: expect.any(Array),
    });
    await waitFor(() => expect(screen.getByLabelText('AI 指令输入')).toHaveValue(''));
  });

  it('does not execute action drafts returned while in Ask mode', async () => {
    const execute = vi.fn();
    const previewDraft = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(actionDraft), { status: 200 })));

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

    fireEvent.change(screen.getByLabelText('AI mode'), { target: { value: 'ask' } });
    fireEvent.change(screen.getByLabelText('AI 指令输入'), { target: { value: '重置视角' } });
    fireEvent.click(screen.getByRole('button', { name: '发送指令' }));

    expect(await screen.findByText(/Ask 模式/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /确认(执行|应用)/ })).not.toBeInTheDocument();
    expect(previewDraft).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('asks users to switch to Agent mode when Edit receives a plan', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(actionPlan), { status: 200 })));

    render(
      <AgentPanel
        scene={createInitialScene()}
        selectedMeshes={[]}
        historyEntries={[]}
        pendingCommand={null}
        onExecute={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('AI 指令输入'), { target: { value: '规划两步操作' } });
    fireEvent.click(screen.getByRole('button', { name: '发送指令' }));

    expect(await screen.findByText(/请切换到 Agent 模式/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /逐步执行/ })).not.toBeInTheDocument();
  });

  it('allows action plans while in Agent mode', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(actionPlan), { status: 200 })));

    render(
      <AgentPanel
        scene={createInitialScene()}
        selectedMeshes={[]}
        historyEntries={[]}
        pendingCommand={null}
        onExecute={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('AI mode'), { target: { value: 'agent' } });
    fireEvent.change(screen.getByLabelText('AI 指令输入'), { target: { value: '规划两步操作' } });
    fireEvent.click(screen.getByRole('button', { name: '发送指令' }));

    expect(await screen.findByRole('button', { name: /逐步执行/ })).toBeInTheDocument();
  });

  it('creates new sessions and reopens prior chat history', async () => {
    clearAgentChatStorage();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(actionDraft), { status: 200 })));

    render(
      <AgentPanel
        scene={createInitialScene()}
        selectedMeshes={[]}
        historyEntries={[]}
        pendingCommand={null}
        onExecute={vi.fn()}
      />,
    );

    const prompt = '把当前对象绕 Z 轴旋转 30 度';
    fireEvent.change(screen.getByLabelText('AI 指令输入'), { target: { value: prompt } });
    fireEvent.click(screen.getByRole('button', { name: '发送指令' }));

    expect(await screen.findByRole('button', { name: /确认执行/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '新建聊天' }));

    await waitFor(() => expect(within(screen.getByLabelText('AI conversation feed')).queryByText(prompt)).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '历史会话' }));
    fireEvent.click(within(screen.getByLabelText('历史会话列表')).getByRole('button', { name: prompt }));

    expect(await within(screen.getByLabelText('AI conversation feed')).findByText(prompt)).toBeInTheDocument();
  });

  it('shows sent user requests as labeled chat pills and stacks agent replies below their label', async () => {
    clearAgentChatStorage();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ kind: 'message', text: '当前场景包含默认对象。' }), { status: 200 })));

    render(
      <AgentPanel
        scene={createInitialScene()}
        selectedMeshes={[]}
        historyEntries={[]}
        pendingCommand={null}
        onExecute={vi.fn()}
      />,
    );

    const prompt = '解释当前场景';
    fireEvent.change(screen.getByLabelText('AI 指令输入'), { target: { value: prompt } });
    fireEvent.click(screen.getByRole('button', { name: '发送指令' }));

    const feed = screen.getByLabelText('AI conversation feed');
    const userMessage = await within(feed).findByText(prompt);
    const userRow = userMessage.closest('.agent-message');
    const agentResponse = (await within(feed).findAllByText('当前场景包含默认对象。'))[0];
    const agentRow = agentResponse.closest('.agent-message');

    expect(userRow).toHaveClass('user');
    expect(userMessage.closest('.agent-chat-pill')).toBeTruthy();
    expect(within(userRow as HTMLElement).getByText('You')).toBeInTheDocument();
    expect(agentRow).toHaveClass('assistant');
    expect(within(agentRow as HTMLElement).getByText('Agent')).toBeInTheDocument();
    expect(agentRow?.children[0]).toHaveTextContent('Agent');
    expect(agentRow?.children[1]).toContainElement(agentResponse);
    expect(within(feed).getAllByText('当前场景包含默认对象。')).toHaveLength(1);
    expect(within(feed).queryByText('AI 回复')).not.toBeInTheDocument();
    expect(screen.queryByText('Idle')).not.toBeInTheDocument();
    expect(screen.queryByText('Ready')).not.toBeInTheDocument();
  });

  it('deletes chat history sessions from the history picker', async () => {
    clearAgentChatStorage();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ kind: 'message', text: '已收到。' }), { status: 200 })));

    render(
      <AgentPanel
        scene={createInitialScene()}
        selectedMeshes={[]}
        historyEntries={[]}
        pendingCommand={null}
        onExecute={vi.fn()}
      />,
    );

    const firstPrompt = '解释当前场景';
    fireEvent.change(screen.getByLabelText('AI 指令输入'), { target: { value: firstPrompt } });
    fireEvent.click(screen.getByRole('button', { name: '发送指令' }));
    await within(screen.getByLabelText('AI conversation feed')).findByText(firstPrompt);

    fireEvent.click(screen.getByRole('button', { name: '新建聊天' }));
    fireEvent.click(screen.getByRole('button', { name: '历史会话' }));
    fireEvent.click(within(screen.getByLabelText('历史会话列表')).getByRole('button', { name: `删除 ${firstPrompt}` }));

    expect(within(screen.getByLabelText('历史会话列表')).queryByRole('button', { name: firstPrompt })).not.toBeInTheDocument();
    expect(within(screen.getByLabelText('AI conversation feed')).queryByText(firstPrompt)).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(AGENT_CHAT_SESSIONS_STORAGE_KEY) ?? '[]')).toEqual([
      expect.objectContaining({ messages: [] }),
    ]);
  });

  it('keeps the active response actionable when reselecting the current history session', async () => {
    const cancelPending = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(cloneDraft), { status: 200 })));

    render(
      <AgentPanel
        scene={createInitialScene()}
        selectedMeshes={[]}
        historyEntries={[]}
        pendingCommand={cloneDraft.action}
        onExecute={vi.fn()}
        onConfirmPending={vi.fn()}
        onCancelPending={cancelPending}
      />,
    );

    const prompt = '复制当前对象';
    fireEvent.change(screen.getByLabelText('AI 指令输入'), { target: { value: prompt } });
    fireEvent.click(screen.getByRole('button', { name: '发送指令' }));
    expect(await screen.findByRole('button', { name: /确认应用/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '历史会话' }));
    fireEvent.click(within(screen.getByLabelText('历史会话列表')).getByRole('button', { name: prompt }));

    expect(cancelPending).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /确认应用/ })).toBeInTheDocument();
    expect(screen.queryByText('历史草稿仅供查看')).not.toBeInTheDocument();
  });

  it('ignores an in-flight response after starting a new chat', async () => {
    let resolveResponse: (value: Response) => void = () => undefined;
    const previewDraft = vi.fn();
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    })));

    render(
      <AgentPanel
        scene={createInitialScene()}
        selectedMeshes={[]}
        historyEntries={[]}
        pendingCommand={null}
        onExecute={vi.fn()}
        onPreviewDraft={previewDraft}
      />,
    );

    fireEvent.change(screen.getByLabelText('AI 指令输入'), { target: { value: '复制当前对象' } });
    fireEvent.click(screen.getByRole('button', { name: '发送指令' }));
    fireEvent.click(screen.getByRole('button', { name: '新建聊天' }));

    await act(async () => {
      resolveResponse(new Response(JSON.stringify(actionDraft), { status: 200 }));
    });

    expect(previewDraft).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /确认执行/ })).not.toBeInTheDocument();
    expect(screen.getByText('准备审阅操作草稿。')).toBeInTheDocument();
  });

  it('cancels a pending viewer preview when switching to a new chat', async () => {
    const cancelPending = vi.fn();
    const requestBodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ kind: 'message', text: '新的会话。' }), { status: 200 });
    }));

    render(
      <AgentPanel
        scene={createInitialScene()}
        selectedMeshes={[]}
        historyEntries={[]}
        pendingCommand={actionDraft.action}
        onExecute={vi.fn()}
        onCancelPending={cancelPending}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '新建聊天' }));
    expect(cancelPending).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText('AI 指令输入'), { target: { value: '解释当前场景' } });
    fireEvent.click(screen.getByRole('button', { name: '发送指令' }));

    await waitFor(() => expect(requestBodies).toHaveLength(1));
    expect(requestBodies[0]?.pendingCommand).toBeNull();
  });

  it('restores the latest assistant response from persisted sessions on initial load', () => {
    const session = appendAgentChatMessage(createAgentChatSession({ meshCount: 0, selectedMeshIds: [], historyCount: 0 }), {
      role: 'assistant',
      text: '重置视角 已生成，确认前请检查参数。',
      response: actionDraft,
    });
    localStorage.setItem(AGENT_CHAT_SESSIONS_STORAGE_KEY, JSON.stringify([session]));

    const execute = vi.fn();
    render(
      <AgentPanel
        scene={createInitialScene()}
        selectedMeshes={[]}
        historyEntries={[]}
        pendingCommand={null}
        onExecute={execute}
      />,
    );

    expect(screen.getByText('历史草稿仅供查看')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /确认执行/ })).not.toBeInTheDocument();
    expect(execute).not.toHaveBeenCalled();
  });

  it('omits a discarded pending preview from the next request', async () => {
    const cancelPending = vi.fn();
    const requestBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify(fetchMock.mock.calls.length === 1 ? actionDraft : { kind: 'message', text: '下一次请求。' }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AgentPanel
        scene={createInitialScene()}
        selectedMeshes={[]}
        historyEntries={[]}
        pendingCommand={actionDraft.action}
        onExecute={vi.fn()}
        onCancelPending={cancelPending}
      />,
    );

    fireEvent.change(screen.getByLabelText('AI 指令输入'), { target: { value: '重置视角' } });
    fireEvent.click(screen.getByRole('button', { name: '发送指令' }));
    fireEvent.click(await screen.findByRole('button', { name: /丢弃草稿/ }));
    expect(cancelPending).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText('AI 指令输入'), { target: { value: '解释当前场景' } });
    fireEvent.click(screen.getByRole('button', { name: '发送指令' }));

    await waitFor(() => expect(requestBodies).toHaveLength(2));
    expect(requestBodies[1]?.pendingCommand).toBeNull();
  });

  it('keeps a restored history draft visible after its cancelled pending preview clears in the parent', async () => {
    const cancelPending = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(actionDraft), { status: 200 })));

    const props = {
      scene: createInitialScene(),
      selectedMeshes: [],
      historyEntries: [],
      pendingCommand: null,
      onExecute: vi.fn(),
      onCancelPending: cancelPending,
    };
    const { rerender } = render(<AgentPanel {...props} />);

    const firstPrompt = '重置视角';
    fireEvent.change(screen.getByLabelText('AI 指令输入'), { target: { value: firstPrompt } });
    fireEvent.click(screen.getByRole('button', { name: '发送指令' }));
    expect(await screen.findByRole('button', { name: /确认执行/ })).toBeInTheDocument();

    rerender(<AgentPanel {...props} pendingCommand={actionDraft.action} />);
    fireEvent.click(screen.getByRole('button', { name: '新建聊天' }));
    expect(cancelPending).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '历史会话' }));
    fireEvent.click(within(screen.getByLabelText('历史会话列表')).getByRole('button', { name: firstPrompt }));
    expect(screen.getByText('历史草稿仅供查看')).toBeInTheDocument();

    rerender(<AgentPanel {...props} pendingCommand={null} />);

    expect(screen.getByText('历史草稿仅供查看')).toBeInTheDocument();
  });

  it('opens history during an in-flight request without leaving loading state', async () => {
    const signals: AbortSignal[] = [];
    let resolveSecondResponse: (value: Response) => void = () => undefined;
    const previewDraft = vi.fn();
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal);
      if (fetchMock.mock.calls.length === 1) {
        return Promise.resolve(new Response(JSON.stringify(actionDraft), { status: 200 }));
      }

      return new Promise<Response>((resolve) => {
        resolveSecondResponse = resolve;
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
        onPreviewDraft={previewDraft}
      />,
    );

    const firstPrompt = '重置视角';
    fireEvent.change(screen.getByLabelText('AI 指令输入'), { target: { value: firstPrompt } });
    fireEvent.click(screen.getByRole('button', { name: '发送指令' }));
    expect(await screen.findByRole('button', { name: /确认执行/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '新建聊天' }));
    fireEvent.change(screen.getByLabelText('AI 指令输入'), { target: { value: '复制当前对象' } });
    fireEvent.click(screen.getByRole('button', { name: '发送指令' }));
    expect(screen.getByRole('button', { name: '停止生成' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '历史会话' }));
    fireEvent.click(within(screen.getByLabelText('历史会话列表')).getByRole('button', { name: firstPrompt }));

    expect(signals[1]?.aborted).toBe(true);
    expect(screen.queryByRole('button', { name: '停止生成' })).not.toBeInTheDocument();
    expect(screen.queryByText('Idle')).not.toBeInTheDocument();

    await act(async () => {
      resolveSecondResponse(new Response(JSON.stringify(cloneDraft), { status: 200 }));
    });

    expect(previewDraft).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('复制对象')).not.toBeInTheDocument();
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

  it('shows only selection context above the composer input', () => {
    const mesh = createMesh('fan-stage', 'Blue titanium fan stage', true);
    const scene = createInitialScene([mesh]);
    const historyEntry = {
      id: 'history-1',
      command: actionDraft.action,
      before: scene,
      after: scene,
      timestamp: '2026-05-16T10:00:00.000Z',
    };

    render(
      <AgentPanel
        scene={scene}
        selectedMeshes={[mesh]}
        historyEntries={[historyEntry]}
        pendingCommand={actionDraft.action}
        onExecute={vi.fn()}
      />,
    );

    const composer = screen.getByRole('region', { name: 'AI composer' });

    expect(within(composer).getByText('Blue titanium fan stage')).toBeInTheDocument();
    expect(within(composer).queryByText('Scene')).not.toBeInTheDocument();
    expect(within(composer).queryByText('1 history')).not.toBeInTheDocument();
    expect(within(composer).queryByText('Pending draft')).not.toBeInTheDocument();
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

    fireEvent.change(screen.getByLabelText('AI 指令输入'), { target: { value: '重置视角' } });
    fireEvent.click(screen.getByRole('button', { name: '发送指令' }));

    expect(await screen.findByRole('button', { name: /丢弃草稿/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /丢弃草稿/ }));

    expect(screen.getByText('已丢弃操作草稿。')).toBeInTheDocument();
    expect(screen.getByText('历史草稿仅供查看')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /确认执行/ })).not.toBeInTheDocument();
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

    fireEvent.change(screen.getByLabelText('AI 指令输入'), { target: { value: '解释当前场景' } });
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

    fireEvent.change(screen.getByLabelText('AI 指令输入'), { target: { value: '复制当前对象' } });
    fireEvent.click(screen.getByRole('button', { name: '发送指令' }));

    await screen.findByRole('button', { name: /确认执行/ });

    expect(previewDraft).toHaveBeenCalledWith(cloneDraft.action);
    expect(execute).not.toHaveBeenCalled();
  });

  it('renders generated response cards exactly once inside the conversation feed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(actionDraft), { status: 200 })));

    render(
      <AgentPanel
        scene={createInitialScene()}
        selectedMeshes={[]}
        historyEntries={[]}
        pendingCommand={null}
        onExecute={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('AI 指令输入'), { target: { value: '重置视角' } });
    fireEvent.click(screen.getByRole('button', { name: '发送指令' }));

    const feed = screen.getByLabelText('AI conversation feed');
    await within(feed).findByRole('button', { name: /确认执行/ });

    expect(within(feed).getAllByText('操作草稿')).toHaveLength(1);
    expect(screen.getAllByText('操作草稿')).toHaveLength(1);
  });

  it('summarizes action drafts without duplicate operation fields and names selected targets', async () => {
    const selectedMesh = createMesh('fan-stage', 'Blue titanium fan stage', true);
    const scene = createInitialScene([selectedMesh]);
    const draft: AgentResponse = {
      ...cloneDraft,
      explanation: '复制当前选中的对象。',
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(draft), { status: 200 })));

    render(
      <AgentPanel
        scene={scene}
        selectedMeshes={[selectedMesh]}
        historyEntries={[]}
        pendingCommand={null}
        onExecute={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('AI 指令输入'), { target: { value: '复制当前对象' } });
    fireEvent.click(screen.getByRole('button', { name: '发送指令' }));

    await screen.findByRole('button', { name: /确认执行/ });
    const summaryGrid = document.querySelector('.agent-review-grid') as HTMLElement;

    expect(summaryGrid).toBeTruthy();
    expect(within(summaryGrid).queryByText('操作')).not.toBeInTheDocument();
    expect(within(summaryGrid).queryByText('cloneMesh')).not.toBeInTheDocument();
    expect(within(summaryGrid).queryByText('当前选择')).not.toBeInTheDocument();
    expect(within(summaryGrid).getByText('Blue titanium fan stage')).toBeInTheDocument();
  });

  it('makes the previous executable response read-only when a newer request starts', async () => {
    let resolveSecondResponse: (value: Response) => void = () => undefined;
    const cancelPending = vi.fn();
    const requestBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      if (fetchMock.mock.calls.length === 1) {
        return Promise.resolve(new Response(JSON.stringify(actionDraft), { status: 200 }));
      }

      return new Promise<Response>((resolve) => {
        resolveSecondResponse = resolve;
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const props = {
      scene: createInitialScene(),
      selectedMeshes: [],
      historyEntries: [],
      pendingCommand: null,
      onExecute: vi.fn(),
      onCancelPending: cancelPending,
    };
    const { rerender } = render(
      <AgentPanel
        {...props}
      />,
    );

    fireEvent.change(screen.getByLabelText('AI 指令输入'), { target: { value: '重置视角' } });
    fireEvent.click(screen.getByRole('button', { name: '发送指令' }));
    expect(await screen.findByRole('button', { name: /确认执行/ })).toBeInTheDocument();

    rerender(<AgentPanel {...props} pendingCommand={actionDraft.action} />);
    fireEvent.change(screen.getByLabelText('AI 指令输入'), { target: { value: '解释当前场景' } });
    fireEvent.click(screen.getByRole('button', { name: '发送指令' }));

    expect(cancelPending).toHaveBeenCalledTimes(1);
    expect(requestBodies[1]?.pendingCommand).toBeNull();
    expect(screen.getByText('历史草稿仅供查看')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /确认执行/ })).not.toBeInTheDocument();

    await act(async () => {
      resolveSecondResponse(new Response(JSON.stringify({ kind: 'message', text: '说明已生成。' }), { status: 200 }));
    });
  });

  it('executes inline action plan steps and keeps restored plans read-only', async () => {
    const execute = vi.fn((): ActionResult => ({
      actionId: 'step-action',
      status: 'applied',
      message: '已执行计划步骤。',
      affectedMeshIds: [],
      requiresConfirmation: false,
      warnings: [],
    }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(actionPlan), { status: 200 })));

    const { unmount } = render(
      <AgentPanel
        scene={createInitialScene()}
        selectedMeshes={[]}
        historyEntries={[]}
        pendingCommand={null}
        onExecute={execute}
      />,
    );

    fireEvent.change(screen.getByLabelText('AI mode'), { target: { value: 'agent' } });
    fireEvent.change(screen.getByLabelText('AI 指令输入'), { target: { value: '规划两步操作' } });
    fireEvent.click(screen.getByRole('button', { name: '发送指令' }));
    fireEvent.click(await screen.findByRole('button', { name: /逐步执行/ }));

    expect(execute).toHaveBeenCalledTimes(2);
    expect(screen.getByText('计划步骤已全部提交。')).toBeInTheDocument();

    unmount();
    cleanup();

    const session = appendAgentChatMessage(createAgentChatSession({ meshCount: 0, selectedMeshIds: [], historyCount: 0 }), {
      role: 'assistant',
      text: '计划 2 步，确认前请检查每一步。',
      response: actionPlan,
    });
    localStorage.setItem(AGENT_CHAT_SESSIONS_STORAGE_KEY, JSON.stringify([session]));

    render(
      <AgentPanel
        scene={createInitialScene()}
        selectedMeshes={[]}
        historyEntries={[]}
        pendingCommand={null}
        onExecute={execute}
      />,
    );

    expect(screen.getByText('历史草稿仅供查看')).toBeInTheDocument();
    expect(screen.getByText('重置视角')).toBeInTheDocument();
    expect(screen.getByText('复制对象')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /逐步执行/ })).not.toBeInTheDocument();
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

    fireEvent.change(screen.getByLabelText('AI 指令输入'), { target: { value: '复制当前对象' } });
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

    fireEvent.change(screen.getByLabelText('AI 指令输入'), { target: { value: '复制当前对象' } });
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

    expect(await screen.findByText('历史草稿仅供查看')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /确认应用/ })).not.toBeInTheDocument();
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

    fireEvent.change(screen.getByLabelText('AI 指令输入'), { target: { value: '重置视角' } });
    fireEvent.click(screen.getByRole('button', { name: '发送指令' }));
    fireEvent.click(await screen.findByRole('button', { name: /确认执行/ }));

    expect(await screen.findByText('已重置视角。')).toBeInTheDocument();
    expect(screen.getByText('历史草稿仅供查看')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /确认执行/ })).not.toBeInTheDocument();
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
    fireEvent.change(input, { target: { value: '解释当前场景' } });
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
    fireEvent.change(input, { target: { value: '解释当前场景' } });
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

    fireEvent.change(screen.getByLabelText('AI 指令输入'), { target: { value: '解释当前场景' } });
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

function clearAgentChatStorage() {
  localStorage.clear();
}

function installLocalStorageStub() {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    clear: vi.fn(() => {
      values.clear();
    }),
  });
}