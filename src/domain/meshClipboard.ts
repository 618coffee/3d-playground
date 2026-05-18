import type { MeshEntity, Vec3 } from './actions';

export type MeshClipboardEntry = {
  id: string;
  name: string;
  bounds: MeshEntity['bounds'];
  transform: MeshEntity['transform'];
};

export function createMeshClipboardEntries(meshes: readonly MeshEntity[], selection: readonly string[]): MeshClipboardEntry[] {
  return selection
    .map((id) => meshes.find((mesh) => mesh.id === id))
    .filter((mesh): mesh is MeshEntity => Boolean(mesh))
    .map((mesh) => ({
      id: mesh.id,
      name: mesh.name,
      bounds: [...mesh.bounds],
      transform: {
        position: [...mesh.transform.position],
        rotationDeg: [...mesh.transform.rotationDeg],
        scale: [...mesh.transform.scale],
      },
    }));
}

export function defaultClonePasteOffset(entries: readonly MeshClipboardEntry[]): Vec3 {
  if (entries.length === 0) return [20, 0, 0];
  const minX = Math.min(...entries.map((entry) => entry.bounds[0]));
  const maxX = Math.max(...entries.map((entry) => entry.bounds[1]));
  return [Math.max(20, maxX - minX + 20), 0, 0];
}

export function meshMentionText(entries: readonly Pick<MeshClipboardEntry, 'name'>[]): string {
  return entries.map((entry) => `@${entry.name}`).join(' ');
}