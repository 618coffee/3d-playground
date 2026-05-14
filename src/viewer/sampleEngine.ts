import type { MeshEntity, ProceduralGeometry } from '../domain/actions';

export type SampleWorkspaceId = 'turbofan' | 'robotic-cell';

export type SampleWorkspaceOption = {
  id: SampleWorkspaceId;
  label: string;
  description: string;
};

export const SAMPLE_WORKSPACES: SampleWorkspaceOption[] = [
  {
    id: 'turbofan',
    label: '涡扇剖视',
    description: 'A compact transparent turbofan assembly for clipping and display-mode demos.',
  },
  {
    id: 'robotic-cell',
    label: '机器人检测产线',
    description: 'A denser industrial cell with robot joints, conveyor, sensors, guard rails, and part fixtures.',
  },
];

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

export function createSampleWorkspace(workspaceId: SampleWorkspaceId): MeshEntity[] {
  if (workspaceId === 'robotic-cell') return createRoboticInspectionCellSample();
  return createTurbofanSample();
}

export function createRoboticInspectionCellSample(): MeshEntity[] {
  const parts: SamplePart[] = [
    boxPart('cell-floor', 'Cell floor datum plate', '#405063', 0.82, [0, 0, -4], [168, 112, 5], [-84, 84, -56, 56, -6.5, -1.5]),
    boxPart('conveyor-bed', 'Conveyor bed frame', '#56687d', 0.94, [0, 0, 4], [132, 26, 10], [-66, 66, -13, 13, -1, 9]),
    boxPart('conveyor-belt', 'Matte conveyor belt', '#202b35', 0.98, [0, 0, 10.5], [126, 21, 3], [-63, 63, -10.5, 10.5, 9, 12]),
    boxPart('left-guide-rail', 'Left conveyor guide rail', '#9cadb8', 0.92, [0, -14, 18], [130, 2.5, 12], [-65, 65, -15.25, -12.75, 12, 24]),
    boxPart('right-guide-rail', 'Right conveyor guide rail', '#9cadb8', 0.92, [0, 14, 18], [130, 2.5, 12], [-65, 65, 12.75, 15.25, 12, 24]),
    boxPart('fixture-pallet-a', 'Indexed fixture pallet A', '#d5a553', 0.9, [-32, 0, 17], [21, 17, 6], [-42.5, -21.5, -8.5, 8.5, 14, 20]),
    boxPart('fixture-pallet-b', 'Indexed fixture pallet B', '#f08a4b', 0.9, [10, 0, 17], [21, 17, 6], [-0.5, 20.5, -8.5, 8.5, 14, 20]),
    boxPart('inspection-part', 'Curved inspection housing', '#43b7ff', 0.96, [12, 0, 27], [18, 12, 14], [3, 21, -6, 6, 20, 34], [0, 0, -8]),
    cylinderPart('robot-base-turntable', 'Robot base turntable', '#536b83', 0.96, 15, 9, [-50, 34, 9], [0, 0, 1], [-65, -35, 19, 49, 4.5, 13.5], 80),
    cylinderPart('robot-shoulder-joint', 'Robot shoulder joint', '#7a91aa', 0.96, 8, 18, [-50, 34, 29], [0, 1, 0], [-58, -42, 25, 43, 21, 37], 64),
    cylinderPart('robot-upper-arm', 'Robot upper arm link', '#5f7f9a', 0.94, 6.5, 34, [-38, 34, 43], [0.58, 0, 0.82], [-54, -22, 27.5, 40.5, 28, 58]),
    cylinderPart('robot-elbow-joint', 'Robot elbow joint', '#86a0ba', 0.96, 7, 16, [-26, 34, 58], [0, 1, 0], [-33, -19, 26, 42, 51, 65], 64),
    cylinderPart('robot-forearm-link', 'Robot forearm link', '#6b8ead', 0.94, 5.5, 30, [-12, 27, 48], [0.72, -0.28, -0.63], [-25, 3, 18, 34, 35, 61]),
    spherePart('robot-wrist-joint', 'Robot wrist joint', '#a6bdd2', 0.97, 7, [2, 22, 38], [-5, 9, 15, 29, 31, 45]),
    cylinderPart('end-effector-camera', 'End effector camera pod', '#2dd4bf', 0.96, 5, 11, [9, 18, 33], [0.72, -0.28, -0.63], [3, 15, 11, 25, 27, 39], 48),
    conePart('scanner-frustum', 'Translucent scan frustum', '#63d8ff', 0.18, 18, 24, [20, 13, 22], [0.72, -0.28, -0.63], [9, 31, -1, 27, 7, 37], 64),
    boxPart('vision-gantry-left', 'Vision gantry left upright', '#778899', 0.88, [38, -31, 27], [8, 6, 58], [34, 42, -34, -28, -2, 56]),
    boxPart('vision-gantry-right', 'Vision gantry right upright', '#778899', 0.88, [38, 31, 27], [8, 6, 58], [34, 42, 28, 34, -2, 56]),
    boxPart('vision-gantry-crossbeam', 'Vision gantry crossbeam', '#91a4b8', 0.9, [38, 0, 55], [10, 68, 8], [33, 43, -34, 34, 51, 59]),
    boxPart('line-scan-camera', 'Line scan camera bar', '#d7e4f1', 0.96, [38, 0, 46], [7, 42, 5], [34.5, 41.5, -21, 21, 43.5, 48.5]),
    cylinderPart('status-tower-red', 'Status tower red lens', '#ef5a5a', 0.88, 3.8, 4, [62, -43, 43], [0, 0, 1], [58, 66, -47, -39, 41, 45], 36),
    cylinderPart('status-tower-amber', 'Status tower amber lens', '#f3b34c', 0.88, 3.8, 4, [62, -43, 38], [0, 0, 1], [58, 66, -47, -39, 36, 40], 36),
    cylinderPart('status-tower-green', 'Status tower green lens', '#67d28f', 0.88, 3.8, 4, [62, -43, 33], [0, 0, 1], [58, 66, -47, -39, 31, 35], 36),
    cylinderPart('tower-post', 'Status tower post', '#8fa3b8', 0.8, 1.2, 38, [62, -43, 16], [0, 0, 1], [60.8, 63.2, -44.2, -41.8, -3, 35], 24),
    ...guardRailParts(),
  ];

  return parts.map((part) => ({
    ...partDefaults,
    ...part,
    selected: part.id === 'inspection-part',
    stats: estimateStats(part.geometry),
  }));
}

function guardRailParts(): SamplePart[] {
  return [
    boxPart('front-safety-rail', 'Front safety rail', '#e3c46d', 0.88, [0, -54, 24], [160, 3, 5], [-80, 80, -55.5, -52.5, 21.5, 26.5]),
    boxPart('rear-safety-rail', 'Rear safety rail', '#e3c46d', 0.88, [0, 54, 24], [160, 3, 5], [-80, 80, 52.5, 55.5, 21.5, 26.5]),
    boxPart('left-safety-rail', 'Left safety rail', '#e3c46d', 0.88, [-80, 0, 24], [3, 108, 5], [-81.5, -78.5, -54, 54, 21.5, 26.5]),
    boxPart('right-safety-rail', 'Right safety rail', '#e3c46d', 0.88, [80, 0, 24], [3, 108, 5], [78.5, 81.5, -54, 54, 21.5, 26.5]),
    ...[-63, -21, 21, 63].flatMap((x, index) => [
      boxPart(`front-rail-post-${index + 1}`, `Front rail post ${index + 1}`, '#c8aa5c', 0.9, [x, -54, 8], [4, 4, 24], [x - 2, x + 2, -56, -52, -4, 20]),
      boxPart(`rear-rail-post-${index + 1}`, `Rear rail post ${index + 1}`, '#c8aa5c', 0.9, [x, 54, 8], [4, 4, 24], [x - 2, x + 2, 52, 56, -4, 20]),
    ]),
  ];
}

function boxPart(
  id: string,
  name: string,
  color: string,
  opacity: number,
  center: [number, number, number],
  size: [number, number, number],
  bounds: MeshEntity['bounds'],
  rotationDeg?: [number, number, number],
): SamplePart {
  return {
    id,
    name,
    color,
    opacity,
    bounds,
    geometry: { type: 'box', center, size, rotationDeg, opacity },
  };
}

function spherePart(
  id: string,
  name: string,
  color: string,
  opacity: number,
  radius: number,
  center: [number, number, number],
  bounds: MeshEntity['bounds'],
): SamplePart {
  return {
    id,
    name,
    color,
    opacity,
    bounds,
    geometry: { type: 'sphere', radius, center, thetaResolution: 48, phiResolution: 24, opacity },
  };
}

function cylinderPart(
  id: string,
  name: string,
  color: string,
  opacity: number,
  radius: number,
  height: number,
  center: [number, number, number],
  direction: [number, number, number],
  bounds: MeshEntity['bounds'],
  resolution = 48,
): SamplePart {
  return {
    id,
    name,
    color,
    opacity,
    bounds,
    geometry: { type: 'cylinder', radius, height, center, direction, resolution, opacity },
  };
}

function conePart(
  id: string,
  name: string,
  color: string,
  opacity: number,
  radius: number,
  height: number,
  center: [number, number, number],
  direction: [number, number, number],
  bounds: MeshEntity['bounds'],
  resolution = 48,
): SamplePart {
  return {
    id,
    name,
    color,
    opacity,
    bounds,
    geometry: { type: 'cone', radius, height, center, direction, resolution, opacity },
  };
}

function estimateStats(geometry: ProceduralGeometry): MeshEntity['stats'] {
  if (geometry.type === 'fanStage') {
    return { points: geometry.bladeCount * 14, cells: geometry.bladeCount * 8, triangles: geometry.bladeCount * 8 };
  }
  if (geometry.type === 'box') return { points: 24, cells: 6, triangles: 12 };
  if (geometry.type === 'sphere') {
    const points = geometry.thetaResolution * geometry.phiResolution;
    const triangles = Math.max(0, (geometry.thetaResolution - 1) * (geometry.phiResolution - 1) * 2);
    return { points, cells: triangles, triangles };
  }
  return { points: geometry.resolution * 2, cells: geometry.resolution, triangles: geometry.resolution * 2 };
}
