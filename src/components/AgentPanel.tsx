import { useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { createRuleParser } from '../agent/ruleParser';
import type { AgentParseResult } from '../agent/types';
import type { OperationCommand } from '../domain/actions';
import type { SceneState } from '../domain/scene';

type AgentPanelProps = {
  scene: SceneState;
  onExecute: (command: OperationCommand) => void;
};

const examples = [
  '把当前对象绕 Z 轴旋转 30 度',
  '复制选中对象 3 个，沿 X 方向间隔 20mm',
  '沿 X=0 平面切开当前对象，只保留右半边',
  '重置视角',
];

export function AgentPanel({ scene, onExecute }: AgentPanelProps) {
  const parser = useMemo(() => createRuleParser(), []);
  const [text, setText] = useState(examples[0]);
  const [result, setResult] = useState<AgentParseResult | null>(null);

  const parse = (input = text) => {
    const next = parser.parse(input, scene);
    setResult(next);
    return next;
  };

  return (
    <div className="panel-body stacked">
      <div className="agent-input-block">
        <textarea value={text} onChange={(event) => setText(event.target.value)} rows={4} />
        <div className="button-row">
          <button onClick={() => parse()}><Sparkles size={15} /> 解析</button>
          <button
            className="primary-button"
            disabled={result?.kind !== 'action'}
            onClick={() => {
              if (result?.kind === 'action') onExecute(result.action);
            }}
          >
            执行
          </button>
        </div>
      </div>
      <div className="chip-row">
        {examples.map((example) => (
          <button key={example} onClick={() => { setText(example); parse(example); }}>{example}</button>
        ))}
      </div>
      <ParseResult result={result} />
    </div>
  );
}

function ParseResult({ result }: { result: AgentParseResult | null }) {
  if (!result) {
    return <div className="empty-panel roomy">输入自然语言后点击解析，系统会展示结构化 action。</div>;
  }
  if (result.kind === 'clarification') {
    return (
      <div className="parse-card warning">
        <strong>需要确认</strong>
        <p>{result.question}</p>
        <div className="chip-row">{result.suggestions.map((item) => <span key={item}>{item}</span>)}</div>
      </div>
    );
  }
  if (result.kind === 'unsupported') {
    return <div className="parse-card danger"><strong>无法解析</strong><p>{result.message}</p></div>;
  }
  return (
    <div className="parse-card">
      <div className="parse-head">
        <strong>{result.action.type}</strong>
        <span>{Math.round(result.confidence * 100)}%</span>
      </div>
      <p>{result.explanation}</p>
      {result.requiresConfirmation ? <div className="risk-note">此操作将先进入预览/确认流程。</div> : null}
      <pre>{JSON.stringify(result.action, null, 2)}</pre>
    </div>
  );
}