import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ViewerPanel } from './ViewerPanel';
import type { VtkRuntime } from '../viewer/vtkRuntime';

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

function createRuntimeStub(): VtkRuntime {
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
    render: vi.fn(),
    loadFile: vi.fn(),
  } as unknown as VtkRuntime;
}

describe('ViewerPanel', () => {
  it('offers high view scale ratios up to 400 percent', () => {
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
    const onViewScaleChange = vi.fn();

    render(
      <ViewerPanel
        runtime={createRuntimeStub()}
        meshCount={1}
        selectedName="Fan"
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