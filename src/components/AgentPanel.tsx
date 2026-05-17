import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Check, ChevronDown, ChevronRight, History, Play, Plus, Sparkles, Square, Trash2, X } from 'lucide-react';
import { buildAgentContext } from '../agent/context';
import { createLlmAgentClient, createRuleParserAdapter } from '../agent/adapters';
import {
  appendAgentChatMessage,
  createAgentChatSession,
  loadAgentChatSessions,
  saveAgentChatSessions,
  summarizeSessionContext,
  upsertAgentChatSession,
} from '../agent/chatSessions';
import type { ActionResult, MeshEntity, OperationCommand } from '../domain/actions';
import type { HistoryEntry } from '../domain/history';
import type { ActionRisk, AgentAdapter, AgentChatMessage, AgentChatSession, AgentConversationTurn, AgentMode, AgentPlanStep, AgentResponse, ModelRouterId } from '../domain/protocol';
import type { SceneState } from '../domain/scene';
import { validateAgentResponse } from '../domain/validators';

type AgentPanelProps = {
  scene: SceneState;
  selectedMeshes?: MeshEntity[];
  historyEntries: HistoryEntry[];
  pendingCommand: OperationCommand | null;
  onExecute: (command: OperationCommand) => ActionResult;
  onConfirmPending?: () => void;
  onCancelPending?: () => void;
  onPreviewDraft?: (command: OperationCommand) => void;
};

type AgentStatus = 'idle' | 'loading' | 'ready' | 'error' | 'cancelled';
type PlanStepStatus = 'pending' | 'applied' | 'blocked' | 'failed';
type AgentSessionState = { sessions: AgentChatSession[]; activeSessionId: string };

export function AgentPanel({ scene, selectedMeshes = [], historyEntries, pendingCommand, onExecute, onConfirmPending, onCancelPending, onPreviewDraft }: AgentPanelProps) {
  const fallbackAdapter = useMemo(() => createRuleParserAdapter(), []);
  const adapter = useMemo(() => createAgentAdapter(fallbackAdapter), [fallbackAdapter]);
  const [sessionState, setSessionState] = useState<AgentSessionState>(() => createInitialSessionState(scene, historyEntries));
  const [text, setText] = useState('');
  const [activeResponseMessageId, setActiveResponseMessageId] = useState<string | null>(null);
  const [status, setStatus] = useState<AgentStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [planStatuses, setPlanStatuses] = useState<Record<string, PlanStepStatus>>({});
  const sessionStateRef = useRef(sessionState);
  const abortRef = useRef<AbortController | null>(null);
  const requestSerialRef = useRef(0);
  const inFlightPromptRef = useRef('');
  const lastPendingActionIdRef = useRef<string | null>(null);
  const cancelledPendingActionIdRef = useRef<string | null>(null);
  const activeSession = getActiveSession(sessionState);
  const effectivePendingCommand = pendingCommand?.id === cancelledPendingActionIdRef.current ? null : pendingCommand;
  const activeResponse = useMemo(() => activeSession.messages.find((message) => message.id === activeResponseMessageId)?.response ?? null, [activeResponseMessageId, activeSession.messages]);

  const replaceSessionState = (nextState: AgentSessionState) => {
    sessionStateRef.current = nextState;
    setSessionState(nextState);
    saveAgentChatSessions(nextState.sessions);
  };

  const persistSession = (session: AgentChatSession, makeActive = true) => {
    const currentState = sessionStateRef.current;
    const nextState = {
      sessions: upsertAgentChatSession(currentState.sessions, session),
      activeSessionId: makeActive ? session.id : currentState.activeSessionId,
    };
    replaceSessionState(nextState);
    return session;
  };

  const appendMessageToSession = (sessionId: string, message: Omit<AgentChatMessage, 'id' | 'createdAt'> & Partial<Pick<AgentChatMessage, 'id' | 'createdAt'>>) => {
    const currentState = sessionStateRef.current;
    const targetSession = currentState.sessions.find((session) => session.id === sessionId);
    if (!targetSession) return null;
    const nextSession = appendAgentChatMessage(targetSession, message);
    const nextState = {
      sessions: upsertAgentChatSession(currentState.sessions, nextSession),
      activeSessionId: currentState.activeSessionId,
    };
    replaceSessionState(nextState);
    return nextSession;
  };

  const appendActiveStatus = (message: string) => {
    appendMessageToSession(sessionStateRef.current.activeSessionId, { role: 'status', text: message });
  };

  const updateActiveSession = (updates: Partial<Pick<AgentChatSession, 'mode' | 'modelRouterId'>>) => {
    const currentSession = getActiveSession(sessionStateRef.current);
    persistSession({ ...currentSession, ...updates, updatedAt: new Date().toISOString() });
  };

  const invalidateInFlightRequest = () => {
    requestSerialRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    inFlightPromptRef.current = '';
  };

  const cancelPendingPreview = () => {
    if (pendingCommand?.source !== 'agent') return;
    cancelledPendingActionIdRef.current = pendingCommand.id;
    lastPendingActionIdRef.current = null;
    onCancelPending?.();
  };

  const createNewSession = () => {
    invalidateInFlightRequest();
    cancelPendingPreview();
    const nextSession = createAgentChatSession(summarizeSessionContext(scene, historyEntries));
    persistSession(nextSession);
    setActiveResponseMessageId(null);
    setError(null);
    setDebugOpen(false);
    setPlanStatuses({});
    setHistoryOpen(false);
    setStatus('idle');
  };

  const openSession = (sessionId: string) => {
    const nextSession = sessionStateRef.current.sessions.find((session) => session.id === sessionId);
    if (!nextSession) return;
    if (nextSession.id === sessionStateRef.current.activeSessionId) {
      setHistoryOpen(false);
      return;
    }
    invalidateInFlightRequest();
    cancelPendingPreview();
    replaceSessionState({ sessions: sessionStateRef.current.sessions, activeSessionId: nextSession.id });
    setActiveResponseMessageId(null);
    setError(null);
    setDebugOpen(false);
    setPlanStatuses({});
    setHistoryOpen(false);
    setStatus('idle');
  };

  const deleteSession = (sessionId: string) => {
    const currentState = sessionStateRef.current;
    const deletingActiveSession = sessionId === currentState.activeSessionId;
    let nextSessions = currentState.sessions.filter((session) => session.id !== sessionId);

    if (nextSessions.length === 0) {
      nextSessions = [createAgentChatSession(summarizeSessionContext(scene, historyEntries))];
    }

    if (deletingActiveSession) {
      invalidateInFlightRequest();
      cancelPendingPreview();
    }

    replaceSessionState({
      sessions: nextSessions,
      activeSessionId: deletingActiveSession ? nextSessions[0].id : currentState.activeSessionId,
    });

    if (deletingActiveSession) {
      setActiveResponseMessageId(null);
      setError(null);
      setDebugOpen(false);
      setPlanStatuses({});
      setStatus('idle');
    }
  };

  useEffect(() => {
    if (!pendingCommand || pendingCommand.id !== cancelledPendingActionIdRef.current) {
      cancelledPendingActionIdRef.current = null;
    }

    if (effectivePendingCommand?.source === 'agent') {
      lastPendingActionIdRef.current = effectivePendingCommand.id;
      return;
    }

    if (activeResponse?.kind === 'actionDraft' && lastPendingActionIdRef.current === activeResponse.action.id) {
      setActiveResponseMessageId(null);
      setDebugOpen(false);
      setPlanStatuses({});
      lastPendingActionIdRef.current = null;
    }
  }, [pendingCommand, effectivePendingCommand, activeResponse]);

  const sendRequest = async (input = text) => {
    const prompt = input.trim();
    const currentSession = getActiveSession(sessionStateRef.current);

    if (status === 'loading') {
      const shouldResend = Boolean(prompt) && prompt !== inFlightPromptRef.current;
      abortRef.current?.abort();
      if (!shouldResend) {
        requestSerialRef.current += 1;
        abortRef.current = null;
        inFlightPromptRef.current = '';
        setStatus('cancelled');
        setError(null);
        appendMessageToSession(currentSession.id, { role: 'status', text: '请求已取消。' });
        return;
      }
    }

    if (!prompt) return;

    const shouldCancelPendingForNewRequest = Boolean(activeResponseMessageId) && effectivePendingCommand?.source === 'agent';
    const pendingCommandForRequest = shouldCancelPendingForNewRequest ? null : effectivePendingCommand;
    if (shouldCancelPendingForNewRequest) cancelPendingPreview();

    const requestSerial = requestSerialRef.current + 1;
    requestSerialRef.current = requestSerial;
    const controller = new AbortController();
    abortRef.current = controller;
    inFlightPromptRef.current = prompt;
    const requestSession = appendAgentChatMessage(currentSession, {
      role: 'user',
      text: prompt,
      request: { text: prompt, mode: currentSession.mode, modelRouterId: currentSession.modelRouterId },
    });
    const nextConversation = sessionMessagesToConversation(requestSession.messages);

    setText('');
    persistSession(requestSession);
    setActiveResponseMessageId(null);
    setStatus('loading');
    setError(null);
    setDebugOpen(false);
    setPlanStatuses({});

    try {
      const next = await adapter.respond({
        id: createId('agent-request'),
        sessionId: requestSession.id,
        text: prompt,
        mode: requestSession.mode,
        modelRouterId: requestSession.modelRouterId,
        scene,
        conversation: nextConversation.slice(-8),
        pendingCommand: pendingCommandForRequest,
        context: buildAgentContext(scene, historyEntries),
      }, { signal: controller.signal });
      const validated = validateAgentResponse(next);
      if (!validated.ok) throw new Error(validated.error);
      if (requestSerialRef.current !== requestSerial || controller.signal.aborted) return;

      const modeCheck = responseAllowedInMode(requestSession.mode, validated.value);
      if (modeCheck !== true) {
        appendMessageToSession(requestSession.id, { role: 'status', text: modeCheck });
        setStatus('ready');
        return;
      }

      const assistantMessageId = createId('agent-message');
      setActiveResponseMessageId(assistantMessageId);
      if (validated.value.kind === 'actionDraft') onPreviewDraft?.(validated.value.action);
      appendMessageToSession(requestSession.id, { id: assistantMessageId, role: 'assistant', text: conversationSummary(validated.value), response: validated.value });
      setStatus('ready');
    } catch (nextError) {
      if (requestSerialRef.current !== requestSerial) return;
      if (controller.signal.aborted) {
        setStatus('cancelled');
        appendMessageToSession(requestSession.id, { role: 'status', text: '请求已取消。' });
      } else {
        const message = nextError instanceof Error ? nextError.message : 'Agent 请求失败。';
        setStatus('error');
        setError(message);
        appendMessageToSession(requestSession.id, { role: 'status', text: `请求失败：${message}` });
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const discardDraft = () => {
    if (effectivePendingCommand?.source === 'agent') cancelPendingPreview();
    setActiveResponseMessageId(null);
    setError(null);
    setDebugOpen(false);
    setPlanStatuses({});
    setStatus('idle');
    appendActiveStatus('已丢弃操作草稿。');
  };

  const executeDraft = (command: OperationCommand) => {
    const result = onExecute(command);
    appendActiveStatus(result.message);
    if (!result.requiresConfirmation && (result.status === 'applied' || result.status === 'rejected')) {
      setActiveResponseMessageId(null);
      setDebugOpen(false);
      setPlanStatuses({});
    }
  };

  const executePlan = (steps: AgentPlanStep[]) => {
    const nextStatuses: Record<string, PlanStepStatus> = {};
    for (const step of steps) {
      const result = onExecute(step.action);
      if (result.status === 'applied') {
        nextStatuses[step.id] = 'applied';
        continue;
      }
      nextStatuses[step.id] = result.status === 'failed' ? 'failed' : 'blocked';
      setPlanStatuses((current) => ({ ...current, ...nextStatuses }));
      appendActiveStatus(`${step.title}: ${result.message}`);
      return;
    }
    setPlanStatuses((current) => ({ ...current, ...nextStatuses }));
    appendActiveStatus('计划步骤已全部提交。');
  };

  const confirmPendingDraft = () => {
    appendActiveStatus('已确认应用操作草稿。');
    onConfirmPending?.();
  };

  return (
    <div className="panel-body stacked agent-review-surface agent-chat-shell">
      <div className="agent-session-header" aria-label="Current chat session">
        <div>
          <strong>{activeSession.title}</strong>
        </div>
        <div className="button-row no-wrap">
          <button type="button" className="icon-button" aria-label="新建聊天" title="新建聊天" onClick={createNewSession}>
            <Plus size={15} aria-hidden="true" />
          </button>
          <button type="button" className="icon-button" aria-label="历史会话" title="历史会话" aria-expanded={historyOpen} onClick={() => setHistoryOpen((open) => !open)}>
            <History size={15} aria-hidden="true" />
          </button>
        </div>
      </div>

      <section className={`agent-session-picker ${historyOpen ? 'is-open' : 'is-collapsed'}`} aria-label="历史会话列表" {...hiddenDrawerProps(!historyOpen)}>
          {sessionState.sessions.map((session) => (
            <div key={session.id} className="agent-session-row">
              <button type="button" className={session.id === activeSession.id ? 'active' : ''} onClick={() => openSession(session.id)}>
                {session.title}
              </button>
              <button type="button" className="icon-button" aria-label={`删除 ${session.title}`} title="删除聊天" onClick={() => deleteSession(session.id)}>
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </div>
          ))}
        </section>

      <ConversationFeed
        messages={activeSession.messages}
        loading={status === 'loading'}
        sceneMeshes={scene.meshes}
        selectedMeshes={selectedMeshes}
        activeResponseMessageId={activeResponseMessageId}
        debugOpen={debugOpen}
        planStatuses={planStatuses}
        onToggleDebug={() => setDebugOpen((open) => !open)}
        onDiscardDraft={discardDraft}
        onExecuteDraft={executeDraft}
        onConfirmPending={confirmPendingDraft}
        onExecutePlan={executePlan}
        pendingCommand={effectivePendingCommand}
      />

      {error ? (
        <section className="agent-review-card blocked parse-card danger">
          <div className="agent-review-head">
            <span className="review-kicker">错误</span>
            <strong>请求失败</strong>
          </div>
          <p>{error}</p>
        </section>
      ) : null}

      <section className="agent-composer" aria-label="AI composer">
        <div className="agent-context-chips">
          <SelectionPills selectedMeshes={selectedMeshes} />
        </div>
        <div className="agent-composer-input-row">
          <textarea
            id="agent-command-input"
            aria-label="AI 指令输入"
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={3}
            placeholder="描述要审阅的 3D 操作"
          />
        </div>
        <div className="agent-composer-controls" aria-label="AI request controls">
          <select className="agent-compact-select" aria-label="AI mode" value={activeSession.mode} onChange={(event) => updateActiveSession({ mode: event.target.value as AgentMode })}>
            <option value="ask">Ask</option>
            <option value="edit">Edit</option>
            <option value="agent">Agent</option>
          </select>
          <select className="agent-compact-select" aria-label="模型 router" value={activeSession.modelRouterId} onChange={(event) => updateActiveSession({ modelRouterId: event.target.value as ModelRouterId })}>
            <option value="default-router">GPT-5.3</option>
          </select>
          <button
            type="button"
            className={`agent-send-button ${status === 'loading' ? 'is-stopping' : ''}`}
            disabled={status !== 'loading' && !text.trim()}
            aria-label={status === 'loading' ? '停止生成' : '发送指令'}
            title={status === 'loading' ? '停止当前请求；如果已编辑提示词则重新发送' : '发送指令'}
            onClick={() => void sendRequest()}
          >
            {status === 'loading' ? <Square size={15} aria-hidden="true" /> : <ArrowUp size={21} aria-hidden="true" strokeWidth={2.4} />}
          </button>
        </div>
      </section>
    </div>
  );
}

function SelectionPills({ selectedMeshes }: { selectedMeshes: MeshEntity[] }) {
  if (selectedMeshes.length === 0) {
    return (
      <div className="agent-selection-pills" aria-label="Selected scene objects">
        <span className="agent-selection-pill muted">未选择对象</span>
      </div>
    );
  }

  return (
    <div className="agent-selection-pills" aria-label="Selected scene objects">
      {selectedMeshes.length > 1 ? <span className="agent-selection-pill summary">{selectedMeshes.length} 个对象</span> : null}
      {selectedMeshes.map((mesh) => (
        <span className="agent-selection-pill" key={mesh.id} title={mesh.id}>{mesh.name}</span>
      ))}
    </div>
  );
}

const noop = () => undefined;
const noopExecuteDraft = (_command: OperationCommand) => undefined;
const noopExecutePlan = (_steps: AgentPlanStep[]) => undefined;

function ConversationFeed({
  messages,
  loading,
  sceneMeshes,
  selectedMeshes,
  activeResponseMessageId,
  debugOpen,
  planStatuses,
  onToggleDebug,
  onDiscardDraft,
  onExecuteDraft,
  onConfirmPending,
  onExecutePlan,
  pendingCommand,
}: {
  messages: AgentChatMessage[];
  loading: boolean;
  sceneMeshes: MeshEntity[];
  selectedMeshes: MeshEntity[];
  activeResponseMessageId: string | null;
  debugOpen: boolean;
  planStatuses: Record<string, PlanStepStatus>;
  onToggleDebug: () => void;
  onDiscardDraft: () => void;
  onExecuteDraft: (command: OperationCommand) => void;
  onConfirmPending?: () => void;
  onExecutePlan: (steps: AgentPlanStep[]) => void;
  pendingCommand: OperationCommand | null;
}) {
  if (messages.length === 0 && !loading) {
    return (
      <section className="agent-conversation-feed" aria-label="AI conversation feed" />
    );
  }

  return (
    <section className="agent-conversation-feed" aria-label="AI conversation feed">
      {messages.map((message) => {
        const displayRole = message.role === 'status' || message.role === 'tool' ? 'tool' : message.role;
        const responseReadOnly = message.id !== activeResponseMessageId;
        const messageLabel = message.role === 'user' ? 'You' : message.role === 'assistant' ? 'Agent' : 'Status';

        return (
        <div key={message.id} className={`agent-message ${displayRole}`}>
          <span className="agent-message-role">{messageLabel}</span>
          <div className="agent-message-body">
            <div className={message.role === 'user' ? 'agent-chat-pill' : undefined}>
              <p>{message.text}</p>
            </div>
            {message.response && message.response.kind !== 'message' ? (
              <div className="agent-inline-response-card">
                <AgentResponseView
                  response={message.response}
                  sceneMeshes={sceneMeshes}
                  selectedMeshes={selectedMeshes}
                  readOnly={responseReadOnly}
                  debugOpen={!responseReadOnly && debugOpen}
                  planStatuses={responseReadOnly ? {} : planStatuses}
                  onToggleDebug={responseReadOnly ? noop : onToggleDebug}
                  onDiscardDraft={responseReadOnly ? noop : onDiscardDraft}
                  onExecuteDraft={responseReadOnly ? noopExecuteDraft : onExecuteDraft}
                  onConfirmPending={responseReadOnly ? noop : onConfirmPending}
                  onExecutePlan={responseReadOnly ? noopExecutePlan : onExecutePlan}
                  pendingCommand={responseReadOnly ? null : pendingCommand}
                />
              </div>
            ) : null}
          </div>
        </div>
        );
      })}
      {loading ? (
        <div className="agent-message tool">
          <span className="agent-message-role">Status</span>
          <p>正在生成可审阅操作...</p>
        </div>
      ) : null}
    </section>
  );
}

function AgentResponseView({
  response,
  sceneMeshes,
  selectedMeshes,
  readOnly = false,
  debugOpen,
  planStatuses,
  onToggleDebug,
  onDiscardDraft,
  onExecuteDraft,
  onConfirmPending,
  onExecutePlan,
  pendingCommand,
}: {
  response: AgentResponse | null;
  sceneMeshes: MeshEntity[];
  selectedMeshes: MeshEntity[];
  readOnly?: boolean;
  debugOpen: boolean;
  planStatuses: Record<string, PlanStepStatus>;
  onToggleDebug: () => void;
  onDiscardDraft: () => void;
  onExecuteDraft: (command: OperationCommand) => void;
  onConfirmPending?: () => void;
  onExecutePlan: (steps: AgentPlanStep[]) => void;
  pendingCommand: OperationCommand | null;
}) {
  if (!response) {
    return <div className="agent-empty-state empty-panel roomy">暂无操作草稿。</div>;
  }

  if (response.kind === 'message') {
    return null;
  }

  if (response.kind === 'clarification') {
    return (
      <section className="agent-review-card needs-attention parse-card warning">
        <div className="agent-review-head">
          <span className="review-kicker">需澄清</span>
          <strong>需要确认</strong>
        </div>
        <p>{response.question}</p>
        <div className="agent-chip-row chip-row">{response.suggestions.map((item) => <span key={item}>{item}</span>)}</div>
      </section>
    );
  }

  if (response.kind === 'actionPlan') {
    return (
      <section className="agent-review-card parse-card">
        <div className="agent-review-head parse-head">
          <div>
            <span className="review-kicker">操作计划</span>
            <strong>{response.steps.length} 个步骤</strong>
          </div>
          <span className="confidence-pill">Plan</span>
        </div>
        <p>{response.explanation}</p>
        <RiskNote risk={response.risk} />
        <div className="agent-plan-review" aria-label="Plan preview">
          {response.steps.map((step, index) => (
            <div className={`agent-plan-step ${index === 0 ? 'active' : ''}`} key={step.id}>
              <span>{statusGlyph(planStatuses[step.id], index + 1)}</span>
              <div>
                <strong>{step.title}</strong>
                <p>{planStatuses[step.id] ?? step.action.type}</p>
              </div>
            </div>
          ))}
        </div>
        {readOnly ? <span className="agent-historical-note">历史草稿仅供查看</span> : (
          <div className="agent-review-actions">
            <button onClick={onDiscardDraft}>
              <X size={15} /> 丢弃草稿
            </button>
            <button onClick={onToggleDebug} aria-expanded={debugOpen}>
              {debugOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />} JSON
            </button>
            <button className="primary-button" onClick={() => onExecutePlan(response.steps)}>
              <Play size={15} /> 逐步执行
            </button>
          </div>
        )}
        <DebugDrawer payload={response} open={!readOnly && debugOpen} />
      </section>
    );
  }

  if (response.kind === 'macroDraft') {
    return (
      <section className="agent-review-card parse-card">
        <div className="agent-review-head parse-head">
          <div>
            <span className="review-kicker">宏草稿</span>
            <strong>{response.name}</strong>
          </div>
          <span className="confidence-pill">{response.steps.length} steps</span>
        </div>
        <p>{response.explanation}</p>
        <RiskNote risk={response.risk} />
        <div className="agent-plan-review" aria-label="Macro preview">
          {response.steps.map((step, index) => (
            <div className={`agent-plan-step ${index === 0 ? 'active' : ''}`} key={step.id}>
              <span>{statusGlyph(planStatuses[step.id], index + 1)}</span>
              <div>
                <strong>{step.title}</strong>
                <p>{planStatuses[step.id] ?? step.action.type}</p>
              </div>
            </div>
          ))}
        </div>
        {readOnly ? <span className="agent-historical-note">历史草稿仅供查看</span> : (
          <div className="agent-review-actions">
            <button onClick={onDiscardDraft}>
              <X size={15} /> 丢弃草稿
            </button>
            <button onClick={onToggleDebug} aria-expanded={debugOpen}>
              {debugOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />} JSON
            </button>
            <button className="primary-button" onClick={() => onExecutePlan(response.steps)}>
              <Play size={15} /> 逐步执行
            </button>
          </div>
        )}
        <DebugDrawer payload={response} open={!readOnly && debugOpen} />
      </section>
    );
  }

  if (response.kind === 'sceneAnswer') {
    return (
      <section className="agent-review-card parse-card">
        <div className="agent-review-head">
          <span className="review-kicker">场景问答</span>
          <strong>{response.referencedMeshIds.length} references</strong>
        </div>
        <p>{response.answer}</p>
        {response.referencedMeshIds.length > 0 ? (
          <div className="agent-chip-row chip-row">{response.referencedMeshIds.map((id) => <span key={id}>{id}</span>)}</div>
        ) : null}
      </section>
    );
  }

  if (response.kind === 'backendJobDraft') {
    return (
      <section className="agent-review-card needs-attention parse-card warning">
        <div className="agent-review-head">
          <span className="review-kicker">后端作业</span>
          <strong>{response.title}</strong>
        </div>
        <p>{response.description}</p>
        <RiskNote risk={response.risk} />
        <div className="agent-review-grid">
          <div className="agent-review-row"><span>类型</span><strong>{response.jobKind}</strong></div>
          <div className="agent-review-row"><span>状态</span><strong>等待未来 job worker</strong></div>
        </div>
        {readOnly ? <span className="agent-historical-note">历史草稿仅供查看</span> : (
          <div className="agent-review-actions">
            <button onClick={onDiscardDraft}>
              <X size={15} /> 丢弃草稿
            </button>
          </div>
        )}
      </section>
    );
  }

  const summaryRows = buildActionSummary(response.action, sceneMeshes, selectedMeshes);
  const pendingMatchesDraft = pendingCommand?.source === 'agent' && pendingCommand.id === response.action.id;

  return (
    <section className="agent-review-card parse-card">
      <div className="agent-review-head parse-head">
        <div>
          <span className="review-kicker">操作草稿</span>
          <strong>{commandTitle(response.action)}</strong>
        </div>
      </div>
      <p>{actionDraftDescription(response.action, response.explanation)}</p>
      <div className="agent-review-grid">
        {summaryRows.map(([label, value]) => (
          <div className="agent-review-row" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <RiskNote risk={response.risk} command={response.action} />
      {readOnly ? <span className="agent-historical-note">历史草稿仅供查看</span> : (
        <div className={`agent-review-actions ${response.action.type === 'clipMesh' ? 'is-clip' : ''}`}>
          <button onClick={onDiscardDraft}>
            <X size={15} /> {discardActionLabel(response.action)}
          </button>
          {response.action.type !== 'clipMesh' ? (
            <button onClick={onToggleDebug} aria-expanded={debugOpen}>
              {debugOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />} {debugActionLabel(response.action)}
            </button>
          ) : null}
          <button className="primary-button" onClick={() => (pendingMatchesDraft ? onConfirmPending?.() : onExecuteDraft(response.action))} disabled={pendingMatchesDraft && !onConfirmPending}>
            {pendingMatchesDraft ? <Check size={15} /> : <Sparkles size={15} />} {primaryActionLabel(response.action, pendingMatchesDraft)}
          </button>
        </div>
      )}
      <DebugDrawer payload={response} open={!readOnly && debugOpen} />
    </section>
  );
}

function RiskNote({ risk, command }: { risk: ActionRisk; command?: OperationCommand }) {
  if (command?.type === 'clipMesh') {
    return (
      <div className={`risk-note agent-risk-note agent-clip-note risk-${risk.level}`}>
        <strong>视觉切割预览已生成</strong>
        <span>确认后应用到视图状态。</span>
      </div>
    );
  }

  return (
    <div className={`risk-note agent-risk-note risk-${risk.level}`}>
      <strong>{risk.summary}</strong>
      {risk.requiresConfirmation ? <span>需要确认。</span> : null}
      {risk.warnings.length > 0 ? <ul>{risk.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
    </div>
  );
}

function DebugDrawer({ payload, open }: { payload: unknown; open: boolean }) {
  return (
    <div className={`agent-debug-drawer ${open ? 'is-open' : 'is-collapsed'}`} aria-hidden={!open}>
      <div className="agent-debug-drawer-inner">
        <pre>{JSON.stringify(payload, null, 2)}</pre>
      </div>
    </div>
  );
}

function hiddenDrawerProps(hidden: boolean) {
  return hidden ? { 'aria-hidden': true, inert: '' } : {};
}

function createAgentAdapter(fallback: AgentAdapter): AgentAdapter {
  const endpoint = getAgentEndpoint();
  return endpoint ? createLlmAgentClient({ endpoint }) : fallback;
}

function getAgentEndpoint(): string | undefined {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_AGENT_API_URL || '/api/agent/respond';
}

function createInitialSessionState(scene: SceneState, historyEntries: HistoryEntry[]): AgentSessionState {
  const storedSessions = loadAgentChatSessions();
  if (storedSessions.length > 0) {
    return { sessions: storedSessions, activeSessionId: storedSessions[0].id };
  }

  const session = createAgentChatSession(summarizeSessionContext(scene, historyEntries));
  saveAgentChatSessions([session]);
  return { sessions: [session], activeSessionId: session.id };
}

function getActiveSession(sessionState: AgentSessionState): AgentChatSession {
  return sessionState.sessions.find((session) => session.id === sessionState.activeSessionId) ?? sessionState.sessions[0];
}

function sessionMessagesToConversation(messages: AgentChatMessage[]): AgentConversationTurn[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role === 'status' ? 'tool' : message.role,
    text: message.text,
    timestamp: message.createdAt,
  }));
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function conversationSummary(response: AgentResponse) {
  if (response.kind === 'message') return response.text;
  if (response.kind === 'clarification') return response.question;
  if (response.kind === 'actionPlan') return `计划 ${response.steps.length} 步，确认前请检查每一步。`;
  if (response.kind === 'macroDraft') return `宏草稿 ${response.name} 已生成。`;
  if (response.kind === 'sceneAnswer') return response.answer;
  if (response.kind === 'backendJobDraft') return `后端作业草稿: ${response.title}`;
  return `${commandTitle(response.action)} 已生成，确认前请检查参数。`;
}

function actionDraftDescription(command: OperationCommand, fallback: string) {
  if (command.type === 'clipMesh') return '已生成切割预览，请检查后再应用。';
  return fallback;
}

function responseAllowedInMode(mode: AgentMode, response: AgentResponse): true | string {
  if (mode === 'ask' && (response.kind === 'actionDraft' || response.kind === 'actionPlan' || response.kind === 'macroDraft' || response.kind === 'backendJobDraft')) {
    return 'Ask 模式只回答场景和能力问题；请切换到 Edit 或 Agent 模式来生成操作草稿。';
  }
  if (mode === 'edit' && (response.kind === 'actionPlan' || response.kind === 'macroDraft')) {
    return 'Edit 模式一次只生成一个操作草稿；请切换到 Agent 模式来规划多步操作。';
  }
  return true;
}

function statusGlyph(status: PlanStepStatus | undefined, fallback: number): string {
  if (status === 'applied') return '✓';
  if (status === 'blocked') return '!';
  if (status === 'failed') return 'x';
  return String(fallback);
}

function commandTitle(command: OperationCommand) {
  if (command.type === 'clipMesh') return `切割预览：${clipParameterLabel(command)}`;

  const titles: Record<OperationCommand['type'], string> = {
    selectMesh: '选择对象',
    rotateMesh: '旋转对象',
    cloneMesh: '复制对象',
    setMeshScale: '缩放对象',
    clipMesh: '视觉切割',
    resetView: '重置视角',
    setMeshVisibility: '切换可见性',
    setMeshLocked: '锁定状态',
    setDisplayMode: '显示模式',
    importMesh: '导入模型',
  };
  return titles[command.type];
}

function buildActionSummary(command: OperationCommand, sceneMeshes: MeshEntity[], selectedMeshes: MeshEntity[]): Array<[string, string]> {
  const rows: Array<[string, string]> = [
    ['目标', describeTarget(command.target, sceneMeshes, selectedMeshes)],
  ];

  if (command.type === 'rotateMesh') rows.push(['参数', `${axisLabel(command.params.axis)} 轴 ${command.params.angleDeg}°`]);
  if (command.type === 'cloneMesh') rows.push(['参数', `${command.params.count} 个，偏移 ${command.params.offset.join(', ')} ${command.params.unit}`]);
  if (command.type === 'clipMesh') rows.push(['参数', clipParameterLabel(command)]);
  if (command.type === 'resetView') rows.push(['参数', `${command.params.orientation} / ${command.params.fit}`]);
  if (command.type === 'setDisplayMode') rows.push(['参数', command.params.mode]);
  if (command.type === 'setMeshVisibility') rows.push(['参数', command.params.visible ? '显示' : '隐藏']);
  if (command.type === 'setMeshLocked') rows.push(['参数', command.params.locked ? '锁定' : '解锁']);
  if (command.type === 'setMeshScale') rows.push(['参数', command.params.scale.join(', ')]);

  return rows;
}

type ClipCommand = Extract<OperationCommand, { type: 'clipMesh' }>;

function clipParameterLabel(command: ClipCommand) {
  const axisIndex = dominantAxisIndex(command.params.plane.normal);
  const keepSide = command.params.keepSide === 'positive' ? '正侧' : '负侧';
  if (axisIndex === -1) {
    return `平面原点 ${command.params.plane.origin.map(formatScalar).join(', ')}，保留${keepSide}`;
  }

  const axis = ['X', 'Y', 'Z'][axisIndex];
  return `${axis}=${formatScalar(command.params.plane.origin[axisIndex])}，保留${keepSide}`;
}

function dominantAxisIndex(vector: [number, number, number]) {
  const index = vector.findIndex((component) => Math.abs(component) >= 0.999);
  return index === undefined ? -1 : index;
}

function formatScalar(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function discardActionLabel(command: OperationCommand) {
  return command.type === 'clipMesh' ? '清除预览' : '丢弃草稿';
}

function debugActionLabel(command: OperationCommand) {
  return command.type === 'clipMesh' ? '查看 JSON' : 'JSON';
}

function primaryActionLabel(command: OperationCommand, pendingMatchesDraft: boolean) {
  if (command.type === 'clipMesh') return pendingMatchesDraft ? '应用切割' : '预览切割';
  return pendingMatchesDraft ? '确认应用' : '确认执行';
}

function describeTarget(target: OperationCommand['target'], sceneMeshes: MeshEntity[], selectedMeshes: MeshEntity[]) {
  if ('source' in target) {
    if (target.source === 'selection') return describeMeshes(selectedMeshes.length > 0 ? selectedMeshes : sceneMeshes.filter((mesh) => mesh.selected));
    return '全部可见对象';
  }
  if ('meshId' in target) return meshLabel(sceneMeshes.find((mesh) => mesh.id === target.meshId)) ?? target.meshId;
  if ('meshIds' in target) return describeMeshes(target.meshIds.map((meshId) => sceneMeshes.find((mesh) => mesh.id === meshId)).filter(isMeshEntity));
  if ('name' in target) return `${target.name} (${target.match})`;
  return target.scope;
}

function describeMeshes(meshes: MeshEntity[]): string {
  if (meshes.length === 0) return '当前选择';
  if (meshes.length <= 2) return meshes.map((mesh) => meshLabel(mesh)).join('、');
  return `${meshes.slice(0, 2).map((mesh) => meshLabel(mesh)).join('、')} 等 ${meshes.length} 个对象`;
}

function meshLabel(mesh: MeshEntity | undefined): string | undefined {
  return mesh?.name || mesh?.id;
}

function isMeshEntity(mesh: MeshEntity | undefined): mesh is MeshEntity {
  return Boolean(mesh);
}

function axisLabel(axis: OperationCommand extends infer Command ? Command extends { type: 'rotateMesh'; params: { axis: infer Axis } } ? Axis : never : never): string {
  return Array.isArray(axis) ? axis.join(', ') : String(axis);
}
