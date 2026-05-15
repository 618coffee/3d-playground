import { useMemo, useState } from 'react';
import { Bot, Boxes, Check, PanelRightClose, SlidersHorizontal, X } from 'lucide-react';
import type { ActionResult, MeshEntity, OperationCommand } from '../domain/actions';
import type { HistoryEntry } from '../domain/history';
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
};

export function InspectorPanel({ scene, selectedMesh, selectedMeshes, historyEntries, pendingCommand, onConfirmPending, onCancelPending, onExecute, onPreviewDraft, onHidePanel }: InspectorPanelProps) {
  const [tab, setTab] = useState<'properties' | 'operations' | 'agent'>('agent');

  return (
    <aside className="right-panel panel-shell">
      <div className="inspector-header">
        <strong>检查器</strong>
        {onHidePanel ? (
          <button type="button" className="icon-button panel-icon-button" onClick={onHidePanel} title="隐藏检查器" aria-label="隐藏检查器">
            <PanelRightClose size={15} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <div className="tabs">
        <button className={tab === 'properties' ? 'active' : ''} onClick={() => setTab('properties')}><Boxes size={15} /> 属性</button>
        <button className={tab === 'operations' ? 'active' : ''} onClick={() => setTab('operations')}><SlidersHorizontal size={15} /> 操作</button>
        <button className={tab === 'agent' ? 'active' : ''} onClick={() => setTab('agent')}><Bot size={15} /> AI</button>
      </div>
      <PendingActionCard command={pendingCommand} onConfirm={onConfirmPending} onCancel={onCancelPending} />
      {tab === 'properties' ? <PropertiesTab mesh={selectedMesh} selectedMeshes={selectedMeshes} /> : null}
      {tab === 'operations' ? <OperationsTab selectedMesh={selectedMesh} selectedCount={selectedMeshes.length} scene={scene} onExecute={onExecute} /> : null}
      {tab === 'agent' ? <AgentPanel scene={scene} historyEntries={historyEntries} pendingCommand={pendingCommand} onExecute={onExecute} onConfirmPending={onConfirmPending} onCancelPending={onCancelPending} onPreviewDraft={onPreviewDraft} /> : null}
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

function PropertiesTab({ mesh, selectedMeshes }: { mesh?: MeshEntity; selectedMeshes: MeshEntity[] }) {
  if (!mesh) {
    return <div className="empty-panel roomy">请选择对象，或从对象树里点选一个 mesh。</div>;
  }

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
          <strong>{selectedMeshes.length > 1 ? `${selectedMeshes.length} 个对象已选中` : mesh.name}</strong>
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

function OperationsTab({ selectedMesh, selectedCount, scene, onExecute }: { selectedMesh?: MeshEntity; selectedCount: number; scene: SceneState; onExecute: (command: OperationCommand) => ActionResult }) {
  const [angle, setAngle] = useState(30);
  const [cloneCount, setCloneCount] = useState(2);
  const [cloneAxis, setCloneAxis] = useState<'x' | 'y' | 'z'>('x');
  const [cloneDistance, setCloneDistance] = useState(18);
  const [clipAxis, setClipAxis] = useState<'x' | 'y' | 'z'>('x');
  const [clipOrigin, setClipOrigin] = useState(0);
  const [keepSide, setKeepSide] = useState<'positive' | 'negative'>('positive');
  const disabled = !selectedMesh;
  const target = useMemo(() => ({ source: 'selection' }) as const, []);

  return (
    <div className="panel-body stacked">
      <section className="tool-section">
        <div className="section-title">旋转 <span>{selectedCount || 0} selected</span></div>
        <label className="field-row">
          <span>角度</span>
          <input type="number" value={angle} onChange={(event) => setAngle(Number(event.target.value))} />
        </label>
        <div className="button-row">
          {(['x', 'y', 'z'] as const).map((axis) => (
            <button key={axis} disabled={disabled} onClick={() => onExecute({ id: `ui-rotate-${Date.now()}`, type: 'rotateMesh', target, params: { axis, angleDeg: angle, pivot: 'boundsCenter', space: 'world' }, source: 'ui' })}>
              {axis.toUpperCase()} 轴
            </button>
          ))}
        </div>
      </section>
      <section className="tool-section">
        <div className="section-title">复制</div>
        <label className="field-row">
          <span>数量</span>
          <input type="number" min={1} max={12} value={cloneCount} onChange={(event) => setCloneCount(Number(event.target.value))} />
        </label>
        <label className="field-row">
          <span>方向</span>
          <select value={cloneAxis} onChange={(event) => setCloneAxis(event.target.value as 'x' | 'y' | 'z')}>
            <option value="x">X</option>
            <option value="y">Y</option>
            <option value="z">Z</option>
          </select>
        </label>
        <label className="field-row">
          <span>间隔</span>
          <input type="number" value={cloneDistance} onChange={(event) => setCloneDistance(Number(event.target.value))} />
        </label>
        <button disabled={disabled} onClick={() => onExecute({ id: `ui-clone-${Date.now()}`, type: 'cloneMesh', target, params: { count: cloneCount, offset: axisVector(cloneAxis, cloneDistance), unit: scene.unit, shareGeometry: true, namePattern: '{name}-copy-{n}' }, source: 'ui' })}>
          复制对象
        </button>
      </section>
      <section className="tool-section">
        <div className="section-title">切割预览</div>
        <label className="field-row">
          <span>平面</span>
          <select value={clipAxis} onChange={(event) => setClipAxis(event.target.value as 'x' | 'y' | 'z')}>
            <option value="x">X</option>
            <option value="y">Y</option>
            <option value="z">Z</option>
          </select>
        </label>
        <label className="field-row">
          <span>坐标</span>
          <input type="number" value={clipOrigin} onChange={(event) => setClipOrigin(Number(event.target.value))} />
        </label>
        <label className="field-row">
          <span>保留</span>
          <select value={keepSide} onChange={(event) => setKeepSide(event.target.value as 'positive' | 'negative')}>
            <option value="positive">正侧</option>
            <option value="negative">负侧</option>
          </select>
        </label>
        <div className="button-row">
          <button disabled={disabled} onClick={() => onExecute({ id: `ui-clip-preview-${Date.now()}`, type: 'clipMesh', target, params: { plane: { origin: originForAxis(clipAxis, clipOrigin), normal: normalForAxis(clipAxis) }, keepSide, mode: 'preview', cap: true }, source: 'ui' })}>
            预览
          </button>
          <button disabled={disabled} className="primary-button" onClick={() => onExecute({ id: `ui-clip-apply-${Date.now()}`, type: 'clipMesh', target, params: { plane: { origin: originForAxis(clipAxis, clipOrigin), normal: normalForAxis(clipAxis) }, keepSide, mode: 'applyVisualClip', cap: true }, source: 'ui' })}>
            应用
          </button>
        </div>
        <button disabled={disabled || !selectedMesh?.clipping} onClick={() => onExecute({ id: `ui-clip-clear-${Date.now()}`, type: 'clipMesh', target, params: { plane: { origin: [0, 0, 0], normal: [1, 0, 0] }, keepSide: 'positive', mode: 'clearVisualClip', cap: false }, source: 'ui', confirmed: true })}>
          清除切割
        </button>
      </section>
    </div>
  );
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
  return '待确认操作';
}

function pendingDescription(command: OperationCommand): string {
  if (command.type === 'clipMesh') return '预览已经显示在视窗中，确认后写入历史，取消会恢复当前场景。';
  if (command.type === 'cloneMesh') return `将复制 ${command.params.count} 个对象。`;
  return command.type;
}

function pendingConfirmLabel(command: OperationCommand): string {
  if (command.type === 'clipMesh') return '确认应用';
  if (command.type === 'cloneMesh') return '确认复制';
  return '确认';
}
