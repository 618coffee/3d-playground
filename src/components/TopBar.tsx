import { Download, FileUp, Play, RotateCcw, RotateCw, Save, Undo2 } from 'lucide-react';
import type { DisplayMode } from '../domain/actions';

type TopBarProps = {
  meshCount: number;
  selectedCount: number;
  visibleCount: number;
  displayMode: DisplayMode;
  canUndo: boolean;
  canRedo: boolean;
  onLoadSample: () => void;
  onImportFile: (file: File) => void;
  onUndo: () => void;
  onRedo: () => void;
  onResetView: () => void;
};

export function TopBar({ meshCount, selectedCount, visibleCount, displayMode, canUndo, canRedo, onLoadSample, onImportFile, onUndo, onRedo, onResetView }: TopBarProps) {
  return (
    <header className="top-bar">
      <div className="brand-block">
        <div className="brand-title">AI 工业三维网格工作台</div>
        <div className="brand-subtitle">vtk.js / Browser MVP</div>
      </div>
      <div className="top-actions">
        <button className="primary-button" onClick={onLoadSample} title="加载程序生成的涡扇示例模型">
          <Play size={16} /> 示例涡扇
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
