import type { MeshEntity, ProceduralGeometry } from '../domain/actions';

type SamplePart = Omit<MeshEntity, 'stats' | 'bounds' | 'transform' | 'sourceFormat' | 'visible' | 'locked' | 'selected'> & {
  bounds: MeshEntity['bounds'];
  geometry: ProceduralGeometry;
};

const partDefaults = {
  sourceFormat: 'procedural' as const,
  visible: true,
  locked: false,
  selected: false,
  opacity: 1,
  transform: {
    position: [0, 0, 0] as [number, number, number],
    rotationDeg: [0, 0, 0] as [number, number, number],
    scale: [1, 1, 1] as [number, number, number],
  },
};

export function createTurbofanSample(): MeshEntity[] {
  const parts: SamplePart[] = [
    {
      id: 'nacelle-casing',
      name: 'Nacelle translucent casing',
      color: '#7e8fa6',
      opacity: 0.28,
      bounds: [-55, 55, -44, 44, -44, 44],
      geometry: { type: 'cylinder', radius: 44, height: 110, center: [0, 0, 0], direction: [1, 0, 0], resolution: 96, opacity: 0.28 },
    },
    {
      id: 'front-inlet-ring',
      name: 'Front inlet ring',
      color: '#4b6077',
      opacity: 0.55,
      bounds: [-58, -48, -46, 46, -46, 46],
      geometry: { type: 'cylinder', radius: 46, height: 8, center: [-52, 0, 0], direction: [1, 0, 0], resolution: 96, opacity: 0.55 },
    },
    {
      id: 'fan-stage',
      name: 'Blue titanium fan stage',
      color: '#43b7ff',
      opacity: 0.95,
      bounds: [-42, -30, -34, 34, -34, 34],
      geometry: { type: 'fanStage', bladeCount: 28, radius: 12, bladeLength: 30, bladeRadius: 2.2, x: -38 },
    },
    {
      id: 'compressor-core',
      name: 'Compressor core shaft',
      color: '#d5a553',
      opacity: 0.98,
      bounds: [-45, 45, -11, 11, -11, 11],
      geometry: { type: 'cylinder', radius: 11, height: 90, center: [0, 0, 0], direction: [1, 0, 0], resolution: 64 },
    },
    {
      id: 'stator-vanes',
      name: 'Warm stator vane stage',
      color: '#f08a4b',
      opacity: 0.86,
      bounds: [-16, -4, -28, 28, -28, 28],
      geometry: { type: 'fanStage', bladeCount: 18, radius: 13, bladeLength: 18, bladeRadius: 1.4, x: -10 },
    },
    {
      id: 'aft-nozzle',
      name: 'Aft nozzle cone',
      color: '#8dd1c8',
      opacity: 0.72,
      bounds: [35, 60, -25, 25, -25, 25],
      geometry: { type: 'cone', radius: 25, height: 36, center: [45, 0, 0], direction: [1, 0, 0], resolution: 96, opacity: 0.72 },
    },
  ];

  return parts.map((part, index) => ({
    ...partDefaults,
    ...part,
    selected: index === 2,
    stats: estimateStats(part.geometry),
  }));
}

function estimateStats(geometry: ProceduralGeometry): MeshEntity['stats'] {
  if (geometry.type === 'fanStage') {
    return { points: geometry.bladeCount * 14, cells: geometry.bladeCount * 8, triangles: geometry.bladeCount * 8 };
  }
  return { points: geometry.resolution * 2, cells: geometry.resolution, triangles: geometry.resolution * 2 };
}