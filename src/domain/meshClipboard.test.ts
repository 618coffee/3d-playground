import { describe, expect, it } from 'vitest';
import type { MeshEntity } from './actions';
import { createMeshClipboardEntries, defaultClonePasteOffset, meshMentionText } from './meshClipboard';

const baseMesh: MeshEntity = {
  id: 'fan-stage',
  name: 'Blue titanium fan stage',
  sourceFormat: 'procedural',
  visible: true,
  locked: false,
  selected: true,
  color: '#7bd389',
  opacity: 1,
  bounds: [-60, -20, -35, 35, -35, 35],
  stats: { points: 240, cells: 160, triangles: 160 },
  transform: { position: [-38, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
};

describe('mesh clipboard helpers', () => {
  it('snapshots selected meshes in selection order', () => {
    const second: MeshEntity = { ...baseMesh, id: 'compressor-core', name: 'Compressor core', bounds: [-20, 35, -22, 22, -22, 22] };

    const entries = createMeshClipboardEntries([baseMesh, second], ['compressor-core', 'fan-stage']);

    expect(entries.map((entry) => entry.id)).toEqual(['compressor-core', 'fan-stage']);
    expect(entries[0]).toMatchObject({ id: 'compressor-core', name: 'Compressor core' });
  });

  it('computes a positive x offset large enough to avoid overlap', () => {
    const entries = createMeshClipboardEntries([baseMesh], ['fan-stage']);

    expect(defaultClonePasteOffset(entries)).toEqual([60, 0, 0]);
  });

  it('uses a readable mention text without exposing raw ids', () => {
    expect(meshMentionText([{ name: 'Blue titanium fan stage' }])).toBe('@Blue titanium fan stage');
  });
});