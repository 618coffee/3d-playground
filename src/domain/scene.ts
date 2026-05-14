import type { DisplayMode, MeshEntity, Vec3, VisualClip } from './actions';

export type SceneState = {
  meshes: MeshEntity[];
  selection: string[];
  unit: 'mm' | 'cm' | 'm' | 'model';
  displayMode: DisplayMode;
};

export function createInitialScene(meshes: MeshEntity[] = []): SceneState {
  return {
    meshes: meshes.map(cloneMesh),
    selection: meshes.filter((mesh) => mesh.selected).map((mesh) => mesh.id),
    unit: 'mm',
    displayMode: 'surface',
  };
}

export function cloneMeshEntity(
  mesh: MeshEntity,
  options: { id: string; name: string; offset: Vec3 },
): MeshEntity {
  return {
    ...mesh,
    id: options.id,
    name: options.name,
    selected: false,
    transform: {
      position: addVec3(mesh.transform.position, options.offset),
      rotationDeg: [...mesh.transform.rotationDeg],
      scale: [...mesh.transform.scale],
    },
    clipping: cloneClip(mesh.clipping),
  };
}

export function addVec3(left: Vec3, right: Vec3): Vec3 {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

export function cloneScene(scene: SceneState): SceneState {
  return {
    ...scene,
    meshes: scene.meshes.map(cloneMesh),
    selection: [...scene.selection],
  };
}

function cloneMesh(mesh: MeshEntity): MeshEntity {
  return {
    ...mesh,
    bounds: [...mesh.bounds],
    stats: { ...mesh.stats },
    transform: {
      position: [...mesh.transform.position],
      rotationDeg: [...mesh.transform.rotationDeg],
      scale: [...mesh.transform.scale],
    },
    clipping: cloneClip(mesh.clipping),
  };
}

function cloneClip(clip?: VisualClip): VisualClip | undefined {
  if (!clip) return undefined;
  return {
    plane: {
      origin: [...clip.plane.origin],
      normal: [...clip.plane.normal],
    },
    keepSide: clip.keepSide,
    cap: clip.cap,
  };
}
