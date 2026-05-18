export type MeshSourceFormat = 'procedural' | 'stl' | 'obj' | 'ply' | 'vtp' | 'vtu' | 'vtk';

export type Vec3 = [number, number, number];

export type DisplayMode = 'surface' | 'wireframe' | 'points';

export type VisualClip = {
  plane: {
    origin: Vec3;
    normal: Vec3;
  };
  keepSide: 'positive' | 'negative';
  cap: boolean;
};

type CommandMeta = {
  id: string;
  source: 'ui' | 'agent';
  rawText?: string;
  confirmed?: boolean;
};

export type MeshEntity = {
  id: string;
  name: string;
  sourceFormat: MeshSourceFormat;
  visible: boolean;
  locked: boolean;
  selected: boolean;
  color: string;
  opacity: number;
  bounds: [number, number, number, number, number, number];
  stats: {
    points: number;
    cells: number;
    triangles?: number;
  };
  transform: {
    position: Vec3;
    rotationDeg: Vec3;
    scale: Vec3;
  };
  clipping?: VisualClip;
  geometry?: ProceduralGeometry;
};

export type ProceduralGeometry =
  | {
      type: 'cylinder';
      radius: number;
      height: number;
      center: Vec3;
      direction: Vec3;
      resolution: number;
      opacity?: number;
    }
  | {
      type: 'cone';
      radius: number;
      height: number;
      center: Vec3;
      direction: Vec3;
      resolution: number;
      opacity?: number;
    }
  | {
      type: 'box';
      size: Vec3;
      center: Vec3;
      rotationDeg?: Vec3;
      opacity?: number;
    }
  | {
      type: 'sphere';
      radius: number;
      center: Vec3;
      thetaResolution: number;
      phiResolution: number;
      opacity?: number;
    }
  | {
      type: 'fanStage';
      bladeCount: number;
      radius: number;
      bladeLength: number;
      bladeRadius: number;
      x: number;
    };

export type MeshTarget =
  | { meshId: string }
  | { meshIds: string[] }
  | { source: 'selection' }
  | { source: 'allVisible' }
  | { name: string; match: 'exact' | 'fuzzy' };

export type OperationCommand =
  | (CommandMeta & {
      type: 'selectMesh';
      target: MeshTarget;
      params: { mode: 'replace' | 'add' | 'remove' };
    })
  | (CommandMeta & {
      type: 'rotateMesh';
      target: MeshTarget;
      params: {
        axis: 'x' | 'y' | 'z' | Vec3;
        angleDeg: number;
        pivot: 'boundsCenter' | 'origin' | Vec3;
        space: 'world' | 'local';
      };
    })
  | (CommandMeta & {
      type: 'moveMesh';
      target: MeshTarget;
      params: {
        offset: Vec3;
        unit: 'mm' | 'cm' | 'm' | 'model';
      };
    })
  | (CommandMeta & {
      type: 'cloneMesh';
      target: MeshTarget;
      params: {
        count: number;
        offset: Vec3;
        unit: 'mm' | 'cm' | 'm' | 'model';
        shareGeometry: boolean;
        namePattern: string;
      };
    })
  | (CommandMeta & {
      type: 'deleteMesh';
      target: MeshTarget;
      params: Record<string, never>;
    })
  | (CommandMeta & {
      type: 'setMeshScale';
      target: MeshTarget;
      params: { scale: Vec3 };
    })
  | (CommandMeta & {
      type: 'clipMesh';
      target: MeshTarget;
      params: {
        plane: VisualClip['plane'];
        keepSide: VisualClip['keepSide'];
        mode: 'preview' | 'applyVisualClip' | 'clearVisualClip' | 'bakeGeometry';
        cap: boolean;
      };
    })
  | (CommandMeta & {
      type: 'resetView';
      target: { scope: 'viewer' };
      params: { fit: 'visible' | 'selection'; orientation: 'isometric' | 'front' | 'top' | 'right' };
    })
  | (CommandMeta & {
      type: 'setMeshVisibility';
      target: MeshTarget;
      params: { visible: boolean };
    })
  | (CommandMeta & {
      type: 'setMeshLocked';
      target: MeshTarget;
      params: { locked: boolean };
    })
  | (CommandMeta & {
      type: 'setDisplayMode';
      target: { scope: 'viewer' };
      params: { mode: DisplayMode };
    })
  | (CommandMeta & {
      type: 'importMesh';
      target: { scope: 'scene' };
      params: { mesh: MeshEntity };
    });

export type ActionResult = {
  actionId: string;
  status: 'preview' | 'applied' | 'rejected' | 'failed';
  message: string;
  affectedMeshIds: string[];
  requiresConfirmation: boolean;
  warnings: string[];
};
