import { type ReactNode, useEffect, useId, useMemo, useState } from 'react';
import { Bot, Check, ChevronDown, ChevronUp, PanelRightClose, SlidersHorizontal, X } from 'lucide-react';
import type { ActionResult, MeshEntity, OperationCommand } from '../domain/actions';
import type { HistoryEntry } from '../domain/history';
import type { MeshClipboardEntry } from '../domain/meshClipboard';
import type { SceneState } from '../domain/scene';
import { AgentPanel } from './AgentPanel';

type InspectorPanelProps = {
  scene: SceneState;
  selectedMesh?: MeshEntity;
  selectedMeshes: MeshEntity[];
  historyEntries: HistoryEntry[];
  pendingCommand: OperationCommand | null;
  onConfirmPending: () => void;
  onCancelPending: () => void;
  onExecute: (command: OperationCommand) => ActionResult;
  onPreviewDraft?: (command: OperationCommand) => void;
  onHidePanel?: () => void;
  meshClipboard?: MeshClipboardEntry[];
};

const axisOptions = ['x', 'y', 'z'] as const;

export function InspectorPanel({ scene, selectedMesh, selectedMeshes, historyEntries, pendingCommand, onConfirmPending, onCancelPending, onExecute, onPreviewDraft, onHidePanel, meshClipboard = [] }: InspectorPanelProps) {
  const [tab, setTab] = useState<'operations' | 'agent'>('agent');

  return (
    <aside className="right-panel panel-shell">
      <div className="inspector-header">
        <strong>操作台</strong>
        {onHidePanel ? (
          <button type="button" className="icon-button panel-icon-button" onClick={onHidePanel} title="隐藏操作台" aria-label="隐藏操作台">
            <PanelRightClose size={15} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <div className="tabs two-tabs">
        <button className={tab === 'operations' ? 'active' : ''} onClick={() => setTab('operations')}><SlidersHorizontal size={15} /> 手动</button>
        <button className={tab === 'agent' ? 'active' : ''} onClick={() => setTab('agent')}><Bot size={15} /> AI 助手</button>
      </div>
      <PendingActionCard command={pendingCommand?.source === 'agent' ? null : pendingCommand} onConfirm={onConfirmPending} onCancel={onCancelPending} />
      {tab === 'operations' ? <OperationsTab selectedMesh={selectedMesh} scene={scene} onExecute={onExecute} /> : null}
      {tab === 'agent' ? <AgentPanel scene={scene} selectedMeshes={selectedMeshes} historyEntries={historyEntries} pendingCommand={pendingCommand} onExecute={onExecute} onConfirmPending={onConfirmPending} onCancelPending={onCancelPending} onPreviewDraft={onPreviewDraft} meshClipboard={meshClipboard} /> : null}
    </aside>
  );
}

function PendingActionCard({ command, onConfirm, onCancel }: { command: OperationCommand | null; onConfirm: () => void; onCancel: () => void }) {
  if (!command) return null;

  return (
    <div className="pending-action-card">
      <div>
        <strong>{pendingTitle(command)}</strong>
        <span>{pendingDescription(command)}</span>
      </div>
      <div className="button-row no-wrap">
        <button className="primary-button" onClick={onConfirm}><Check size={14} /> {pendingConfirmLabel(command)}</button>
        <button onClick={onCancel}><X size={14} /> 取消</button>
      </div>
    </div>
  );
}

type PropertiesPanelProps = {
  mesh?: MeshEntity;
  selectedMeshes: MeshEntity[];
  onRename?: (meshId: string, name: string) => void;
};

export function PropertiesPanel({ mesh, selectedMeshes, onRename }: PropertiesPanelProps) {
  const [draftName, setDraftName] = useState(mesh?.name ?? '');
  const [editingName, setEditingName] = useState(false);

  useEffect(() => {
    setDraftName(mesh?.name ?? '');
    setEditingName(false);
  }, [mesh?.id, mesh?.name]);

  if (!mesh) {
    return <div className="empty-panel roomy">请选择对象，或从对象树里点选一个 mesh。</div>;
  }

  const canRename = selectedMeshes.length <= 1 && Boolean(onRename);
  const startRename = () => {
    if (!canRename) return;
    setDraftName(mesh.name);
    setEditingName(true);
  };
  const commitRename = () => {
    const name = draftName.trim();
    setEditingName(false);
    if (!name) {
      setDraftName(mesh.name);
      return;
    }
    if (name === mesh.name) return;
    onRename?.(mesh.id, name);
  };

  const rows = [
    ['格式', mesh.sourceFormat],
    ['点数', mesh.stats.points.toLocaleString()],
    ['单元', mesh.stats.cells.toLocaleString()],
    ['状态', `${mesh.visible ? '可见' : '隐藏'} / ${mesh.locked ? '锁定' : '未锁定'}`],
    ['切割', mesh.clipping ? `${mesh.clipping.keepSide} @ ${mesh.clipping.plane.origin.join(', ')}` : '无'],
    ['位置', mesh.transform.position.join(', ')],
    ['旋转', mesh.transform.rotationDeg.join(', ')],
    ['Bounds X', `${mesh.bounds[0]} / ${mesh.bounds[1]}`],
    ['Bounds Y', `${mesh.bounds[2]} / ${mesh.bounds[3]}`],
    ['Bounds Z', `${mesh.bounds[4]} / ${mesh.bounds[5]}`],
  ];

  return (
    <div className="panel-body">
      <div className="object-title-row">
        <span className="swatch large" style={{ background: mesh.color }} />
        <div>
          {canRename && editingName ? (
            <input
              className="mesh-name-input"
              aria-label="对象名称"
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              onBlur={commitRename}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitRename();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setDraftName(mesh.name);
                  setEditingName(false);
                }
              }}
            />
          ) : (
            <strong onDoubleClick={startRename} title={canRename ? '双击重命名' : undefined}>{selectedMeshes.length > 1 ? `${selectedMeshes.length} 个对象已选中` : mesh.name}</strong>
          )}
          <span>{mesh.id}</span>
        </div>
      </div>
      {selectedMeshes.length > 1 ? (
        <div className="selection-summary">
          {selectedMeshes.map((item) => (
            <span key={item.id}>{item.name}</span>
          ))}
        </div>
      ) : null}
      <div className="property-grid">
        {rows.map(([label, value]) => (
          <div className="property-row" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function OperationsTab({ selectedMesh, scene, onExecute }: { selectedMesh?: MeshEntity; scene: SceneState; onExecute: (command: OperationCommand) => ActionResult }) {
  const [moveOffsets, setMoveOffsets] = useState<Record<'x' | 'y' | 'z', number>>({ x: 0, y: 0, z: 0 });
  const [rotationAngles, setRotationAngles] = useState<Record<'x' | 'y' | 'z', number>>({ x: 0, y: 0, z: 0 });
  const [cloneCount, setCloneCount] = useState(0);
  const [cloneAxis, setCloneAxis] = useState<'x' | 'y' | 'z'>('x');
  const [cloneDistance, setCloneDistance] = useState(0);
  const [clipAxis, setClipAxis] = useState<'x' | 'y' | 'z'>('x');
  const [clipOrigin, setClipOrigin] = useState(0);
  const [keepSide, setKeepSide] = useState<'positive' | 'negative'>('positive');
  const [clipPreviewActive, setClipPreviewActive] = useState(false);
  const disabled = !selectedMesh;
  const target = useMemo(() => ({ source: 'selection' }) as const, []);
  const cloneDisabled = disabled || cloneCount <= 0 || cloneDistance <= 0;
  const clipCommitDisabled = disabled || !clipPreviewActive;

  const updateMoveOffset = (axis: 'x' | 'y' | 'z', value: number) => {
    setMoveOffsets((current) => ({ ...current, [axis]: value }));
  };

  const applyMove = () => {
    if (disabled) return;
    const offset: [number, number, number] = [moveOffsets.x, moveOffsets.y, moveOffsets.z];
    if (offset.every((value) => value === 0)) return;
    onExecute({
      id: `ui-move-${Date.now()}`,
      type: 'moveMesh',
      target,
      params: { offset, unit: scene.unit },
      source: 'ui',
      rawText: `手动移动 X=${offset[0]}, Y=${offset[1]}, Z=${offset[2]} ${scene.unit}`,
    });
  };

  const updateRotationAngle = (axis: 'x' | 'y' | 'z', value: number) => {
    setRotationAngles((current) => ({ ...current, [axis]: value }));
  };

  const applyRotation = () => {
    if (disabled) return;
    const timestamp = Date.now();
    axisOptions.forEach((axis) => {
      const angleDeg = rotationAngles[axis];
      if (angleDeg === 0) return;
      onExecute({
        id: `ui-rotate-${axis}-${timestamp}`,
        type: 'rotateMesh',
        target,
        params: { axis, angleDeg, pivot: 'boundsCenter', space: 'world' },
        source: 'ui',
        rawText: `手动旋转 ${axis.toUpperCase()} 轴 ${angleDeg} 度`,
      });
    });
  };

  const previewClip = () => {
    if (disabled) return;
    const result = onExecute({ id: `ui-clip-preview-${Date.now()}`, type: 'clipMesh', target, params: { plane: { origin: originForAxis(clipAxis, clipOrigin), normal: normalForAxis(clipAxis) }, keepSide, mode: 'preview', cap: true }, source: 'ui', rawText: `手动预览 ${clipAxis.toUpperCase()}=${clipOrigin} 切割` });
    if (result.status === 'preview') setClipPreviewActive(true);
  };

  const applyClip = () => {
    if (clipCommitDisabled) return;
    onExecute({ id: `ui-clip-apply-${Date.now()}`, type: 'clipMesh', target, params: { plane: { origin: originForAxis(clipAxis, clipOrigin), normal: normalForAxis(clipAxis) }, keepSide, mode: 'applyVisualClip', cap: true }, source: 'ui', confirmed: true, rawText: `手动应用 ${clipAxis.toUpperCase()}=${clipOrigin} 切割` });
    setClipPreviewActive(false);
  };

  const clearClip = () => {
    if (clipCommitDisabled) return;
    onExecute({ id: `ui-clip-clear-${Date.now()}`, type: 'clipMesh', target, params: { plane: { origin: [0, 0, 0], normal: [1, 0, 0] }, keepSide: 'positive', mode: 'clearVisualClip', cap: false }, source: 'ui', confirmed: true, rawText: '手动清除切割' });
    setClipPreviewActive(false);
  };

  return (
    <div className="panel-body stacked">
      <CollapsibleToolSection title="移动">
        {axisOptions.map((axis) => (
          <NumberField
            key={axis}
            label={`${axis.toUpperCase()} 轴`}
            value={moveOffsets[axis]}
            onChange={(value) => updateMoveOffset(axis, value)}
            suffix={scene.unit}
            incrementLabel={`增加 ${axis.toUpperCase()} 轴位移`}
            decrementLabel={`减少 ${axis.toUpperCase()} 轴位移`}
          />
        ))}
        <div className="tool-action-row" role="group" aria-label="移动操作">
          <button disabled={disabled || axisOptions.every((axis) => moveOffsets[axis] === 0)} className="primary-button" onClick={applyMove}>应用移动</button>
        </div>
      </CollapsibleToolSection>
      <CollapsibleToolSection title="旋转">
        {axisOptions.map((axis) => (
          <NumberField
            key={axis}
            label={`${axis.toUpperCase()} 轴`}
            value={rotationAngles[axis]}
            onChange={(value) => updateRotationAngle(axis, value)}
            incrementLabel={`增加 ${axis.toUpperCase()} 轴角度`}
            decrementLabel={`减少 ${axis.toUpperCase()} 轴角度`}
          />
        ))}
        <div className="tool-action-row" role="group" aria-label="旋转操作">
          <button disabled={disabled || axisOptions.every((axis) => rotationAngles[axis] === 0)} className="primary-button" onClick={applyRotation}>应用旋转</button>
        </div>
      </CollapsibleToolSection>
      <CollapsibleToolSection title="复制">
        <NumberField label="数量" min={0} max={12} value={cloneCount} onChange={setCloneCount} incrementLabel="增加数量" decrementLabel="减少数量" />
        <div className="field-row">
          <span id="clone-axis-label">方向</span>
          <div className="segmented-control" role="group" aria-labelledby="clone-axis-label">
            {axisOptions.map((axis) => (
              <button key={axis} type="button" className={cloneAxis === axis ? 'active' : ''} aria-pressed={cloneAxis === axis} onClick={() => setCloneAxis(axis)}>
                {axis.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <NumberField label="间隔" min={0} value={cloneDistance} onChange={setCloneDistance} incrementLabel="增加间隔" decrementLabel="减少间隔" />
        <div className="tool-action-row" role="group" aria-label="复制操作">
          <button className="primary-button" disabled={cloneDisabled} onClick={() => onExecute({ id: `ui-clone-${Date.now()}`, type: 'cloneMesh', target, params: { count: cloneCount, offset: axisVector(cloneAxis, cloneDistance), unit: scene.unit, shareGeometry: true, namePattern: '{name}-copy-{n}' }, source: 'ui', rawText: `手动复制 ${cloneCount} 个对象，沿 ${cloneAxis.toUpperCase()} 方向间隔 ${cloneDistance}${scene.unit}` })}>
            复制对象
          </button>
        </div>
      </CollapsibleToolSection>
      <CollapsibleToolSection title="切割">
        <div className="field-row">
          <span id="clip-axis-label">平面</span>
          <div className="segmented-control" role="group" aria-labelledby="clip-axis-label">
            {axisOptions.map((axis) => (
              <button key={axis} type="button" className={clipAxis === axis ? 'active' : ''} aria-pressed={clipAxis === axis} onClick={() => { setClipAxis(axis); setClipPreviewActive(false); }}>
                {axis.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <NumberField label="坐标" value={clipOrigin} onChange={(value) => { setClipOrigin(value); setClipPreviewActive(false); }} incrementLabel="增加坐标" decrementLabel="减少坐标" />
        <div className="field-row">
          <span id="clip-side-label">保留</span>
          <div className="segmented-control two-options" role="group" aria-labelledby="clip-side-label">
            <button type="button" className={keepSide === 'positive' ? 'active' : ''} aria-pressed={keepSide === 'positive'} onClick={() => { setKeepSide('positive'); setClipPreviewActive(false); }}>正侧</button>
            <button type="button" className={keepSide === 'negative' ? 'active' : ''} aria-pressed={keepSide === 'negative'} onClick={() => { setKeepSide('negative'); setClipPreviewActive(false); }}>负侧</button>
          </div>
        </div>
        <div className="tool-action-row clip-action-row" role="group" aria-label="切割操作">
          {!clipPreviewActive ? (
            <button disabled={disabled} onClick={previewClip}>
              预览切割
            </button>
          ) : (
            <>
              <button className="danger-button" disabled={clipCommitDisabled} onClick={clearClip}>
                清除切割
              </button>
              <button className="primary-button" disabled={clipCommitDisabled} onClick={applyClip}>
                应用切割
              </button>
            </>
          )}
        </div>
      </CollapsibleToolSection>
    </div>
  );
}

function CollapsibleToolSection({ title, meta, children }: { title: string; meta?: string; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const contentId = useId();

  return (
    <section className={`tool-section ${collapsed ? 'is-collapsed' : ''}`} aria-label={title}>
      <button
        type="button"
        className="section-title section-toggle"
        aria-label={`${collapsed ? '展开' : '折叠'}${title}`}
        aria-expanded={!collapsed}
        aria-controls={contentId}
        onClick={() => setCollapsed((current) => !current)}
      >
        <span className="section-title-main">{title}</span>
        <span className="section-title-side">{meta}</span>
        {collapsed ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronUp size={14} aria-hidden="true" />}
      </button>
      <div id={contentId} className="tool-section-body-frame" aria-hidden={collapsed}>
        <div className="tool-section-body">{children}</div>
      </div>
    </section>
  );
}

function NumberField({ label, value, onChange, min, max, step = 1, suffix, incrementLabel, decrementLabel }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number; suffix?: string; incrementLabel: string; decrementLabel: string }) {
  const inputId = useId();
  const [inputValue, setInputValue] = useState(String(value));
  const commitValue = (nextValue: number) => {
    const clampedValue = clampNumber(nextValue, min, max);
    setInputValue(String(clampedValue));
    onChange(clampedValue);
  };

  useEffect(() => {
    setInputValue(String(value));
  }, [value]);

  const handleInputChange = (nextValue: string) => {
    setInputValue(nextValue);
    if (nextValue === '') return;
    commitValue(Number(nextValue));
  };

  const handleInputBlur = () => {
    if (inputValue === '') {
      commitValue(min ?? 0);
      return;
    }
    commitValue(Number(inputValue));
  };

  return (
    <div className="field-row number-field">
      <label htmlFor={inputId}>{label}</label>
      <div className={`number-stepper-control ${suffix ? 'has-suffix' : ''}`}>
        <div className="number-input-shell">
          <input id={inputId} type="number" min={min} max={max} step={step} value={inputValue} onChange={(event) => handleInputChange(event.target.value)} onBlur={handleInputBlur} />
          {suffix ? <span className="number-field-suffix" aria-hidden="true">{suffix}</span> : null}
        </div>
        <div className="number-stepper-buttons">
          <button type="button" aria-label={incrementLabel} onClick={() => commitValue(value + step)}><ChevronUp size={12} aria-hidden="true" /></button>
          <button type="button" aria-label={decrementLabel} onClick={() => commitValue(value - step)}><ChevronDown size={12} aria-hidden="true" /></button>
        </div>
      </div>
    </div>
  );
}

function clampNumber(value: number, min?: number, max?: number): number {
  if (!Number.isFinite(value)) return min ?? 0;
  if (min !== undefined && value < min) return min;
  if (max !== undefined && value > max) return max;
  return value;
}

function axisVector(axis: 'x' | 'y' | 'z', value: number): [number, number, number] {
  if (axis === 'x') return [value, 0, 0];
  if (axis === 'y') return [0, value, 0];
  return [0, 0, value];
}

function originForAxis(axis: 'x' | 'y' | 'z', value: number): [number, number, number] {
  return axisVector(axis, value);
}

function normalForAxis(axis: 'x' | 'y' | 'z'): [number, number, number] {
  return axisVector(axis, 1);
}

function pendingTitle(command: OperationCommand): string {
  if (command.type === 'clipMesh') return '待确认切割';
  if (command.type === 'cloneMesh') return '待确认复制';
  if (command.type === 'moveMesh') return '待确认移动';
  if (command.type === 'rotateMesh') return '待确认旋转';
  if (command.type === 'setMeshScale') return '待确认缩放';
  return '待确认操作';
}

function pendingDescription(command: OperationCommand): string {
  if (command.type === 'clipMesh') return '预览已经显示在视窗中，确认后写入历史，取消会恢复当前场景。';
  if (command.type === 'cloneMesh') return `将复制 ${command.params.count} 个对象。`;
  if (command.type === 'moveMesh') return `将移动 ${command.params.offset.join(', ')} ${command.params.unit}。`;
  if (command.type === 'rotateMesh') return `旋转预览已经显示在视窗中，将应用 ${command.params.angleDeg} 度。`;
  if (command.type === 'setMeshScale') return `缩放预览已经显示在视窗中，将应用 ${command.params.scale.join(', ')}。`;
  return command.type;
}

function pendingConfirmLabel(command: OperationCommand): string {
  if (command.type === 'clipMesh') return '确认应用';
  if (command.type === 'cloneMesh') return '确认复制';
  if (command.type === 'moveMesh' || command.type === 'rotateMesh' || command.type === 'setMeshScale') return '确认应用';
  return '确认';
}
