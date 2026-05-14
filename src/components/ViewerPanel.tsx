import { BoxSelect, Camera, Layers, Move3D, Orbit, RotateCcw, ZoomIn } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DisplayMode } from '../domain/actions';
import type { VtkRuntime } from '../viewer/vtkRuntime';

type ViewerPanelProps = {
  runtime: VtkRuntime;
  meshCount: number;
  selectedName?: string;
  viewScale: number;
  displayMode: DisplayMode;
  onDisplayModeChange: (mode: DisplayMode) => void;
  onResetView: (orientation: 'isometric' | 'front' | 'top' | 'right') => void;
  onRotateSelection: (deltaX: number, deltaY: number) => void;
  onViewScaleChange: (scale: number) => void;
  onDropFile: (file: File) => void;
};

const VIEW_SCALE_PRESETS = [0.2, 0.5, 0.8, 1, 1.2, 1.5, 2];

export function ViewerPanel({ runtime, meshCount, selectedName, viewScale, displayMode, onDisplayModeChange, onResetView, onRotateSelection, onViewScaleChange, onDropFile }: ViewerPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rotatePointerRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const [objectRotateEnabled, setObjectRotateEnabled] = useState(false);
  const hasSelection = Boolean(selectedName);
  const clampedViewScale = clampViewScale(viewScale);
  const scaleSliderValue = scaleToSliderValue(clampedViewScale);
  const preset = presetValue(clampedViewScale);
  const isPreset = preset !== undefined;
  const selectValue = isPreset ? String(preset) : String(clampedViewScale);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    runtime.mount(container);
    const resize = () => runtime.resize();
    const frame = window.requestAnimationFrame(resize);
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      runtime.dispose();
    };
  }, [runtime]);

  const stopRotateDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // Synthetic pointer events in smoke tests may not own capture.
    }
    rotatePointerRef.current = null;
  }, []);

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
        <button
          className={objectRotateEnabled ? 'active' : ''}
          disabled={!hasSelection}
          title="拖拽旋转所选对象"
          aria-pressed={objectRotateEnabled}
          onClick={() => setObjectRotateEnabled((enabled) => !enabled)}
        >
          <Orbit size={16} />
        </button>
        <button className={displayMode === 'surface' ? 'active' : ''} title="实体显示" onClick={() => onDisplayModeChange('surface')}><Layers size={16} /></button>
        <button className={displayMode === 'wireframe' ? 'active' : ''} title="线框显示" onClick={() => onDisplayModeChange('wireframe')}>W</button>
        <button className={displayMode === 'points' ? 'active' : ''} title="点显示" onClick={() => onDisplayModeChange('points')}>P</button>
        <button title="等轴测视图" onClick={() => onResetView('isometric')}><Move3D size={16} /></button>
        <button title="正视图" onClick={() => onResetView('front')}><Camera size={16} /></button>
      </div>
      <div ref={containerRef} className="vtk-container" />
      {objectRotateEnabled && hasSelection ? (
        <div
          className="object-rotate-capture"
          data-testid="object-rotate-capture"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            try {
              event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
              // Synthetic pointer events in smoke tests may not be captureable.
            }
            rotatePointerRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
          }}
          onPointerMove={(event) => {
            const pointer = rotatePointerRef.current;
            if (!pointer || pointer.pointerId !== event.pointerId) return;
            event.preventDefault();
            event.stopPropagation();
            const deltaX = event.clientX - pointer.x;
            const deltaY = event.clientY - pointer.y;
            rotatePointerRef.current = { ...pointer, x: event.clientX, y: event.clientY };
            onRotateSelection(deltaX, deltaY);
          }}
          onPointerUp={stopRotateDrag}
          onPointerCancel={stopRotateDrag}
        />
      ) : null}
      {meshCount === 0 ? (
        <div className="viewport-empty">
          <strong>拖入 STL / OBJ / PLY / VTP 文件</strong>
          <span>或点击顶部“示例涡扇”开始演示自然语言三维操作。</span>
        </div>
      ) : null}
      <div className="view-scale-control" aria-label="视图比例控制">
        <ZoomIn size={14} aria-hidden="true" />
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={scaleSliderValue}
          aria-label="视图比例滑杆"
          onChange={(event) => onViewScaleChange(sliderValueToScale(Number(event.target.value)))}
        />
        <select
          value={selectValue}
          aria-label="视图比例"
          onChange={(event) => onViewScaleChange(clampViewScale(Number(event.target.value)))}
        >
          {VIEW_SCALE_PRESETS.map((scale) => (
            <option key={scale} value={scale}>{formatPercent(scale)}</option>
          ))}
          {!isPreset ? <option value={clampedViewScale}>{formatPercent(clampedViewScale)}</option> : null}
        </select>
        <button type="button" className="icon-button" title="重置视图比例" aria-label="重置视图比例" onClick={() => onViewScaleChange(1)}>
          <RotateCcw size={14} aria-hidden="true" />
        </button>
      </div>
      <div className="orientation-cube" title="当前视图可通过工具栏重置">ISO</div>
      <div className="viewport-status">
        <span>{meshCount} visible</span>
        <span>{displayMode}</span>
        <span>{selectedName ?? '未选择'}</span>
      </div>
    </main>
  );
}

function clampViewScale(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(2, Math.max(0.2, value));
}

function presetValue(scale: number): number | undefined {
  const preset = VIEW_SCALE_PRESETS.find((item) => Math.abs(item - scale) < 0.001);
  return preset;
}

function scaleToSliderValue(scale: number): number {
  const clampedScale = clampViewScale(scale);
  if (clampedScale <= 1) {
    return Math.round(((clampedScale - 0.2) / 0.8) * 50);
  }
  return Math.round(50 + ((clampedScale - 1) / 1) * 50);
}

function sliderValueToScale(value: number): number {
  const sliderValue = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 50));
  if (sliderValue <= 50) {
    return roundScale(0.2 + (sliderValue / 50) * 0.8);
  }
  return roundScale(1 + ((sliderValue - 50) / 50) * 1);
}

function roundScale(scale: number): number {
  return Math.round(clampViewScale(scale) * 100) / 100;
}

function formatPercent(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}
