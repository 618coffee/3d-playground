import type { MeshEntity, OperationCommand, Vec3, VisualClip } from '../domain/actions';
import type { HistoryEntry } from '../domain/history';
import type { SceneState } from '../domain/scene';

const MAX_RECENT_HISTORY_ENTRIES = 5;
const MAX_HISTORY_RAW_TEXT_CHARS = 160;

type Bounds = [number, number, number, number, number, number];
type OperationActionName = OperationCommand['type'];

export const SUPPORTED_ACTION_NAMES = [
  'selectMesh',
  'rotateMesh',
  'cloneMesh',
  'setMeshScale',
  'clipMesh',
  'resetView',
  'setMeshVisibility',
  'setMeshLocked',
  'setDisplayMode',
  'importMesh',
] as const satisfies readonly OperationActionName[];

const SAFETY_RULES = [
  'Return only supported OperationCommand drafts; do not execute viewer or system code.',
  'Use mesh ids from the scene context and ask for clarification when the target is ambiguous.',
  'Do not request raw geometry, imported file contents, vtk datasets, or browser runtime objects.',
  'Risky visual clipping and large clone operations require user review before execution.',
  'Baked geometry cutting, meshing, solver runs, and arbitrary code execution are outside the browser-safe action set.',
] as const;

export type AgentContext = {
  scene: {
    unit: SceneState['unit'];
    displayMode: SceneState['displayMode'];
    selectedMeshIds: string[];
    meshes: AgentMeshContext[];
  };
  recentHistory: AgentHistoryContext[];
  supportedActions: OperationActionName[];
  safetyRules: string[];
};

export type AgentMeshContext = {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  source: MeshEntity['sourceFormat'];
  stats: {
    points: number;
    cells: number;
    triangles?: number;
  };
  bounds: Bounds;
  transform: {
    position: Vec3;
    rotationDeg: Vec3;
    scale: Vec3;
  };
  clipping: AgentClippingContext;
};

export type AgentClippingContext =
  | { active: false }
  | {
      active: true;
      plane: {
        origin: Vec3;
        normal: Vec3;
      };
      keepSide: VisualClip['keepSide'];
      cap: boolean;
    };

export type AgentHistoryContext = {
  type: OperationActionName;
  rawText?: string;
};

export function buildAgentContext(scene: SceneState, historyEntries: readonly HistoryEntry[] = []): AgentContext {
  return {
    scene: {
      unit: scene.unit,
      displayMode: scene.displayMode,
      selectedMeshIds: [...scene.selection],
      meshes: scene.meshes.map(summarizeMesh),
    },
    recentHistory: summarizeHistory(historyEntries),
    supportedActions: [...SUPPORTED_ACTION_NAMES],
    safetyRules: [...SAFETY_RULES],
  };
}

function summarizeMesh(mesh: MeshEntity): AgentMeshContext {
  return {
    id: mesh.id,
    name: mesh.name,
    visible: mesh.visible,
    locked: mesh.locked,
    source: mesh.sourceFormat,
    stats: summarizeStats(mesh.stats),
    bounds: cloneBounds(mesh.bounds),
    transform: {
      position: cloneVec3(mesh.transform.position),
      rotationDeg: cloneVec3(mesh.transform.rotationDeg),
      scale: cloneVec3(mesh.transform.scale),
    },
    clipping: summarizeClipping(mesh.clipping),
  };
}

function summarizeStats(stats: MeshEntity['stats']): AgentMeshContext['stats'] {
  if (stats.triangles === undefined) {
    return { points: stats.points, cells: stats.cells };
  }
  return { points: stats.points, cells: stats.cells, triangles: stats.triangles };
}

function summarizeClipping(clipping: VisualClip | undefined): AgentClippingContext {
  if (!clipping) return { active: false };
  return {
    active: true,
    plane: {
      origin: cloneVec3(clipping.plane.origin),
      normal: cloneVec3(clipping.plane.normal),
    },
    keepSide: clipping.keepSide,
    cap: clipping.cap,
  };
}

function summarizeHistory(historyEntries: readonly HistoryEntry[]): AgentHistoryContext[] {
  return historyEntries.slice(-MAX_RECENT_HISTORY_ENTRIES).map((entry) => ({
    type: entry.command.type,
    rawText: compactRawText(entry.command.rawText),
  }));
}

function compactRawText(rawText: string | undefined): string | undefined {
  if (!rawText) return undefined;
  const compact = rawText.replace(/\s+/g, ' ').trim();
  if (compact.length <= MAX_HISTORY_RAW_TEXT_CHARS) return compact;
  return `${compact.slice(0, MAX_HISTORY_RAW_TEXT_CHARS - 3)}...`;
}

function cloneVec3(vector: Vec3): Vec3 {
  return [vector[0], vector[1], vector[2]];
}

function cloneBounds(bounds: Bounds): Bounds {
  return [bounds[0], bounds[1], bounds[2], bounds[3], bounds[4], bounds[5]];
}
