import { type CSSProperties, type MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TopBar } from './components/TopBar';
import { ObjectTree } from './components/ObjectTree';
import { ViewerPanel } from './components/ViewerPanel';
import { InspectorPanel, PropertiesPanel } from './components/InspectorPanel';
import { HistoryTimeline } from './components/HistoryTimeline';
import type { ActionResult, DisplayMode, OperationCommand } from './domain/actions';
import { createOperationExecutor } from './domain/executor';
import { createHistoryStore, type HistoryStore } from './domain/history';
import { cloneMeshEntity, createInitialScene, type SceneState } from './domain/scene';
import { SAMPLE_WORKSPACES, createSampleWorkspace, type SampleWorkspaceId } from './viewer/sampleEngine';
import { createVtkRuntime } from './viewer/vtkRuntime';

const emptyScene = createInitialScene();
type PanelKey = 'left' | 'right' | 'bottom';
type PanelVisibility = Record<PanelKey, boolean>;
type PanelSizes = { left: number; right: number; bottom: number };
type ViewOrientation = 'isometric' | 'front' | 'top' | 'right';

const PANEL_LIMITS = {
  left: { min: 220, max: 420 },
  right: { min: 300, max: 520 },
  bottom: { min: 96, max: 260 },
  viewer: { minWidth: 520, minHeight: 320 },
};

export default function App() {
  const runtime = useMemo(() => createVtkRuntime(), []);
  const [scene, setScene] = useState<SceneState>(emptyScene);
  const [lastMessage, setLastMessage] = useState('加载示例涡扇模型即可开始演示。');
  const [pendingCommand, setPendingCommand] = useState<OperationCommand | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [workspaceId, setWorkspaceId] = useState<SampleWorkspaceId>('turbofan');
  const [panelVisibility, setPanelVisibility] = useState<PanelVisibility>({ left: true, right: true, bottom: true });
  const [panelSizes, setPanelSizes] = useState<PanelSizes>({ left: 360, right: 360, bottom: 156 });
  const [leftPropertiesOpen, setLeftPropertiesOpen] = useState(true);
  const [leftPropertiesHeight, setLeftPropertiesHeight] = useState<number | null>(null);
  const [viewOrientation, setViewOrientation] = useState<ViewOrientation>('isometric');
  const [viewScale, setViewScaleState] = useState(1);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const leftPropertiesRef = useRef<HTMLElement | null>(null);
  const historyRef = useRef<HistoryStore>(createHistoryStore(emptyScene));
  const datasetsRef = useRef(new Map<string, unknown>());

  const selectedMeshes = scene.meshes.filter((mesh) => scene.selection.includes(mesh.id));
  const selectedMesh = selectedMeshes[0];
  const selectedLabel = scene.selection.length > 1 ? `${scene.selection.length} selected` : selectedMesh?.name;
  const visibleMeshCount = scene.meshes.filter((mesh) => mesh.visible).length;
  const historyEntries = historyRef.current.entries();

  const refreshFromHistory = useCallback((message?: string) => {
    setScene(historyRef.current.current());
    setHistoryVersion((version) => version + 1);
    if (message) setLastMessage(message);
  }, []);

  const loadWorkspace = useCallback((nextWorkspaceId: SampleWorkspaceId) => {
    const workspace = SAMPLE_WORKSPACES.find((item) => item.id === nextWorkspaceId) ?? SAMPLE_WORKSPACES[0];
    const meshes = createSampleWorkspace(workspace.id);
    const nextScene = createInitialScene(meshes);
    runtime.clear();
    datasetsRef.current.clear();
    meshes.forEach((mesh) => runtime.addMesh(mesh));
    runtime.selectMeshes(nextScene.selection);
    historyRef.current = createHistoryStore(nextScene);
    setPendingCommand(null);
    setWorkspaceId(workspace.id);
    setViewOrientation('isometric');
    setViewScaleState(1);
    runtime.setViewScale(1);
    setScene(nextScene);
    setHistoryVersion((version) => version + 1);
    setLastMessage(`已加载${workspace.label}工作区。`);
  }, [runtime]);

  useEffect(() => {
    loadWorkspace('turbofan');
  }, [loadWorkspace]);

  const execute = useCallback((command: OperationCommand): ActionResult => {
    if (pendingCommand?.source === 'agent' && pendingCommand.id === command.id && isRuntimePreviewCommand(pendingCommand)) {
      restoreRuntimeScene(runtime, historyRef.current.current(), datasetsRef.current);
    }
    const executor = createOperationExecutor(historyRef.current, runtime);
    const before = historyRef.current.current();
    const result = executor.execute(command);
    if (command.type === 'resetView' && result.status !== 'failed') {
      setViewOrientation(command.params.orientation);
    }
    const after = historyRef.current.current();
    if (result.requiresConfirmation) {
      setPendingCommand(command);
    } else if (result.status === 'applied' || result.status === 'failed' || result.status === 'rejected') {
      setPendingCommand(null);
    }
    if (command.type === 'cloneMesh') {
      copyDatasetRefsForClones(before, after, datasetsRef.current);
    }
    refreshFromHistory(result.message);
    return result;
  }, [pendingCommand, refreshFromHistory, runtime]);

  const confirmPending = useCallback(() => {
    if (!pendingCommand) return;
    execute({ ...pendingCommand, confirmed: true });
  }, [execute, pendingCommand]);

  const cancelPending = useCallback(() => {
    if (pendingCommand && isRuntimePreviewCommand(pendingCommand)) {
      restoreRuntimeScene(runtime, historyRef.current.current(), datasetsRef.current);
    }
    setPendingCommand(null);
    setLastMessage('已取消待确认操作。');
  }, [pendingCommand, runtime]);

  const previewDraft = useCallback((command: OperationCommand) => {
    if (pendingCommand?.source === 'agent' && isRuntimePreviewCommand(pendingCommand)) {
      restoreRuntimeScene(runtime, historyRef.current.current(), datasetsRef.current);
    }
    if (command.type === 'clipMesh') {
      execute(command);
      return;
    }
    const sceneSnapshot = historyRef.current.current();
    const targetIds = pendingCommandTargetIds(command, sceneSnapshot);
    if (targetIds.length === 0) return;
    if (command.type === 'cloneMesh') {
      previewCloneDraft(runtime, sceneSnapshot, targetIds, command);
      setPendingCommand(command);
      setLastMessage('已生成复制预览，确认后写入历史。');
      return;
    }
    if (command.type === 'rotateMesh' || command.type === 'setMeshScale') {
      previewTransformDraft(runtime, targetIds, command);
      setPendingCommand(command);
      setLastMessage(command.type === 'rotateMesh' ? '已生成旋转预览，确认后应用。' : '已生成缩放预览，确认后应用。');
      return;
    }
    setPendingCommand(command);
  }, [execute, pendingCommand, runtime]);

  const importFile = useCallback(async (file: File) => {
    try {
      const loaded = await runtime.loadFile(file);
      runtime.addMesh(loaded.mesh, loaded.dataset);
      datasetsRef.current.set(loaded.mesh.id, loaded.dataset);
      execute({
        id: `import-${Date.now()}`,
        type: 'importMesh',
        target: { scope: 'scene' },
        params: { mesh: loaded.mesh },
        source: 'ui',
        rawText: file.name,
      });
    } catch (error) {
      setLastMessage(error instanceof Error ? error.message : '导入失败');
    }
  }, [execute, runtime]);

  const selectMeshes = useCallback((meshIds: string[], mode: 'replace' | 'add' | 'remove' = 'replace') => {
    execute({
      id: `select-${Date.now()}`,
      type: 'selectMesh',
      target: meshIds.length === 1 ? { meshId: meshIds[0] } : { meshIds },
      params: { mode },
      source: 'ui',
    });
  }, [execute]);

  const selectMesh = useCallback((meshId: string) => {
    selectMeshes([meshId], 'replace');
  }, [selectMeshes]);

  const togglePanel = useCallback((panel: PanelKey) => {
    setPanelVisibility((current) => ({ ...current, [panel]: !current[panel] }));
  }, []);

  const startPanelResize = useCallback((panel: PanelKey, event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startSizes = panelSizes;
    const handleMove = (moveEvent: MouseEvent) => {
      const delta = panel === 'bottom' ? startY - moveEvent.clientY : moveEvent.clientX - startX;
      const directionalDelta = panel === 'right' ? -delta : delta;
      const nextSize = startSizes[panel] + directionalDelta;
      setPanelSizes((current) => clampPanelSizes({ ...current, [panel]: nextSize }, panelVisibility, shellRef.current));
    };
    const handleUp = () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      document.body.classList.remove('is-resizing-panel');
    };
    document.body.classList.add('is-resizing-panel');
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp, { once: true });
  }, [panelSizes, panelVisibility]);

  const startLeftPropertiesResize = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const fallbackHeight = defaultLeftPropertiesHeight(shellRef.current);
    const startHeight = leftPropertiesRef.current?.getBoundingClientRect().height || leftPropertiesHeight || fallbackHeight;
    const handleMove = (moveEvent: MouseEvent) => {
      const delta = startY - moveEvent.clientY;
      setLeftPropertiesHeight(clampLeftPropertiesHeight(startHeight + delta, shellRef.current));
    };
    const handleUp = () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      document.body.classList.remove('is-resizing-panel');
    };
    document.body.classList.add('is-resizing-panel');
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp, { once: true });
  }, [leftPropertiesHeight]);

  const resetView = useCallback(() => {
    execute({
      id: `reset-${Date.now()}`,
      type: 'resetView',
      target: { scope: 'viewer' },
      params: { fit: 'visible', orientation: 'isometric' },
      source: 'ui',
    });
  }, [execute]);

  const setDisplayMode = useCallback((mode: DisplayMode) => {
    execute({
      id: `display-${Date.now()}`,
      type: 'setDisplayMode',
      target: { scope: 'viewer' },
      params: { mode },
      source: 'ui',
    });
  }, [execute]);

  const rotateSelectionFromDrag = useCallback((deltaX: number, deltaY: number) => {
    const rotation = runtime.screenDragRotation(deltaX, deltaY);
    if (!rotation) return;
    execute({
      id: `drag-rotate-${Date.now()}`,
      type: 'rotateMesh',
      target: { source: 'selection' },
      params: { axis: rotation.axis, angleDeg: rotation.angleDeg, pivot: 'boundsCenter', space: 'world' },
      source: 'ui',
      rawText: 'viewport drag rotate',
    });
  }, [execute, runtime]);

  const setViewScale = useCallback((scale: number) => {
    const nextScale = clampScale(scale, 0.2, 4);
    setViewScaleState(nextScale);
    runtime.setViewScale(nextScale);
  }, [runtime]);

  const toggleVisibility = useCallback((meshId: string, visible: boolean) => {
    execute({ id: `visible-${Date.now()}`, type: 'setMeshVisibility', target: { meshId }, params: { visible }, source: 'ui' });
  }, [execute]);

  const toggleLock = useCallback((meshId: string, locked: boolean) => {
    execute({ id: `lock-${Date.now()}`, type: 'setMeshLocked', target: { meshId }, params: { locked }, source: 'ui' });
  }, [execute]);

  const undo = useCallback(() => {
    const result = historyRef.current.undo();
    restoreRuntimeScene(runtime, historyRef.current.current(), datasetsRef.current);
    setPendingCommand(null);
    refreshFromHistory(result.message);
  }, [refreshFromHistory, runtime]);

  const redo = useCallback(() => {
    const result = historyRef.current.redo();
    restoreRuntimeScene(runtime, historyRef.current.current(), datasetsRef.current);
    setPendingCommand(null);
    refreshFromHistory(result.message);
  }, [refreshFromHistory, runtime]);

  useEffect(() => runtime.onPick(selectMesh), [runtime, selectMesh]);

  void historyVersion;

  return (
    <div
      ref={shellRef}
      className={`app-shell ${panelVisibility.bottom ? '' : 'bottom-panel-hidden'}`}
      style={layoutStyle(panelSizes, panelVisibility, leftPropertiesHeight)}
    >
      <TopBar
        canUndo={historyRef.current.canUndo()}
        canRedo={historyRef.current.canRedo()}
        workspaces={SAMPLE_WORKSPACES}
        activeWorkspace={workspaceId}
        panelVisibility={panelVisibility}
        onSelectWorkspace={loadWorkspace}
        onReloadWorkspace={() => loadWorkspace(workspaceId)}
        onTogglePanel={togglePanel}
        onImportFile={importFile}
        onUndo={undo}
        onRedo={redo}
        onResetView={resetView}
      />
      <div className={`workbench-grid ${panelVisibility.left ? '' : 'left-panel-hidden'} ${panelVisibility.right ? '' : 'right-panel-hidden'}`}>
        {panelVisibility.left ? (
          <div className={`panel-slot left-panel-slot left-panel-stack ${leftPropertiesOpen ? 'properties-open' : 'properties-collapsed'}`}>
            <div className="left-object-tree-pane">
              <ObjectTree
                meshes={scene.meshes}
                selection={scene.selection}
                onSelect={selectMeshes}
                onToggleVisibility={toggleVisibility}
                onToggleLock={toggleLock}
                onHidePanel={() => togglePanel('left')}
              />
            </div>
            <section ref={leftPropertiesRef} className="left-properties-pane" aria-label="属性面板">
              {leftPropertiesOpen ? <div className="panel-resize-handle resize-handle-top left-properties-resize" role="separator" aria-label="调整属性面板高度" aria-orientation="horizontal" title="调整属性面板高度" onMouseDown={startLeftPropertiesResize} /> : null}
              <div className="left-properties-header">
                <strong>属性</strong>
                <button type="button" className="text-button" aria-expanded={leftPropertiesOpen} aria-label={leftPropertiesOpen ? '折叠属性面板' : '展开属性面板'} onClick={() => setLeftPropertiesOpen((open) => !open)}>
                  {leftPropertiesOpen ? '折叠' : '展开'}
                </button>
              </div>
              {leftPropertiesOpen ? (
                <div className="left-properties-content" role="region" aria-label="选中对象属性">
                  <PropertiesPanel mesh={selectedMesh} selectedMeshes={selectedMeshes} />
                </div>
              ) : null}
            </section>
            <div className="panel-resize-handle resize-handle-right" role="separator" aria-orientation="vertical" title="调整对象树宽度" onMouseDown={(event) => startPanelResize('left', event)} />
          </div>
        ) : null}
        <div className={`center-panel-slot ${panelVisibility.bottom ? '' : 'bottom-panel-hidden'}`}>
          <div className="viewer-slot">
            <ViewerPanel
              runtime={runtime}
              meshCount={scene.meshes.length}
              visibleCount={visibleMeshCount}
              selectedCount={scene.selection.length}
              selectedName={selectedLabel}
              currentOrientation={viewOrientation}
              viewScale={viewScale}
              displayMode={scene.displayMode}
              pendingCommand={pendingCommand}
              onDisplayModeChange={setDisplayMode}
              onDropFile={importFile}
              onRotateSelection={rotateSelectionFromDrag}
              onViewScaleChange={setViewScale}
              onResetView={(orientation) => execute({
                id: `reset-${Date.now()}`,
                type: 'resetView',
                target: { scope: 'viewer' },
                params: { fit: 'visible', orientation },
                source: 'ui',
              })}
            />
            <PanelRestoreControls visibility={panelVisibility} onTogglePanel={togglePanel} />
          </div>
          {panelVisibility.bottom ? (
            <div className="bottom-panel-slot">
              <div className="panel-resize-handle resize-handle-top" role="separator" aria-orientation="horizontal" title="调整时间线高度" onMouseDown={(event) => startPanelResize('bottom', event)} />
              <HistoryTimeline entries={historyEntries} lastMessage={lastMessage} onHidePanel={() => togglePanel('bottom')} />
            </div>
          ) : null}
        </div>
        {panelVisibility.right ? (
          <div className="panel-slot right-panel-slot">
            <div className="panel-resize-handle resize-handle-left" role="separator" aria-orientation="vertical" title="调整检查器宽度" onMouseDown={(event) => startPanelResize('right', event)} />
            <InspectorPanel
              scene={scene}
              selectedMesh={selectedMesh}
              selectedMeshes={selectedMeshes}
              historyEntries={historyEntries}
              pendingCommand={pendingCommand}
              onConfirmPending={confirmPending}
              onCancelPending={cancelPending}
              onExecute={execute}
              onPreviewDraft={previewDraft}
              onHidePanel={() => togglePanel('right')}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PanelRestoreControls({ visibility, onTogglePanel }: { visibility: PanelVisibility; onTogglePanel: (panel: PanelKey) => void }) {
  if (visibility.left && visibility.right && visibility.bottom) return null;
  return (
    <div className="panel-restore-layer" aria-label="面板恢复控制">
      {!visibility.left ? <button className="restore-panel-button restore-left" onClick={() => onTogglePanel('left')}>对象树</button> : null}
      {!visibility.right ? <button className="restore-panel-button restore-right" onClick={() => onTogglePanel('right')}>检查器</button> : null}
      {!visibility.bottom ? <button className="restore-panel-button restore-bottom" onClick={() => onTogglePanel('bottom')}>时间线</button> : null}
    </div>
  );
}

function layoutStyle(sizes: PanelSizes, visibility: PanelVisibility, leftPropertiesHeight: number | null): CSSProperties {
  const columns = [visibility.left ? `${sizes.left}px` : null, 'minmax(520px, 1fr)', visibility.right ? `${sizes.right}px` : null]
    .filter(Boolean)
    .join(' ');
  return {
    '--left-panel-width': `${sizes.left}px`,
    '--right-panel-width': `${sizes.right}px`,
    '--bottom-panel-height': `${sizes.bottom}px`,
    '--left-properties-height': leftPropertiesHeight === null ? '50%' : `${leftPropertiesHeight}px`,
    '--workbench-columns': columns,
  } as CSSProperties;
}

function defaultLeftPropertiesHeight(shell: HTMLDivElement | null): number {
  return Math.round(workbenchHeight(shell) / 2);
}

function clampLeftPropertiesHeight(value: number, shell: HTMLDivElement | null): number {
  const max = Math.max(140, workbenchHeight(shell) - 140);
  return clamp(value, 120, max);
}

function workbenchHeight(shell: HTMLDivElement | null): number {
  return Math.max(280, (shell?.clientHeight || window.innerHeight) - 52);
}

function clampPanelSizes(next: PanelSizes, visibility: PanelVisibility, shell: HTMLDivElement | null): PanelSizes {
  const shellWidth = shell?.clientWidth ?? window.innerWidth;
  const shellHeight = shell?.clientHeight ?? window.innerHeight;
  const horizontalGutter = 0;
  const bottomMaxByViewer = Math.max(PANEL_LIMITS.bottom.min, shellHeight - 52 - PANEL_LIMITS.viewer.minHeight);
  const leftMaxByViewer = visibility.right ? shellWidth - PANEL_LIMITS.viewer.minWidth - next.right - horizontalGutter : shellWidth - PANEL_LIMITS.viewer.minWidth;
  const rightMaxByViewer = visibility.left ? shellWidth - PANEL_LIMITS.viewer.minWidth - next.left - horizontalGutter : shellWidth - PANEL_LIMITS.viewer.minWidth;
  const leftMax = Math.max(PANEL_LIMITS.left.min, Math.min(PANEL_LIMITS.left.max, leftMaxByViewer));
  const rightMax = Math.max(PANEL_LIMITS.right.min, Math.min(PANEL_LIMITS.right.max, rightMaxByViewer));
  return {
    left: clamp(next.left, PANEL_LIMITS.left.min, leftMax),
    right: clamp(next.right, PANEL_LIMITS.right.min, rightMax),
    bottom: clamp(next.bottom, PANEL_LIMITS.bottom.min, Math.min(PANEL_LIMITS.bottom.max, bottomMaxByViewer)),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function clampScale(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(max, Math.max(min, value));
}

function restoreRuntimeScene(runtime: ReturnType<typeof createVtkRuntime>, scene: SceneState, datasets: Map<string, unknown>): void {
  runtime.clear();
  scene.meshes.forEach((mesh) => runtime.addMesh(mesh, datasets.get(mesh.id)));
  runtime.selectMeshes(scene.selection);
}

function previewCloneDraft(runtime: ReturnType<typeof createVtkRuntime>, scene: SceneState, targetIds: string[], command: Extract<OperationCommand, { type: 'cloneMesh' }>): void {
  const cloneCount = Math.min(12, Math.max(1, Math.trunc(command.params.count)));
  scene.meshes.forEach((mesh) => {
    if (!targetIds.includes(mesh.id)) return;
    for (let index = 1; index <= cloneCount; index += 1) {
      const clone = cloneMeshEntity(mesh, {
        id: `${mesh.id}-${command.id}-preview-${index}`,
        name: command.params.namePattern.replace('{name}', mesh.name).replace('{n}', String(index)),
        offset: multiplyVec3(command.params.offset, index),
      });
      runtime.cloneMesh(mesh.id, { ...clone, opacity: Math.min(clone.opacity, 0.45), selected: false });
    }
  });
}

function previewTransformDraft(runtime: ReturnType<typeof createVtkRuntime>, targetIds: string[], command: Extract<OperationCommand, { type: 'rotateMesh' | 'setMeshScale' }>): void {
  targetIds.forEach((meshId) => {
    if (command.type === 'rotateMesh') runtime.rotateMesh(meshId, command.params.axis, command.params.angleDeg);
    else runtime.setMeshScale(meshId, command.params.scale);
  });
}

function isRuntimePreviewCommand(command: OperationCommand): boolean {
  return command.type === 'cloneMesh' || command.type === 'clipMesh' || command.type === 'rotateMesh' || command.type === 'setMeshScale';
}

function multiplyVec3(vector: [number, number, number], factor: number): [number, number, number] {
  return [vector[0] * factor, vector[1] * factor, vector[2] * factor];
}

function copyDatasetRefsForClones(before: SceneState, after: SceneState, datasets: Map<string, unknown>): void {
  const beforeIds = new Set(before.meshes.map((mesh) => mesh.id));
  const importedSources = before.meshes.filter((mesh) => datasets.has(mesh.id));
  after.meshes.forEach((mesh) => {
    if (beforeIds.has(mesh.id) || datasets.has(mesh.id)) return;
    const source = importedSources.find((candidate) => mesh.id.startsWith(`${candidate.id}-`));
    if (source) datasets.set(mesh.id, datasets.get(source.id));
  });
}

function pendingCommandTargetIds(command: OperationCommand, scene: SceneState): string[] {
  if (!('target' in command) || 'scope' in command.target) return [];
  if ('meshId' in command.target) return [command.target.meshId];
  if ('meshIds' in command.target) return command.target.meshIds;
  if ('source' in command.target && command.target.source === 'selection') return scene.selection;
  if ('source' in command.target && command.target.source === 'allVisible') return scene.meshes.filter((mesh) => mesh.visible).map((mesh) => mesh.id);
  if ('name' in command.target) {
    const target = command.target;
    const query = command.target.name.toLowerCase();
    return scene.meshes
      .filter((mesh) => (target.match === 'exact' ? mesh.name.toLowerCase() === query : mesh.name.toLowerCase().includes(query)))
      .map((mesh) => mesh.id);
  }
  return [];
}
