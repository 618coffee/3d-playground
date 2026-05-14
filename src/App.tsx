import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TopBar } from './components/TopBar';
import { ObjectTree } from './components/ObjectTree';
import { ViewerPanel } from './components/ViewerPanel';
import { InspectorPanel } from './components/InspectorPanel';
import { HistoryTimeline } from './components/HistoryTimeline';
import type { DisplayMode, OperationCommand } from './domain/actions';
import { createOperationExecutor } from './domain/executor';
import { createHistoryStore, type HistoryStore } from './domain/history';
import { createInitialScene, type SceneState } from './domain/scene';
import { createTurbofanSample } from './viewer/sampleEngine';
import { createVtkRuntime } from './viewer/vtkRuntime';

const emptyScene = createInitialScene();

export default function App() {
  const runtime = useMemo(() => createVtkRuntime(), []);
  const [scene, setScene] = useState<SceneState>(emptyScene);
  const [lastMessage, setLastMessage] = useState('加载示例涡扇模型即可开始演示。');
  const [pendingCommand, setPendingCommand] = useState<OperationCommand | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const historyRef = useRef<HistoryStore>(createHistoryStore(emptyScene));
  const datasetsRef = useRef(new Map<string, unknown>());

  const selectedMesh = scene.meshes.find((mesh) => scene.selection.includes(mesh.id));
  const historyEntries = historyRef.current.entries();

  const refreshFromHistory = useCallback((message?: string) => {
    setScene(historyRef.current.current());
    setHistoryVersion((version) => version + 1);
    if (message) setLastMessage(message);
  }, []);

  const loadSample = useCallback(() => {
    const meshes = createTurbofanSample();
    const nextScene = createInitialScene(meshes);
    runtime.clear();
    datasetsRef.current.clear();
    meshes.forEach((mesh) => runtime.addMesh(mesh));
    runtime.selectMeshes(nextScene.selection);
    historyRef.current = createHistoryStore(nextScene);
    setPendingCommand(null);
    setScene(nextScene);
    setHistoryVersion((version) => version + 1);
    setLastMessage('已加载程序生成的涡扇发动机剖视示例。');
  }, [runtime]);

  useEffect(() => {
    loadSample();
  }, [loadSample]);

  const execute = useCallback((command: OperationCommand) => {
    const executor = createOperationExecutor(historyRef.current, runtime);
    const before = historyRef.current.current();
    const result = executor.execute(command);
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
  }, [refreshFromHistory, runtime]);

  const confirmPending = useCallback(() => {
    if (!pendingCommand) return;
    execute({ ...pendingCommand, confirmed: true });
  }, [execute, pendingCommand]);

  const cancelPending = useCallback(() => {
    if (pendingCommand?.type === 'clipMesh') {
      pendingCommandTargetIds(pendingCommand, historyRef.current.current()).forEach((meshId) => runtime.clearClip(meshId));
      restoreRuntimeScene(runtime, historyRef.current.current(), datasetsRef.current);
    }
    setPendingCommand(null);
    setLastMessage('已取消待确认操作。');
  }, [pendingCommand, runtime]);

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

  const selectMesh = useCallback((meshId: string) => {
    execute({
      id: `select-${Date.now()}`,
      type: 'selectMesh',
      target: { meshId },
      params: { mode: 'replace' },
      source: 'ui',
    });
  }, [execute]);

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
    <div className="app-shell">
      <TopBar
        meshCount={scene.meshes.length}
        selectedCount={scene.selection.length}
        visibleCount={scene.meshes.filter((mesh) => mesh.visible).length}
        displayMode={scene.displayMode}
        canUndo={historyRef.current.canUndo()}
        canRedo={historyRef.current.canRedo()}
        onLoadSample={loadSample}
        onImportFile={importFile}
        onUndo={undo}
        onRedo={redo}
        onResetView={resetView}
      />
      <div className="workbench-grid">
        <ObjectTree
          meshes={scene.meshes}
          selection={scene.selection}
          onSelect={selectMesh}
          onToggleVisibility={toggleVisibility}
          onToggleLock={toggleLock}
        />
        <ViewerPanel
          runtime={runtime}
          meshCount={scene.meshes.filter((mesh) => mesh.visible).length}
          selectedName={selectedMesh?.name}
          displayMode={scene.displayMode}
          onDisplayModeChange={setDisplayMode}
          onDropFile={importFile}
          onResetView={(orientation) => execute({
            id: `reset-${Date.now()}`,
            type: 'resetView',
            target: { scope: 'viewer' },
            params: { fit: 'visible', orientation },
            source: 'ui',
          })}
        />
        <InspectorPanel
          scene={scene}
          selectedMesh={selectedMesh}
          pendingCommand={pendingCommand}
          onConfirmPending={confirmPending}
          onCancelPending={cancelPending}
          onExecute={execute}
        />
      </div>
      <HistoryTimeline entries={historyEntries} lastMessage={lastMessage} />
    </div>
  );
}

function restoreRuntimeScene(runtime: ReturnType<typeof createVtkRuntime>, scene: SceneState, datasets: Map<string, unknown>): void {
  runtime.clear();
  scene.meshes.forEach((mesh) => runtime.addMesh(mesh, datasets.get(mesh.id)));
  runtime.selectMeshes(scene.selection);
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
