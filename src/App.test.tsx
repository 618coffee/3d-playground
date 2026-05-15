import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import type { AgentResponse } from './domain/protocol';

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

const runtimeMock = vi.hoisted(() => ({
  runtime: {
    mount: vi.fn(),
    dispose: vi.fn(),
    addMesh: vi.fn(),
    clear: vi.fn(),
    rotateMesh: vi.fn(),
    setMeshScale: vi.fn(),
    cloneMesh: vi.fn(),
    previewClip: vi.fn(),
    clearClip: vi.fn(),
    resetView: vi.fn(),
    selectMeshes: vi.fn(),
    setMeshVisibility: vi.fn(),
    setDisplayMode: vi.fn(),
    screenDragRotation: vi.fn(),
    setViewScale: vi.fn(),
    resize: vi.fn(),
    onPick: vi.fn(() => vi.fn()),
    getViewportGuides: vi.fn(() => null),
    onViewportGuidesChange: vi.fn(() => vi.fn()),
    render: vi.fn(),
    loadFile: vi.fn(),
  },
}));

vi.mock('./viewer/vtkRuntime', () => ({
  createVtkRuntime: () => runtimeMock.runtime,
}));

const rotateDraft: AgentResponse = {
  kind: 'actionDraft',
  action: {
    id: 'agent-rotate-preview-1',
    type: 'rotateMesh',
    target: { source: 'selection' },
    params: { axis: 'z', angleDeg: 90, pivot: 'boundsCenter', space: 'world' },
    source: 'agent',
    rawText: '把当前对象绕 Z 轴旋转 90 度',
    confirmed: false,
  },
  explanation: '将当前选中的对象绕世界坐标 Z 轴旋转 90 度。',
  confidence: 0.98,
  risk: {
    level: 'low',
    summary: '可预览可撤销的变换操作。',
    warnings: [],
    requiresConfirmation: true,
    reversible: true,
  },
};

describe('App agent draft previews', () => {
  beforeEach(() => {
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
    Object.values(runtimeMock.runtime).forEach((value) => {
      if (typeof value === 'function' && 'mockClear' in value) value.mockClear();
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('previews agent rotate drafts in the viewer before confirmation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(rotateDraft), { status: 200 })));

    render(<App />);

    await waitFor(() => expect(runtimeMock.runtime.addMesh).toHaveBeenCalled());
    runtimeMock.runtime.rotateMesh.mockClear();

    fireEvent.click(screen.getByRole('button', { name: '发送指令' }));

    const confirmButtons = await screen.findAllByRole('button', { name: /确认应用/ });
    expect(confirmButtons.length).toBeGreaterThan(0);
    expect(runtimeMock.runtime.rotateMesh).toHaveBeenCalledWith('fan-stage', 'z', 90);

    fireEvent.click(confirmButtons[0]);

    await waitFor(() => expect(runtimeMock.runtime.rotateMesh).toHaveBeenCalledTimes(2));
    expect(runtimeMock.runtime.rotateMesh).toHaveBeenLastCalledWith('fan-stage', 'z', 90);
  });
});