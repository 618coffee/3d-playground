import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Play, RotateCcw, Send, Sparkles, Square, X } from 'lucide-react';
import { buildAgentContext } from '../agent/context';
import { createLlmAgentClient, createRuleParserAdapter } from '../agent/adapters';
import type { ActionResult, OperationCommand } from '../domain/actions';
import type { HistoryEntry } from '../domain/history';
import type { ActionRisk, AgentAdapter, AgentConversationTurn, AgentPlanStep, AgentResponse } from '../domain/protocol';
import type { SceneState } from '../domain/scene';
import { validateAgentResponse } from '../domain/validators';

type AgentPanelProps = {
  scene: SceneState;
  historyEntries: HistoryEntry[];
  pendingCommand: OperationCommand | null;
  onExecute: (command: OperationCommand) => ActionResult;
  onConfirmPending?: () => void;
  onCancelPending?: () => void;
  onPreviewDraft?: (command: OperationCommand) => void;
};

type AgentStatus = 'idle' | 'loading' | 'ready' | 'error' | 'cancelled';
type PlanStepStatus = 'pending' | 'applied' | 'blocked' | 'failed';

const examples = [
  '把当前对象绕 Z 轴旋转 30 度',
  '复制选中对象 3 个，沿 X 方向间隔 20mm',
  '沿 X=0 平面切开当前对象，只保留右半边',
  '重置视角',
];

export function AgentPanel({ scene, historyEntries, pendingCommand, onExecute, onConfirmPending, onCancelPending, onPreviewDraft }: AgentPanelProps) {
  const fallbackAdapter = useMemo(() => createRuleParserAdapter(), []);
  const adapter = useMemo(() => createAgentAdapter(fallbackAdapter), [fallbackAdapter]);
  const [text, setText] = useState(examples[0]);
  const [response, setResponse] = useState<AgentResponse | null>(null);
  const [conversation, setConversation] = useState<AgentConversationTurn[]>([]);
  const [status, setStatus] = useState<AgentStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [lastRequest, setLastRequest] = useState('');
  const [debugOpen, setDebugOpen] = useState(false);
  const [planStatuses, setPlanStatuses] = useState<Record<string, PlanStepStatus>>({});
  const abortRef = useRef<AbortController | null>(null);
  const lastPendingActionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (pendingCommand?.source === 'agent') {
      lastPendingActionIdRef.current = pendingCommand.id;
      return;
    }

    if (response?.kind === 'actionDraft' && lastPendingActionIdRef.current === response.action.id) {
      setResponse(null);
      setDebugOpen(false);
      setPlanStatuses({});
      lastPendingActionIdRef.current = null;
    }
  }, [pendingCommand, response]);

  const sendRequest = async (input = text) => {
    const prompt = input.trim();
    if (!prompt || status === 'loading') return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const userTurn = createTurn('user', prompt);
    const nextConversation = [...conversation, userTurn];

    setText(input);
    setLastRequest(prompt);
    setConversation(nextConversation);
    setStatus('loading');
    setError(null);
    setDebugOpen(false);
    setPlanStatuses({});

    try {
      const next = await adapter.respond({
        id: createId('agent-request'),
        text: prompt,
        scene,
        conversation: nextConversation.slice(-8),
        pendingCommand,
        context: buildAgentContext(scene, historyEntries),
      }, { signal: controller.signal });
      const validated = validateAgentResponse(next);
      if (!validated.ok) throw new Error(validated.error);

      setResponse(validated.value);
      if (validated.value.kind === 'actionDraft') onPreviewDraft?.(validated.value.action);
      setConversation((current) => [...current, createTurn('assistant', conversationSummary(validated.value))]);
      setStatus('ready');
    } catch (nextError) {
      if (controller.signal.aborted) {
        setStatus('cancelled');
        setConversation((current) => [...current, createTurn('tool', '请求已取消。')]);
      } else {
        setStatus('error');
        setError(nextError instanceof Error ? nextError.message : 'Agent 请求失败。');
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const retryLastRequest = () => {
    if (!lastRequest) return;
    void sendRequest(lastRequest);
  };

  const stopRequest = () => {
    abortRef.current?.abort();
  };

  const discardDraft = () => {
    if (pendingCommand?.source === 'agent') onCancelPending?.();
    setResponse(null);
    setError(null);
    setDebugOpen(false);
    setPlanStatuses({});
    setStatus('idle');
    setConversation((current) => [...current, createTurn('tool', '已丢弃操作草稿。')]);
  };

  const executeDraft = (command: OperationCommand) => {
    const result = onExecute(command);
    setConversation((current) => [...current, createTurn('tool', result.message)]);
    if (!result.requiresConfirmation && (result.status === 'applied' || result.status === 'rejected')) {
      setResponse(null);
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
      setConversation((current) => [...current, createTurn('tool', `${step.title}: ${result.message}`)]);
      return;
    }
    setPlanStatuses((current) => ({ ...current, ...nextStatuses }));
    setConversation((current) => [...current, createTurn('tool', '计划步骤已全部提交。')]);
  };

  return (
    <div className="panel-body stacked agent-review-surface">
      <section className="agent-prompt-card" aria-label="AI command prompt">
        <label className="agent-prompt-label" htmlFor="agent-command-input">
          <span>AI 指令</span>
          <span className="agent-mode-chip">{adapter.label}</span>
        </label>
        <textarea
          id="agent-command-input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={4}
          disabled={status === 'loading'}
          placeholder="描述要审阅的 3D 操作"
        />
        <div className="agent-prompt-actions">
          <button className="agent-secondary-action" disabled={!lastRequest || status === 'loading'} onClick={retryLastRequest}>
            <RotateCcw size={15} /> 重试
          </button>
          <button className="agent-secondary-action" disabled={status !== 'loading'} onClick={stopRequest}>
            <Square size={13} /> 停止
          </button>
          <button className="primary-button" disabled={status === 'loading'} onClick={() => void sendRequest()}>
            <Send size={15} /> 解析审阅
          </button>
        </div>
      </section>

      <div className="agent-chip-row chip-row" aria-label="Example prompts">
        {examples.map((example) => (
          <button key={example} disabled={status === 'loading'} onClick={() => void sendRequest(example)}>{example}</button>
        ))}
      </div>

      <ConversationFeed conversation={conversation} loading={status === 'loading'} />

      {error ? (
        <section className="agent-review-card blocked parse-card danger">
          <div className="agent-review-head">
            <span className="review-kicker">错误</span>
            <strong>请求失败</strong>
          </div>
          <p>{error}</p>
        </section>
      ) : null}

      <AgentResponseView
        response={response}
        debugOpen={debugOpen}
        planStatuses={planStatuses}
        onToggleDebug={() => setDebugOpen((open) => !open)}
        onDiscardDraft={discardDraft}
        onExecuteDraft={executeDraft}
        onConfirmPending={onConfirmPending}
        onExecutePlan={executePlan}
        pendingCommand={pendingCommand}
      />

    </div>
  );
}

function ConversationFeed({ conversation, loading }: { conversation: AgentConversationTurn[]; loading: boolean }) {
  if (conversation.length === 0 && !loading) {
    return (
      <section className="agent-conversation-feed" aria-label="AI conversation feed">
        <div className="agent-message assistant">
          <span className="agent-message-role">Assistant</span>
          <p>准备审阅操作草稿。</p>
        </div>
      </section>
    );
  }

  return (
    <section className="agent-conversation-feed" aria-label="AI conversation feed">
      {conversation.slice(-6).map((turn) => (
        <div key={turn.id} className={`agent-message ${turn.role}`}>
          <span className="agent-message-role">{turn.role === 'user' ? 'You' : turn.role === 'assistant' ? 'Assistant' : 'Status'}</span>
          <p>{turn.text}</p>
        </div>
      ))}
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
    return (
      <section className="agent-review-card parse-card">
        <div className="agent-review-head">
          <span className="review-kicker">消息</span>
          <strong>AI 回复</strong>
        </div>
        <p>{response.text}</p>
      </section>
    );
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
        {debugOpen ? <DebugDrawer payload={response} /> : null}
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
        {debugOpen ? <DebugDrawer payload={response} /> : null}
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
        <div className="agent-review-actions">
          <button onClick={onDiscardDraft}>
            <X size={15} /> 丢弃草稿
          </button>
        </div>
      </section>
    );
  }

  const summaryRows = buildActionSummary(response.action);
  const pendingMatchesDraft = pendingCommand?.source === 'agent' && pendingCommand.id === response.action.id;

  return (
    <section className="agent-review-card parse-card">
      <div className="agent-review-head parse-head">
        <div>
          <span className="review-kicker">操作草稿</span>
          <strong>{commandTitle(response.action)}</strong>
        </div>
        <span className="confidence-pill">{Math.round(response.confidence * 100)}%</span>
      </div>
      <p>{response.explanation}</p>
      <div className="agent-review-grid">
        {summaryRows.map(([label, value]) => (
          <div className="agent-review-row" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <RiskNote risk={response.risk} />
      <div className="agent-review-actions">
        <button onClick={onDiscardDraft}>
          <X size={15} /> 丢弃草稿
        </button>
        <button onClick={onToggleDebug} aria-expanded={debugOpen}>
          {debugOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />} JSON
        </button>
        <button className="primary-button" onClick={() => (pendingMatchesDraft ? onConfirmPending?.() : onExecuteDraft(response.action))} disabled={pendingMatchesDraft && !onConfirmPending}>
          {pendingMatchesDraft ? <Check size={15} /> : <Sparkles size={15} />} {pendingMatchesDraft ? '确认应用' : '确认执行'}
        </button>
      </div>
      {debugOpen ? <DebugDrawer payload={response} /> : null}
    </section>
  );
}

function RiskNote({ risk }: { risk: ActionRisk }) {
  return (
    <div className={`risk-note agent-risk-note risk-${risk.level}`}>
      <strong>{risk.summary}</strong>
      {risk.requiresConfirmation ? <span>需要确认。</span> : null}
      {risk.warnings.length > 0 ? <ul>{risk.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
    </div>
  );
}

function DebugDrawer({ payload }: { payload: unknown }) {
  return (
    <div className="agent-debug-drawer">
      <pre>{JSON.stringify(payload, null, 2)}</pre>
    </div>
  );
}

function createAgentAdapter(fallback: AgentAdapter): AgentAdapter {
  const endpoint = getAgentEndpoint();
  return endpoint ? createLlmAgentClient({ endpoint }) : fallback;
}

function getAgentEndpoint(): string | undefined {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_AGENT_API_URL || '/api/agent/respond';
}

function createTurn(role: AgentConversationTurn['role'], turnText: string): AgentConversationTurn {
  return { id: createId(role), role, text: turnText, timestamp: new Date().toISOString() };
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

function statusGlyph(status: PlanStepStatus | undefined, fallback: number): string {
  if (status === 'applied') return '✓';
  if (status === 'blocked') return '!';
  if (status === 'failed') return 'x';
  return String(fallback);
}

function commandTitle(command: OperationCommand) {
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

function buildActionSummary(command: OperationCommand): Array<[string, string]> {
  const rows: Array<[string, string]> = [
    ['操作', command.type],
    ['目标', describeTarget(command.target)],
  ];

  if (command.type === 'rotateMesh') rows.push(['参数', `${axisLabel(command.params.axis)} 轴 ${command.params.angleDeg}°`]);
  if (command.type === 'cloneMesh') rows.push(['参数', `${command.params.count} 个，偏移 ${command.params.offset.join(', ')} ${command.params.unit}`]);
  if (command.type === 'clipMesh') rows.push(['参数', `${command.params.mode}，保留 ${command.params.keepSide}`]);
  if (command.type === 'resetView') rows.push(['参数', `${command.params.orientation} / ${command.params.fit}`]);
  if (command.type === 'setDisplayMode') rows.push(['参数', command.params.mode]);
  if (command.type === 'setMeshVisibility') rows.push(['参数', command.params.visible ? '显示' : '隐藏']);
  if (command.type === 'setMeshLocked') rows.push(['参数', command.params.locked ? '锁定' : '解锁']);
  if (command.type === 'setMeshScale') rows.push(['参数', command.params.scale.join(', ')]);

  rows.push(['来源', command.source]);
  return rows;
}

function describeTarget(target: OperationCommand['target']) {
  if ('source' in target) return target.source === 'selection' ? '当前选择' : '全部可见对象';
  if ('meshId' in target) return target.meshId;
  if ('meshIds' in target) return `${target.meshIds.length} 个对象`;
  if ('name' in target) return `${target.name} (${target.match})`;
  return target.scope;
}

function axisLabel(axis: OperationCommand extends infer Command ? Command extends { type: 'rotateMesh'; params: { axis: infer Axis } } ? Axis : never : never): string {
  return Array.isArray(axis) ? axis.join(', ') : String(axis);
}
