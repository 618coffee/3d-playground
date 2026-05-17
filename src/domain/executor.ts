import type { ActionResult, DisplayMode, MeshEntity, MeshTarget, OperationCommand, Vec3, VisualClip } from './actions';
import type { HistoryStore } from './history';
import { addVec3, cloneMeshEntity, type SceneState } from './scene';
import { validateOperationCommand } from './validators';

export type ViewerRuntimePort = {
  rotateMesh?: (meshId: string, axis: 'x' | 'y' | 'z' | Vec3, angleDeg: number) => void;
  setMeshScale?: (meshId: string, scale: Vec3) => void;
  cloneMesh?: (sourceId: string, clone: MeshEntity) => void;
  previewClip?: (meshId: string, clip: VisualClip) => void;
  clearClip?: (meshId: string) => void;
  resetView?: (orientation?: 'isometric' | 'front' | 'top' | 'right') => void;
  selectMeshes?: (meshIds: string[]) => void;
  setMeshVisibility?: (meshId: string, visible: boolean) => void;
  setDisplayMode?: (mode: DisplayMode) => void;
};

export type OperationExecutor = {
  execute: (command: OperationCommand) => ActionResult;
};

export type ViewerOperationExecutor = OperationExecutor;

export function createOperationExecutor(history: HistoryStore, runtime?: ViewerRuntimePort): ViewerOperationExecutor {
  return {
    execute(command) {
      const shapeValidation = validateOperationCommand(command);
      if (!shapeValidation.ok) return failed(getActionId(command), shapeValidation.error);
      const scene = history.current();
      const targetIds = resolveTargetIds(command.target, scene, canTargetHidden(command));
      const validationError = validateCommand(command, scene, targetIds);
      if (validationError) return failed(command.id, validationError);

      if (!isSceneWideCommand(command) && targetIds.length === 0) {
        return failed(command.id, '没有找到可操作的对象');
      }

      if (command.type === 'clipMesh' && command.params.mode === 'preview') {
        const clip = commandToClip(command);
        targetIds.forEach((meshId) => runtime?.previewClip?.(meshId, clip));
        const requiresPreviewConfirmation = command.source !== 'ui';
        return {
          actionId: command.id,
          status: 'preview',
          message: requiresPreviewConfirmation ? '已生成切割预览，确认后再应用。' : '已生成切割预览。',
          affectedMeshIds: targetIds,
          requiresConfirmation: requiresPreviewConfirmation,
          warnings: ['切割会改变可见几何范围，请先检查预览。'],
        };
      }

      if (requiresConfirmation(command) && !command.confirmed) {
        if (command.type === 'clipMesh' && command.params.mode === 'applyVisualClip') {
          const clip = commandToClip(command);
          targetIds.forEach((meshId) => runtime?.previewClip?.(meshId, clip));
        }
        return {
          actionId: command.id,
          status: 'preview',
          message: confirmationMessage(command),
          affectedMeshIds: targetIds,
          requiresConfirmation: true,
          warnings: confirmationWarnings(command),
        };
      }

      const nextScene = applyToScene(command, scene, targetIds, runtime);
      const recordPolicy = historyPolicy(command, scene, nextScene);
      if (recordPolicy.mode === 'record') {
        history.record(command, nextScene);
      } else if (recordPolicy.mode === 'update') {
        history.updateCurrent(nextScene);
      }

      return {
        actionId: command.id,
        status: 'applied',
        message: recordPolicy.message ?? successMessage(command),
        affectedMeshIds: targetIds,
        requiresConfirmation: false,
        warnings: [],
      };
    },
  };
}

function applyToScene(
  command: OperationCommand,
  scene: SceneState,
  targetIds: string[],
  runtime?: ViewerRuntimePort,
): SceneState {
  if (command.type === 'rotateMesh') {
    return {
      ...scene,
      meshes: scene.meshes.map((mesh) => {
        if (!targetIds.includes(mesh.id)) return mesh;
        runtime?.rotateMesh?.(mesh.id, command.params.axis, command.params.angleDeg);
        return {
          ...mesh,
          transform: {
            ...mesh.transform,
            rotationDeg: rotateVector(mesh.transform.rotationDeg, command.params.axis, command.params.angleDeg),
          },
        };
      }),
    };
  }

  if (command.type === 'cloneMesh') {
    const clones: MeshEntity[] = [];
    const cloneCount = clampCloneCount(command.params.count);
    scene.meshes.forEach((mesh) => {
      if (!targetIds.includes(mesh.id)) return;
      for (let index = 1; index <= cloneCount; index += 1) {
        const clone = cloneMeshEntity(mesh, {
          id: `${mesh.id}-${command.id}-copy-${index}`,
          name: command.params.namePattern.replace('{name}', mesh.name).replace('{n}', String(index)),
          offset: multiplyVec3(command.params.offset, index),
        });
        runtime?.cloneMesh?.(mesh.id, clone);
        clones.push(clone);
      }
    });
    return { ...scene, meshes: [...scene.meshes, ...clones] };
  }

  if (command.type === 'setMeshScale') {
    targetIds.forEach((meshId) => runtime?.setMeshScale?.(meshId, command.params.scale));
    return {
      ...scene,
      meshes: scene.meshes.map((mesh) => (
        targetIds.includes(mesh.id)
          ? { ...mesh, transform: { ...mesh.transform, scale: [...command.params.scale] } }
          : mesh
      )),
    };
  }

  if (command.type === 'selectMesh') {
    const selection = updateSelection(scene.selection, targetIds, command.params.mode);
    runtime?.selectMeshes?.(selection);
    return {
      ...scene,
      selection,
      meshes: scene.meshes.map((mesh) => ({ ...mesh, selected: selection.includes(mesh.id) })),
    };
  }

  if (command.type === 'resetView') {
    runtime?.resetView?.(command.params.orientation);
    return scene;
  }

  if (command.type === 'clipMesh') {
    if (command.params.mode === 'bakeGeometry') return scene;
    if (command.params.mode === 'clearVisualClip') {
      targetIds.forEach((meshId) => runtime?.clearClip?.(meshId));
      return {
        ...scene,
        meshes: scene.meshes.map((mesh) => (targetIds.includes(mesh.id) ? { ...mesh, clipping: undefined } : mesh)),
      };
    }
    const clip = commandToClip(command);
    targetIds.forEach((meshId) => runtime?.previewClip?.(meshId, clip));
    return {
      ...scene,
      meshes: scene.meshes.map((mesh) => (targetIds.includes(mesh.id) ? { ...mesh, clipping: clip } : mesh)),
    };
  }

  if (command.type === 'setMeshVisibility') {
    targetIds.forEach((meshId) => runtime?.setMeshVisibility?.(meshId, command.params.visible));
    const nextSelection = command.params.visible ? scene.selection : scene.selection.filter((id) => !targetIds.includes(id));
    runtime?.selectMeshes?.(nextSelection);
    return {
      ...scene,
      selection: nextSelection,
      meshes: scene.meshes.map((mesh) => (
        targetIds.includes(mesh.id)
          ? { ...mesh, visible: command.params.visible, selected: nextSelection.includes(mesh.id) }
          : { ...mesh, selected: nextSelection.includes(mesh.id) }
      )),
    };
  }

  if (command.type === 'setMeshLocked') {
    return {
      ...scene,
      meshes: scene.meshes.map((mesh) => (targetIds.includes(mesh.id) ? { ...mesh, locked: command.params.locked } : mesh)),
    };
  }

  if (command.type === 'setDisplayMode') {
    runtime?.setDisplayMode?.(command.params.mode);
    return { ...scene, displayMode: command.params.mode };
  }

  if (command.type === 'importMesh') {
    const imported = command.params.mesh;
    const nextMeshes = scene.meshes.map((mesh) => ({ ...mesh, selected: false })).concat(imported);
    const nextScene = { ...scene, meshes: nextMeshes, selection: [imported.id] };
    runtime?.selectMeshes?.(nextScene.selection);
    return nextScene;
  }

  return scene;
}

function resolveTargetIds(target: MeshTarget | { scope: 'viewer' } | { scope: 'scene' }, scene: SceneState, includeHidden = false): string[] {
  if ('scope' in target) return [];
  const isTargetable = (mesh: MeshEntity) => includeHidden || mesh.visible;
  if ('meshId' in target) return scene.meshes.some((mesh) => mesh.id === target.meshId && isTargetable(mesh)) ? [target.meshId] : [];
  if ('meshIds' in target) return target.meshIds.filter((id) => scene.meshes.some((mesh) => mesh.id === id && isTargetable(mesh)));
  if ('source' in target && target.source === 'selection') return scene.selection.filter((id) => scene.meshes.some((mesh) => mesh.id === id && isTargetable(mesh)));
  if ('source' in target && target.source === 'allVisible') return scene.meshes.filter((mesh) => mesh.visible).map((mesh) => mesh.id);
  if ('name' in target) {
    const query = target.name.toLowerCase();
    return scene.meshes
      .filter((mesh) => isTargetable(mesh) && (target.match === 'exact' ? mesh.name.toLowerCase() === query : mesh.name.toLowerCase().includes(query)))
      .map((mesh) => mesh.id);
  }
  return [];
}

function updateSelection(current: string[], targetIds: string[], mode: 'replace' | 'add' | 'remove'): string[] {
  if (mode === 'replace') return targetIds;
  if (mode === 'remove') return current.filter((id) => !targetIds.includes(id));
  return [...current, ...targetIds.filter((id) => !current.includes(id))];
}

function historyPolicy(command: OperationCommand, scene: SceneState, nextScene: SceneState): { mode: 'record' | 'update' | 'ignore'; message?: string } {
  if (command.type === 'rotateMesh' && command.source === 'ui' && command.rawText === 'viewport drag rotate') return { mode: 'update' };
  if (command.type === 'selectMesh' && sameStringList(scene.selection, nextScene.selection)) {
    return { mode: 'ignore', message: '选择未变化。' };
  }
  return { mode: 'record' };
}

function sameStringList(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function rotateVector(rotation: Vec3, axis: 'x' | 'y' | 'z' | Vec3, angleDeg: number): Vec3 {
  if (Array.isArray(axis)) return addVec3(rotation, [axis[0] * angleDeg, axis[1] * angleDeg, axis[2] * angleDeg]);
  if (axis === 'x') return [rotation[0] + angleDeg, rotation[1], rotation[2]];
  if (axis === 'y') return [rotation[0], rotation[1] + angleDeg, rotation[2]];
  return [rotation[0], rotation[1], rotation[2] + angleDeg];
}

function multiplyVec3(vector: Vec3, factor: number): Vec3 {
  return [normalizeNumber(vector[0] * factor), normalizeNumber(vector[1] * factor), normalizeNumber(vector[2] * factor)];
}

function normalizeNumber(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function clampCloneCount(count: number): number {
  if (!Number.isFinite(count)) return 1;
  return Math.min(12, Math.max(1, Math.trunc(count)));
}

function failed(actionId: string, message: string): ActionResult {
  return {
    actionId,
    status: 'failed',
    message,
    affectedMeshIds: [],
    requiresConfirmation: false,
    warnings: [],
  };
}

function getActionId(command: unknown): string {
  if (typeof command === 'object' && command !== null && 'id' in command && typeof command.id === 'string') {
    return command.id;
  }
  return 'invalid-command';
}

function successMessage(command: OperationCommand): string {
  if (command.type === 'rotateMesh') return `已旋转 ${command.params.angleDeg} 度。`;
  if (command.type === 'cloneMesh') return `已复制 ${clampCloneCount(command.params.count)} 个对象。`;
  if (command.type === 'setMeshScale') return `已缩放对象到 ${command.params.scale[0].toFixed(2)}x。`;
  if (command.type === 'selectMesh') return '已更新选择。';
  if (command.type === 'resetView') return '已重置视角。';
  if (command.type === 'clipMesh') return command.params.mode === 'clearVisualClip' ? '已清除视觉切割。' : '已应用视觉切割。';
  if (command.type === 'setMeshVisibility') return command.params.visible ? '已显示对象。' : '已隐藏对象。';
  if (command.type === 'setMeshLocked') return command.params.locked ? '已锁定对象。' : '已解锁对象。';
  if (command.type === 'setDisplayMode') return `显示模式已切换为 ${command.params.mode}。`;
  if (command.type === 'importMesh') return `已导入 ${command.params.mesh.name}。`;
  return '操作已应用。';
}

function isSceneWideCommand(command: OperationCommand): boolean {
  return command.type === 'resetView' || command.type === 'setDisplayMode' || command.type === 'importMesh';
}

function canTargetHidden(command: OperationCommand): boolean {
  return command.type === 'selectMesh' || command.type === 'setMeshVisibility' || command.type === 'setMeshLocked';
}

function commandToClip(command: Extract<OperationCommand, { type: 'clipMesh' }>): VisualClip {
  return {
    plane: {
      origin: [...command.params.plane.origin],
      normal: command.params.keepSide === 'positive' ? [...command.params.plane.normal] : multiplyVec3(command.params.plane.normal, -1),
    },
    keepSide: command.params.keepSide,
    cap: command.params.cap,
  };
}

function requiresConfirmation(command: OperationCommand): boolean {
  if (command.type === 'cloneMesh') return clampCloneCount(command.params.count) > 5;
  if (command.type === 'clipMesh') return command.params.mode === 'applyVisualClip' || command.params.mode === 'bakeGeometry';
  return false;
}

function confirmationMessage(command: OperationCommand): string {
  if (command.type === 'cloneMesh') return `准备复制 ${clampCloneCount(command.params.count)} 个对象，请确认后执行。`;
  if (command.type === 'clipMesh') return command.params.mode === 'bakeGeometry'
    ? '真实几何切割不在当前 MVP 中，请改用视觉切割。'
    : '切割预览已就绪，请确认后应用为视觉切割。';
  return '请确认后执行。';
}

function confirmationWarnings(command: OperationCommand): string[] {
  if (command.type === 'cloneMesh') return ['大量复制可能影响浏览器帧率。'];
  if (command.type === 'clipMesh' && command.params.mode === 'bakeGeometry') return ['当前 MVP 不支持真实烘焙几何切割。'];
  if (command.type === 'clipMesh') return ['视觉切割会保留原始网格数据，可通过撤销恢复。'];
  return [];
}

function validateCommand(command: OperationCommand, scene: SceneState, targetIds: string[]): string | undefined {
  if (command.type === 'importMesh') {
    if (!command.params.mesh.id || !command.params.mesh.name) return '导入对象缺少名称或 ID。';
    if (scene.meshes.some((mesh) => mesh.id === command.params.mesh.id)) return '导入对象 ID 已存在。';
  }
  if (command.type === 'rotateMesh' && !Number.isFinite(command.params.angleDeg)) return '旋转角度无效。';
  if (command.type === 'setMeshScale') {
    if (!isValidVec3(command.params.scale)) return '缩放比例无效。';
    if (command.params.scale.some((value) => value <= 0)) return '缩放比例必须大于 0。';
  }
  if (command.type === 'cloneMesh' && !Number.isFinite(command.params.count)) return '复制数量无效。';
  if (command.type === 'clipMesh') {
    if (command.params.mode === 'bakeGeometry') return '当前 MVP 暂不支持真实几何切割，请使用视觉切割。';
    if (!isValidVec3(command.params.plane.origin) || !isValidVec3(command.params.plane.normal)) return '切割平面参数无效。';
    if (vectorLength(command.params.plane.normal) === 0) return '切割平面法线不能为零。';
  }
  if (targetIds.some((id) => scene.meshes.some((mesh) => mesh.id === id && mesh.locked && !canOperateOnLocked(command)))) {
    return '对象已锁定，请先解锁再操作。';
  }
  return undefined;
}

function canOperateOnLocked(command: OperationCommand): boolean {
  return command.type === 'selectMesh' || command.type === 'setMeshVisibility' || command.type === 'setMeshLocked';
}

function isValidVec3(vector: Vec3): boolean {
  return vector.length === 3 && vector.every(Number.isFinite);
}

function vectorLength(vector: Vec3): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}
