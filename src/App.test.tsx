import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import type { AgentResponse } from './domain/protocol';

const appStyles = readFileSync(`${process.cwd()}/src/styles.css`, 'utf8');

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

    fireEvent.change(screen.getByLabelText('AI 指令输入'), { target: { value: '把当前对象绕 Z 轴旋转 90 度' } });
    fireEvent.click(screen.getByRole('button', { name: '发送指令' }));

    const confirmButtons = await screen.findAllByRole('button', { name: /确认应用/ });
    expect(confirmButtons.length).toBeGreaterThan(0);
    expect(runtimeMock.runtime.rotateMesh).toHaveBeenCalledWith('fan-stage', 'z', 90);

    fireEvent.click(confirmButtons[0]);

    await waitFor(() => expect(runtimeMock.runtime.rotateMesh).toHaveBeenCalledTimes(2));
    expect(runtimeMock.runtime.rotateMesh).toHaveBeenLastCalledWith('fan-stage', 'z', 90);
  });

  it('uses wider default sidebars', async () => {
    vi.stubGlobal('fetch', vi.fn());

    render(<App />);

    await waitFor(() => expect(runtimeMock.runtime.addMesh).toHaveBeenCalled());
    const shell = document.querySelector('.app-shell') as HTMLElement;

    expect(shell.style.getPropertyValue('--workbench-columns')).toBe('360px minmax(520px, 1fr) 360px');
    expect(shell.style.getPropertyValue('--left-panel-width')).toBe('360px');
    expect(shell.style.getPropertyValue('--right-panel-width')).toBe('360px');
  });

  it('shows selected object properties in a collapsible resizable left stack', async () => {
    vi.stubGlobal('fetch', vi.fn());

    render(<App />);

    await waitFor(() => expect(runtimeMock.runtime.addMesh).toHaveBeenCalled());
    const shell = document.querySelector('.app-shell') as HTMLElement;
    const stack = screen.getByRole('region', { name: '选中对象属性' });

    expect(shell.style.getPropertyValue('--left-properties-height')).toBe('50%');
    expect(within(stack).getByText('Blue titanium fan stage')).toBeInTheDocument();
    const resizeHandle = screen.getByRole('separator', { name: '调整属性面板高度' });

    fireEvent.mouseDown(resizeHandle, { clientY: 300 });
    fireEvent.mouseMove(window, { clientY: 240 });
    fireEvent.mouseUp(window);

    expect(shell.style.getPropertyValue('--left-properties-height')).toMatch(/px$/);
    expect(shell.style.getPropertyValue('--left-properties-height')).not.toBe('50%');

    fireEvent.click(screen.getByRole('button', { name: '折叠属性面板' }));

    expect(screen.queryByRole('region', { name: '选中对象属性' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '展开属性面板' })).toBeInTheDocument();
  });

  it('keeps hidden panel slots mounted so layout collapse can animate', async () => {
    vi.stubGlobal('fetch', vi.fn());

    render(<App />);

    await waitFor(() => expect(runtimeMock.runtime.addMesh).toHaveBeenCalled());
    const shell = document.querySelector('.app-shell') as HTMLElement;

    fireEvent.click(screen.getByRole('button', { name: '隐藏对象树' }));
    fireEvent.click(screen.getByRole('button', { name: '隐藏操作台' }));
    fireEvent.click(screen.getByRole('button', { name: '隐藏时间线' }));

    expect(document.querySelector('.left-panel-slot')).toHaveClass('is-hidden');
    expect(document.querySelector('.right-panel-slot')).toHaveClass('is-hidden');
    expect(document.querySelector('.bottom-panel-slot')).toHaveClass('is-hidden');
    expect(shell.style.getPropertyValue('--workbench-columns')).toBe('0px minmax(520px, 1fr) 0px');
    expect(shell.style.getPropertyValue('--bottom-panel-height')).toBe('0px');
  });

  it('keeps the mounted bottom panel in a zero-height grid track when collapsed', () => {
    expect(appStyles).toMatch(/\.center-panel-slot\s*\{[^}]*grid-template-rows:\s*minmax\(0, 1fr\) var\(--bottom-panel-height, 172px\);/s);
    expect(appStyles).not.toMatch(/\.center-panel-slot\.bottom-panel-hidden\s*\{[^}]*grid-template-rows:\s*minmax\(0, 1fr\);/s);
  });

  it('aligns viewport status chips with the zoom control bottom edge', () => {
    const zoomBottom = appStyles.match(/\.view-scale-control\s*\{[^}]*bottom:\s*(\d+px);/s)?.[1];
    const statusBottom = appStyles.match(/\.viewport-status\s*\{[^}]*bottom:\s*(\d+px);/s)?.[1];

    expect(zoomBottom).toBe('12px');
    expect(statusBottom).toBe(zoomBottom);
  });
});