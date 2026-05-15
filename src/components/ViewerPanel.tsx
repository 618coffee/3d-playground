import { BoxSelect, Camera, Grid3X3, Layers, Move3D, Orbit, RotateCcw, ZoomIn } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DisplayMode, OperationCommand, Vec3 } from '../domain/actions';
import type { ViewportGuidePoint, ViewportGuideSnapshot, VtkRuntime } from '../viewer/vtkRuntime';

type ViewerPanelProps = {
  runtime: VtkRuntime;
  meshCount: number;
  selectedName?: string;
  viewScale: number;
  displayMode: DisplayMode;
  pendingCommand?: OperationCommand | null;
  onDisplayModeChange: (mode: DisplayMode) => void;
  onResetView: (orientation: 'isometric' | 'front' | 'top' | 'right') => void;
  onRotateSelection: (deltaX: number, deltaY: number) => void;
  onViewScaleChange: (scale: number) => void;
  onDropFile: (file: File) => void;
};

const VIEW_SCALE_PRESETS = [0.2, 0.5, 0.8, 1, 1.2, 1.5, 2, 2.5, 3, 4];

export function ViewerPanel({ runtime, meshCount, selectedName, viewScale, displayMode, pendingCommand, onDisplayModeChange, onResetView, onRotateSelection, onViewScaleChange, onDropFile }: ViewerPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rotatePointerRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const [objectRotateEnabled, setObjectRotateEnabled] = useState(false);
  const [worldGridVisible, setWorldGridVisible] = useState(true);
  const [guideSnapshot, setGuideSnapshot] = useState<ViewportGuideSnapshot | null>(() => runtime.getViewportGuides());
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
    const refreshGuides = () => setGuideSnapshot(runtime.getViewportGuides());
    const unsubscribeGuides = runtime.onViewportGuidesChange(refreshGuides);
    const resize = () => {
      runtime.resize();
      refreshGuides();
    };
    const frame = window.requestAnimationFrame(resize);
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    refreshGuides();
    return () => {
      unsubscribeGuides();
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
        <button
          className={worldGridVisible ? 'active' : ''}
          title={worldGridVisible ? '隐藏坐标网格' : '显示坐标网格'}
          aria-label={worldGridVisible ? '隐藏坐标网格' : '显示坐标网格'}
          aria-pressed={worldGridVisible}
          onClick={() => setWorldGridVisible((visible) => !visible)}
        >
          <Grid3X3 size={16} />
        </button>
        <button title="等轴测视图" onClick={() => onResetView('isometric')}><Move3D size={16} /></button>
        <button title="正视图" onClick={() => onResetView('front')}><Camera size={16} /></button>
      </div>
      <div ref={containerRef} className="vtk-container" />
      {worldGridVisible ? <WorldGridOverlay guide={guideSnapshot} /> : null}
      <AxisTriad guide={guideSnapshot} />
      <CloneSpacingAnnotation command={pendingCommand} />
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

function WorldGridOverlay({ guide }: { guide: ViewportGuideSnapshot | null }) {
  if (!guide) return null;
  return (
    <svg className="world-grid-overlay" aria-hidden="true" viewBox={`0 0 ${guide.viewport.width} ${guide.viewport.height}`} preserveAspectRatio="none">
      {guide.gridLines.map((line) => (
        <line key={line.id} className={`world-grid-line world-grid-line-${line.axis}`} x1={line.from.x} y1={line.from.y} x2={line.to.x} y2={line.to.y} />
      ))}
      <line data-testid="world-axis-x" className="world-axis-line world-axis-x" x1={guide.origin.x} y1={guide.origin.y} x2={guide.axes.x.x} y2={guide.axes.x.y} />
      <line data-testid="world-axis-y" className="world-axis-line world-axis-y" x1={guide.origin.x} y1={guide.origin.y} x2={guide.axes.y.x} y2={guide.axes.y.y} />
      <line data-testid="world-axis-z" className="world-axis-line world-axis-z" x1={guide.origin.x} y1={guide.origin.y} x2={guide.axes.z.x} y2={guide.axes.z.y} />
      <circle className="world-origin-dot" cx={guide.origin.x} cy={guide.origin.y} r="4" />
      <text className="world-axis-label world-axis-label-x" x={guide.axes.x.x + 8} y={guide.axes.x.y + 4}>X</text>
      <text className="world-axis-label world-axis-label-y" x={guide.axes.y.x + 8} y={guide.axes.y.y + 4}>Y</text>
      <text className="world-axis-label world-axis-label-z" x={guide.axes.z.x + 8} y={guide.axes.z.y + 4}>Z</text>
    </svg>
  );
}

function AxisTriad({ guide }: { guide: ViewportGuideSnapshot | null }) {
  const triad = guide?.triad ?? FALLBACK_TRIAD_DIRECTIONS;
  const origin = { x: 32, y: 58 };
  const axisLength = 34;
  return (
    <svg className="axis-triad" aria-label="坐标轴指示器" viewBox="0 0 92 82">
      <TriadAxis axis="x" label="X" origin={origin} direction={triad.x} length={axisLength} />
      <TriadAxis axis="y" label="Y" origin={origin} direction={triad.y} length={axisLength} />
      <TriadAxis axis="z" label="Z" origin={origin} direction={triad.z} length={axisLength} />
      <circle className="axis-triad-origin" cx={origin.x} cy={origin.y} r="4.5" />
    </svg>
  );
}

function TriadAxis({ axis, label, origin, direction, length }: { axis: 'x' | 'y' | 'z'; label: string; origin: ViewportGuidePoint; direction: ViewportGuidePoint; length: number }) {
  const endpoint = { x: origin.x + direction.x * length, y: origin.y + direction.y * length };
  return (
    <g className={`axis-triad-axis axis-triad-${axis}`}>
      <line className="axis-triad-line" x1={origin.x} y1={origin.y} x2={endpoint.x} y2={endpoint.y} />
      <circle className="axis-triad-arrow" cx={endpoint.x} cy={endpoint.y} r="3.2" />
      <text className="axis-triad-label" x={endpoint.x + direction.x * 10} y={endpoint.y + direction.y * 10 + 3}>{label}</text>
    </g>
  );
}

const FALLBACK_TRIAD_DIRECTIONS: Record<'x' | 'y' | 'z', ViewportGuidePoint> = {
  x: { x: 0.98, y: -0.15 },
  y: { x: -0.72, y: -0.68 },
  z: { x: 0.2, y: -0.98 },
};

function CloneSpacingAnnotation({ command }: { command?: OperationCommand | null }) {
  if (command?.type !== 'cloneMesh') return null;
  return (
    <div className="clone-spacing-annotation" aria-label="复制间距预览">
      <div className="spacing-arrow" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div>
        <strong>{cloneSpacingLabel(command.params.offset, command.params.unit)}</strong>
        <span>{command.params.count} 个复制体</span>
      </div>
    </div>
  );
}

function cloneSpacingLabel(offset: Vec3, unit: OperationCommand extends infer Command ? Command extends { type: 'cloneMesh'; params: { unit: infer Unit } } ? Unit : never : never): string {
  const axis = dominantAxis(offset);
  const spacing = Math.hypot(offset[0], offset[1], offset[2]);
  return `${axis} 间距 ${formatDistance(spacing)} ${unit}`;
}

function dominantAxis(vector: Vec3): 'X' | 'Y' | 'Z' | '方向' {
  const [x, y, z] = vector.map((value) => Math.abs(value));
  if (x === 0 && y === 0 && z === 0) return '方向';
  if (x >= y && x >= z) return 'X';
  if (y >= x && y >= z) return 'Y';
  return 'Z';
}

function formatDistance(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/\.00$/, '').replace(/0$/, '');
}

function clampViewScale(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(4, Math.max(0.2, value));
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
  return Math.round(50 + ((clampedScale - 1) / 3) * 50);
}

function sliderValueToScale(value: number): number {
  const sliderValue = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 50));
  if (sliderValue <= 50) {
    return roundScale(0.2 + (sliderValue / 50) * 0.8);
  }
  return roundScale(1 + ((sliderValue - 50) / 50) * 3);
}

function roundScale(scale: number): number {
  return Math.round(clampViewScale(scale) * 100) / 100;
}

function formatPercent(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}
