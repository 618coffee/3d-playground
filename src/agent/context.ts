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
  color: string;
  colorLabel: string;
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
    color: normalizeHexColor(mesh.color) ?? mesh.color,
    colorLabel: colorLabelForHex(normalizeHexColor(mesh.color) ?? mesh.color),
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

function normalizeHexColor(value: string): string | undefined {
  const match = value.trim().match(/^#?([0-9a-f]{6})$/i);
  return match ? `#${match[1].toLowerCase()}` : undefined;
}

function colorLabelForHex(hex: string): string {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return 'unknown';
  const red = Number.parseInt(normalized.slice(1, 3), 16) / 255;
  const green = Number.parseInt(normalized.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(normalized.slice(5, 7), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const lightness = (max + min) / 2;
  if (delta < 0.08) return lightness < 0.35 ? 'black' : lightness > 0.75 ? 'white' : 'gray';
  let hue: number;
  if (max === red) hue = ((green - blue) / delta) % 6;
  else if (max === green) hue = (blue - red) / delta + 2;
  else hue = (red - green) / delta + 4;
  const degrees = (hue * 60 + 360) % 360;
  if (degrees < 15 || degrees >= 345) return 'red';
  if (degrees < 36) return 'orange';
  if (degrees < 55) return 'gold';
  if (degrees < 75) return 'yellow';
  if (degrees < 165) return 'green';
  if (degrees < 195) return 'cyan';
  if (degrees < 255) return 'blue';
  if (degrees < 285) return 'purple';
  if (degrees < 345) return 'magenta';
  return 'gray';
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
