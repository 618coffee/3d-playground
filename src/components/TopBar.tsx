import {
  Download,
  FileUp,
  PanelBottomClose,
  PanelBottomOpen,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  RotateCw,
  Save,
  Undo2,
} from 'lucide-react';
import type { DisplayMode } from '../domain/actions';
import type { SampleWorkspaceId, SampleWorkspaceOption } from '../viewer/sampleEngine';

type PanelKey = 'left' | 'right' | 'bottom';
type PanelVisibility = Record<PanelKey, boolean>;

type TopBarProps = {
  meshCount: number;
  selectedCount: number;
  visibleCount: number;
  displayMode: DisplayMode;
  canUndo: boolean;
  canRedo: boolean;
  workspaces: SampleWorkspaceOption[];
  activeWorkspace: SampleWorkspaceId;
  panelVisibility: PanelVisibility;
  onSelectWorkspace: (workspaceId: SampleWorkspaceId) => void;
  onReloadWorkspace: () => void;
  onTogglePanel: (panel: PanelKey) => void;
  onImportFile: (file: File) => void;
  onUndo: () => void;
  onRedo: () => void;
  onResetView: () => void;
};

export function TopBar({
  meshCount,
  selectedCount,
  visibleCount,
  displayMode,
  canUndo,
  canRedo,
  workspaces,
  activeWorkspace,
  panelVisibility,
  onSelectWorkspace,
  onReloadWorkspace,
  onTogglePanel,
  onImportFile,
  onUndo,
  onRedo,
  onResetView,
}: TopBarProps) {
  return (
    <header className="top-bar">
      <div className="brand-block">
        <div className="brand-title">AI 工业三维网格工作台</div>
        <div className="brand-subtitle">vtk.js / Browser MVP</div>
      </div>
      <div className="top-actions">
        <label className="workspace-select" title="切换内置工作区模型">
          <span>工作区</span>
          <select value={activeWorkspace} onChange={(event) => onSelectWorkspace(event.target.value as SampleWorkspaceId)}>
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>{workspace.label}</option>
            ))}
          </select>
        </label>
        <button className="icon-button" onClick={onReloadWorkspace} title="重新加载当前工作区">
          <RotateCw size={16} />
        </button>
        <label className="icon-button text-button" title="导入 STL/OBJ/PLY/VTP 文件">
          <FileUp size={16} /> 导入
          <input
            type="file"
            accept=".stl,.obj,.ply,.vtp"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onImportFile(file);
              event.currentTarget.value = '';
            }}
          />
        </label>
        <button className="icon-button" disabled={!canUndo} onClick={onUndo} title="撤销">
          <Undo2 size={16} />
        </button>
        <button className="icon-button" disabled={!canRedo} onClick={onRedo} title="重做">
          <RotateCcw size={16} />
        </button>
        <button className="icon-button" onClick={onResetView} title="适配视图">
          <RotateCw size={16} />
        </button>
        <span className="toolbar-divider" aria-hidden="true" />
        <button className={`icon-button ${panelVisibility.left ? 'active' : ''}`} onClick={() => onTogglePanel('left')} title={panelVisibility.left ? '隐藏左侧对象树' : '显示左侧对象树'} aria-pressed={panelVisibility.left}>
          {panelVisibility.left ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </button>
        <button className={`icon-button ${panelVisibility.right ? 'active' : ''}`} onClick={() => onTogglePanel('right')} title={panelVisibility.right ? '隐藏右侧检查器' : '显示右侧检查器'} aria-pressed={panelVisibility.right}>
          {panelVisibility.right ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
        </button>
        <button className={`icon-button ${panelVisibility.bottom ? 'active' : ''}`} onClick={() => onTogglePanel('bottom')} title={panelVisibility.bottom ? '隐藏底部时间线' : '显示底部时间线'} aria-pressed={panelVisibility.bottom}>
          {panelVisibility.bottom ? <PanelBottomClose size={16} /> : <PanelBottomOpen size={16} />}
        </button>
        <button className="icon-button" title="导出项目状态将在增强版开放" disabled>
          <Save size={16} />
        </button>
        <button className="icon-button" title="导出网格将在增强版开放" disabled>
          <Download size={16} />
        </button>
      </div>
      <div className="status-strip">
        <span>{meshCount} 对象</span>
        <span>{visibleCount} 可见</span>
        <span>{selectedCount} 选中</span>
        <span>{displayMode}</span>
        <span>单位 mm</span>
      </div>
    </header>
  );
}
