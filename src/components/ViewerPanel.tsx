import { BoxSelect, Camera, Layers, Move3D } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { DisplayMode } from '../domain/actions';
import type { VtkRuntime } from '../viewer/vtkRuntime';

type ViewerPanelProps = {
  runtime: VtkRuntime;
  meshCount: number;
  selectedName?: string;
  displayMode: DisplayMode;
  onDisplayModeChange: (mode: DisplayMode) => void;
  onResetView: (orientation: 'isometric' | 'front' | 'top' | 'right') => void;
  onDropFile: (file: File) => void;
};

export function ViewerPanel({ runtime, meshCount, selectedName, displayMode, onDisplayModeChange, onResetView, onDropFile }: ViewerPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    runtime.mount(containerRef.current);
    return () => runtime.dispose();
  }, [runtime]);

  return (
    <main
      className="viewer-panel"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const file = event.dataTransfer.files?.[0];
        if (file) onDropFile(file);
      }}
    >
      <div className="viewport-toolbar">
        <button title="点击视窗对象或对象树可选择"><BoxSelect size={16} /></button>
        <button className={displayMode === 'surface' ? 'active' : ''} title="实体显示" onClick={() => onDisplayModeChange('surface')}><Layers size={16} /></button>
        <button className={displayMode === 'wireframe' ? 'active' : ''} title="线框显示" onClick={() => onDisplayModeChange('wireframe')}>W</button>
        <button className={displayMode === 'points' ? 'active' : ''} title="点显示" onClick={() => onDisplayModeChange('points')}>P</button>
        <button title="等轴测视图" onClick={() => onResetView('isometric')}><Move3D size={16} /></button>
        <button title="正视图" onClick={() => onResetView('front')}><Camera size={16} /></button>
      </div>
      <div ref={containerRef} className="vtk-container" />
      {meshCount === 0 ? (
        <div className="viewport-empty">
          <strong>拖入 STL / OBJ / PLY / VTP 文件</strong>
          <span>或点击顶部“示例涡扇”开始演示自然语言三维操作。</span>
        </div>
      ) : null}
      <div className="orientation-cube" title="当前视图可通过工具栏重置">ISO</div>
      <div className="viewport-status">
        <span>{meshCount} visible</span>
        <span>{displayMode}</span>
        <span>{selectedName ?? '未选择'}</span>
      </div>
    </main>
  );
}
