import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ViewerPanel } from './ViewerPanel';
import type { OperationCommand } from '../domain/actions';
import type { VtkRuntime } from '../viewer/vtkRuntime';

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

type GuideSnapshot = {
  viewport: { width: number; height: number };
  origin: { x: number; y: number };
  axes: {
    x: { x: number; y: number };
    y: { x: number; y: number };
    z: { x: number; y: number };
  };
  triad: {
    x: { x: number; y: number };
    y: { x: number; y: number };
    z: { x: number; y: number };
  };
  gridLines: Array<{ id: string; axis: 'x' | 'y'; from: { x: number; y: number }; to: { x: number; y: number } }>;
};

type RuntimeStub = VtkRuntime & {
  emitViewportGuideChange: (snapshot: GuideSnapshot) => void;
};

const initialGuideSnapshot: GuideSnapshot = {
  viewport: { width: 640, height: 420 },
  origin: { x: 300, y: 230 },
  axes: {
    x: { x: 380, y: 226 },
    y: { x: 270, y: 174 },
    z: { x: 306, y: 146 },
  },
  triad: {
    x: { x: 0.98, y: -0.05 },
    y: { x: -0.47, y: -0.88 },
    z: { x: 0.07, y: -1 },
  },
  gridLines: [
    { id: 'x--1', axis: 'x', from: { x: 224, y: 272 }, to: { x: 406, y: 262 } },
    { id: 'y--1', axis: 'y', from: { x: 254, y: 300 }, to: { x: 206, y: 162 } },
  ],
};

function createRuntimeStub(snapshot: GuideSnapshot = initialGuideSnapshot): RuntimeStub {
  let guideSnapshot = snapshot;
  const callbacks = new Set<() => void>();
  return {
    mount: vi.fn(),
    dispose: vi.fn(),
    addMesh: vi.fn(),
    clear: vi.fn(),
    rotateMesh: vi.fn(),
    setMeshScale: vi.fn(),
    setMeshVisibility: vi.fn(),
    setMeshLocked: vi.fn(),
    setDisplayMode: vi.fn(),
    cloneMesh: vi.fn(),
    previewClip: vi.fn(),
    applyClip: vi.fn(),
    clearClip: vi.fn(),
    resetView: vi.fn(),
    selectMeshes: vi.fn(),
    screenDragRotation: vi.fn(),
    setViewScale: vi.fn(),
    resize: vi.fn(),
    onPick: vi.fn(() => vi.fn()),
    getViewportGuides: vi.fn(() => guideSnapshot),
    onViewportGuidesChange: vi.fn((callback: () => void) => {
      callbacks.add(callback);
      return () => callbacks.delete(callback);
    }),
    emitViewportGuideChange: (nextSnapshot: GuideSnapshot) => {
      guideSnapshot = nextSnapshot;
      callbacks.forEach((callback) => callback());
    },
    render: vi.fn(),
    loadFile: vi.fn(),
  } as unknown as RuntimeStub;
}

describe('ViewerPanel', () => {
  it('shows coordinate axes and lets users toggle the world grid', () => {
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

    render(
      <ViewerPanel
        runtime={createRuntimeStub()}
        meshCount={1}
        visibleCount={1}
        selectedCount={1}
        selectedName="Fan"
        currentOrientation="isometric"
        viewScale={1}
        displayMode="surface"
        onDisplayModeChange={vi.fn()}
        onResetView={vi.fn()}
        onRotateSelection={vi.fn()}
        onViewScaleChange={vi.fn()}
        onDropFile={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('坐标轴指示器')).toHaveTextContent('X');
    expect(screen.getByLabelText('坐标轴指示器')).toHaveTextContent('Y');
    expect(screen.getByLabelText('坐标轴指示器')).toHaveTextContent('Z');
    expect(document.querySelector('.world-grid-overlay')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '隐藏坐标网格' }));

    expect(document.querySelector('.world-grid-overlay')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '显示坐标网格' })).toBeInTheDocument();
  });

  it('updates projected guide geometry when the runtime camera changes', () => {
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
    const runtime = createRuntimeStub();

    render(
      <ViewerPanel
        runtime={runtime}
        meshCount={1}
        visibleCount={1}
        selectedCount={1}
        selectedName="Fan"
        currentOrientation="isometric"
        viewScale={1}
        displayMode="surface"
        onDisplayModeChange={vi.fn()}
        onResetView={vi.fn()}
        onRotateSelection={vi.fn()}
        onViewScaleChange={vi.fn()}
        onDropFile={vi.fn()}
      />,
    );

    expect(screen.getByTestId('world-axis-x')).toHaveAttribute('x2', '380');

    act(() => {
      runtime.emitViewportGuideChange({
        ...initialGuideSnapshot,
        origin: { x: 248, y: 256 },
        axes: {
          x: { x: 318, y: 294 },
          y: { x: 210, y: 196 },
          z: { x: 254, y: 154 },
        },
      });
    });

    expect(screen.getByTestId('world-axis-x')).toHaveAttribute('x1', '248');
    expect(screen.getByTestId('world-axis-x')).toHaveAttribute('x2', '318');
    expect(screen.getByTestId('world-axis-y')).toHaveAttribute('y2', '196');
  });

  it('lets users switch orientation from the viewport orientation control', () => {
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
    const onResetView = vi.fn();

    render(
      <ViewerPanel
        runtime={createRuntimeStub()}
        meshCount={1}
        visibleCount={1}
        selectedCount={1}
        selectedName="Fan"
        currentOrientation="right"
        viewScale={1}
        displayMode="surface"
        onDisplayModeChange={vi.fn()}
        onResetView={onResetView}
        onRotateSelection={vi.fn()}
        onViewScaleChange={vi.fn()}
        onDropFile={vi.fn()}
      />,
    );

    fireEvent.mouseEnter(screen.getByRole('group', { name: '视角导航' }));

    fireEvent.click(screen.getByRole('button', { name: '当前视角：侧视图' }));
    fireEvent.click(screen.getByRole('button', { name: '切换到等轴测' }));
    fireEvent.click(screen.getByRole('button', { name: '切换到正视图' }));
    fireEvent.click(screen.getByRole('button', { name: '切换到俯视图' }));

    expect(onResetView).toHaveBeenNthCalledWith(1, 'right');
    expect(onResetView).toHaveBeenNthCalledWith(2, 'isometric');
    expect(onResetView).toHaveBeenNthCalledWith(3, 'front');
    expect(onResetView).toHaveBeenNthCalledWith(4, 'top');
  });

  it('keeps orientation switching only in the collapsible viewport control', () => {
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

    render(
      <ViewerPanel
        runtime={createRuntimeStub()}
        meshCount={1}
        visibleCount={1}
        selectedCount={1}
        selectedName="Fan"
        currentOrientation="right"
        viewScale={1}
        displayMode="surface"
        onDisplayModeChange={vi.fn()}
        onResetView={vi.fn()}
        onRotateSelection={vi.fn()}
        onViewScaleChange={vi.fn()}
        onDropFile={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: '等轴测视图' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '正视图' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '当前视角：侧视图' })).toHaveTextContent('侧视图');

    const control = screen.getByRole('group', { name: '视角导航' });
    expect(control).toHaveAttribute('data-expanded', 'false');

    fireEvent.mouseEnter(control);

    expect(control).toHaveAttribute('data-expanded', 'true');
    expect(screen.getByRole('button', { name: '切换到等轴测' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '切换到正视图' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '切换到俯视图' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '切换到侧视图' })).not.toBeInTheDocument();

    fireEvent.mouseLeave(control);

    expect(control).toHaveAttribute('data-expanded', 'false');
  });

  it('shows scene status chips in the viewport instead of relying on the top bar', () => {
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

    render(
      <ViewerPanel
        runtime={createRuntimeStub()}
        meshCount={6}
        visibleCount={5}
        selectedCount={2}
        selectedName="Fan"
        currentOrientation="isometric"
        viewScale={1}
        displayMode="surface"
        onDisplayModeChange={vi.fn()}
        onResetView={vi.fn()}
        onRotateSelection={vi.fn()}
        onViewScaleChange={vi.fn()}
        onDropFile={vi.fn()}
      />,
    );

    expect(screen.getByText('6 对象')).toBeInTheDocument();
    expect(screen.getByText('5 可见')).toBeInTheDocument();
    expect(screen.getByText('2 选中')).toBeInTheDocument();
    expect(screen.getByText('surface')).toBeInTheDocument();
    expect(screen.getByText('单位 mm')).toBeInTheDocument();
    expect(screen.queryByText('Fan')).not.toBeInTheDocument();
  });

  it('annotates clone draft spacing in the viewport', () => {
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
    const pendingCommand: OperationCommand = {
      id: 'clone-preview-1',
      type: 'cloneMesh',
      target: { source: 'selection' },
      params: { count: 3, offset: [20, 0, 0], unit: 'mm', shareGeometry: true, namePattern: '{name}-copy-{n}' },
      source: 'agent',
      confirmed: false,
    };

    render(
      <ViewerPanel
        runtime={createRuntimeStub()}
        meshCount={1}
        visibleCount={1}
        selectedCount={1}
        selectedName="Fan"
        currentOrientation="isometric"
        viewScale={1}
        displayMode="surface"
        pendingCommand={pendingCommand}
        onDisplayModeChange={vi.fn()}
        onResetView={vi.fn()}
        onRotateSelection={vi.fn()}
        onViewScaleChange={vi.fn()}
        onDropFile={vi.fn()}
      />,
    );

    expect(screen.getByText('X 间距 20 mm')).toBeInTheDocument();
    expect(screen.getByText('3 个复制体')).toBeInTheDocument();
  });

  it('offers high view scale ratios up to 400 percent', () => {
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
    const onViewScaleChange = vi.fn();

    render(
      <ViewerPanel
        runtime={createRuntimeStub()}
        meshCount={1}
        visibleCount={1}
        selectedCount={1}
        selectedName="Fan"
        currentOrientation="isometric"
        viewScale={1}
        displayMode="surface"
        onDisplayModeChange={vi.fn()}
        onResetView={vi.fn()}
        onRotateSelection={vi.fn()}
        onViewScaleChange={onViewScaleChange}
        onDropFile={vi.fn()}
      />,
    );

    const select = screen.getByLabelText('视图比例') as HTMLSelectElement;
    const optionLabels = Array.from(select.options).map((option) => option.textContent);

    expect(optionLabels).toEqual(expect.arrayContaining(['250%', '300%', '400%']));

    fireEvent.change(select, { target: { value: '4' } });

    expect(onViewScaleChange).toHaveBeenCalledWith(4);
  });
});