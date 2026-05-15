import '@kitware/vtk.js/Rendering/Profiles/Geometry';

import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkPicker from '@kitware/vtk.js/Rendering/Core/Picker';
import vtkGenericRenderWindow from '@kitware/vtk.js/Rendering/Misc/GenericRenderWindow';
import vtkCubeSource from '@kitware/vtk.js/Filters/Sources/CubeSource';
import vtkCylinderSource from '@kitware/vtk.js/Filters/Sources/CylinderSource';
import vtkConeSource from '@kitware/vtk.js/Filters/Sources/ConeSource';
import vtkSphereSource from '@kitware/vtk.js/Filters/Sources/SphereSource';
import vtkPlane from '@kitware/vtk.js/Common/DataModel/Plane';
import vtkSTLReader from '@kitware/vtk.js/IO/Geometry/STLReader';
import vtkPLYReader from '@kitware/vtk.js/IO/Geometry/PLYReader';
import vtkOBJReader from '@kitware/vtk.js/IO/Misc/OBJReader';
import vtkXMLPolyDataReader from '@kitware/vtk.js/IO/XML/XMLPolyDataReader';
import type { DisplayMode, MeshEntity, ProceduralGeometry, Vec3, VisualClip } from '../domain/actions';

type VtkActor = ReturnType<typeof vtkActor.newInstance>;
type VtkMapper = ReturnType<typeof vtkMapper.newInstance>;
type VtkGenericWindow = ReturnType<typeof vtkGenericRenderWindow.newInstance>;
type VtkRenderer = ReturnType<VtkGenericWindow['getRenderer']>;
type VtkCamera = ReturnType<ReturnType<VtkGenericWindow['getRenderer']>['getActiveCamera']>;
type RuntimeSubscription = { unsubscribe: () => void };
type ProjectingRenderWindow = {
  getFramebufferSize: () => number[];
  worldToDisplay: (xCoordinate: number, yCoordinate: number, zCoordinate: number, renderer: VtkRenderer) => number[];
};
type ViewportGuideInteractor = {
  onAnimation?: (callback: () => void) => RuntimeSubscription;
  onEndAnimation?: (callback: () => void) => RuntimeSubscription;
};

type RuntimeRecord = {
  mesh: MeshEntity;
  actors: VtkActor[];
  mappers: VtkMapper[];
  dataset?: unknown;
};

export type ViewportGuidePoint = { x: number; y: number };

export type ViewportGuideSnapshot = {
  viewport: { width: number; height: number };
  origin: ViewportGuidePoint;
  axes: Record<'x' | 'y' | 'z', ViewportGuidePoint>;
  triad: Record<'x' | 'y' | 'z', ViewportGuidePoint>;
  gridLines: Array<{ id: string; axis: 'x' | 'y'; from: ViewportGuidePoint; to: ViewportGuidePoint }>;
};

export type LoadedMesh = {
  mesh: MeshEntity;
  dataset: unknown;
};

export type VtkRuntime = {
  mount: (container: HTMLElement) => void;
  dispose: () => void;
  addMesh: (mesh: MeshEntity, dataset?: unknown) => void;
  clear: () => void;
  rotateMesh: (meshId: string, axis: 'x' | 'y' | 'z' | Vec3, angleDeg: number) => void;
  setMeshScale: (meshId: string, scale: Vec3) => void;
  cloneMesh: (sourceId: string, clone: MeshEntity) => void;
  previewClip: (meshId: string, clip: VisualClip) => void;
  clearClip: (meshId: string) => void;
  resetView: (orientation?: 'isometric' | 'front' | 'top' | 'right') => void;
  selectMeshes: (meshIds: string[]) => void;
  setMeshVisibility: (meshId: string, visible: boolean) => void;
  setDisplayMode: (mode: DisplayMode) => void;
  screenDragRotation: (deltaX: number, deltaY: number) => { axis: Vec3; angleDeg: number } | undefined;
  setViewScale: (scale: number) => void;
  resize: () => void;
  onPick: (callback: (meshId: string) => void) => () => void;
  getViewportGuides: () => ViewportGuideSnapshot | null;
  onViewportGuidesChange: (callback: () => void) => () => void;
  render: () => void;
  loadFile: (file: File) => Promise<LoadedMesh>;
};

export function createVtkRuntime(): VtkRuntime {
  let genericWindow: VtkGenericWindow | undefined;
  let displayMode: DisplayMode = 'surface';
  let viewScale = 1;
  let viewportHeight: number | undefined;
  let pickCallback: ((meshId: string) => void) | undefined;
  let pickSubscription: RuntimeSubscription | undefined;
  let guideUpdateFrame: number | undefined;
  let guideSubscriptions: RuntimeSubscription[] = [];
  const records = new Map<string, RuntimeRecord>();
  const guideCallbacks = new Set<() => void>();

  const emitViewportGuideChange = () => {
    guideUpdateFrame = undefined;
    guideCallbacks.forEach((callback) => callback());
  };

  const requestViewportGuideChange = () => {
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      emitViewportGuideChange();
      return;
    }
    if (guideUpdateFrame !== undefined) return;
    guideUpdateFrame = window.requestAnimationFrame(emitViewportGuideChange);
  };

  const render = () => {
    genericWindow?.getRenderWindow().render();
    requestViewportGuideChange();
  };

  return {
    mount(container) {
      if (genericWindow) return;
      genericWindow = vtkGenericRenderWindow.newInstance({ background: [0.055, 0.07, 0.09], listenWindowResize: true });
      genericWindow.setContainer(container);
      genericWindow.resize();
      genericWindow.getInteractor().setDesiredUpdateRate(30);
      records.forEach((record) => record.actors.forEach((actor) => genericWindow?.getRenderer().addActor(actor)));
      configurePicking(genericWindow, records, (meshId) => pickCallback?.(meshId), (subscription) => {
        pickSubscription = subscription;
      });
      guideSubscriptions = subscribeViewportGuideUpdates(genericWindow, requestViewportGuideChange);
      this.resetView();
    },
    dispose() {
      pickSubscription?.unsubscribe();
      pickSubscription = undefined;
      guideSubscriptions.forEach((subscription) => subscription.unsubscribe());
      guideSubscriptions = [];
      if (guideUpdateFrame !== undefined && typeof window !== 'undefined') {
        window.cancelAnimationFrame(guideUpdateFrame);
        guideUpdateFrame = undefined;
      }
      genericWindow?.delete();
      genericWindow = undefined;
    },
    addMesh(mesh, dataset) {
      const record = dataset ? createDatasetRecord(mesh, dataset) : createProceduralRecord(mesh);
      records.set(mesh.id, record);
      record.actors.forEach((actor) => genericWindow?.getRenderer().addActor(actor));
      this.setDisplayMode(displayMode);
      this.setMeshVisibility(mesh.id, mesh.visible);
      if (mesh.clipping) this.previewClip(mesh.id, mesh.clipping);
      this.selectMeshes(mesh.selected ? [mesh.id] : []);
      this.resetView();
    },
    clear() {
      const renderer = genericWindow?.getRenderer();
      records.forEach((record) => record.actors.forEach((actor) => renderer?.removeActor(actor)));
      records.clear();
      render();
    },
    rotateMesh(meshId, axis, angleDeg) {
      const record = records.get(meshId);
      if (!record) return;
      record.actors.forEach((actor) => {
        if (Array.isArray(axis)) {
          actor.rotateWXYZ(angleDeg, axis[0], axis[1], axis[2]);
          return;
        }
        if (axis === 'x') actor.rotateX(angleDeg);
        if (axis === 'y') actor.rotateY(angleDeg);
        if (axis === 'z') actor.rotateZ(angleDeg);
      });
      render();
    },
    setMeshScale(meshId, scale) {
      const record = records.get(meshId);
      if (!record) return;
      record.actors.forEach((actor) => actor.setScale(...scale));
      record.mesh = {
        ...record.mesh,
        transform: { ...record.mesh.transform, scale: [...scale] },
      };
      render();
    },
    cloneMesh(sourceId, clone) {
      const source = records.get(sourceId);
      if (clone.geometry) {
        this.addMesh(clone);
        return;
      }
      if (source?.dataset) {
        this.addMesh(clone, source.dataset);
        return;
      }
      if (source?.mesh.geometry) {
        this.addMesh({ ...clone, geometry: source.mesh.geometry });
      }
    },
    previewClip(meshId, planeDefinition) {
      const record = records.get(meshId);
      if (!record) return;
      record.mappers.forEach((mapper) => {
        mapper.removeAllClippingPlanes();
        const plane = vtkPlane.newInstance({ origin: planeDefinition.plane.origin, normal: planeDefinition.plane.normal });
        mapper.addClippingPlane(plane);
      });
      render();
    },
    clearClip(meshId) {
      const record = records.get(meshId);
      if (!record) return;
      record.mappers.forEach((mapper) => mapper.removeAllClippingPlanes());
      render();
    },
    resetView(orientation = 'isometric') {
      const renderer = genericWindow?.getRenderer();
      if (!renderer) return;
      const camera = renderer.getActiveCamera();
      if (orientation === 'front') {
        camera.setPosition(-180, 0, 0);
        camera.setViewUp(0, 0, 1);
      } else if (orientation === 'top') {
        camera.setPosition(0, 0, 180);
        camera.setViewUp(0, 1, 0);
      } else if (orientation === 'right') {
        camera.setPosition(0, -180, 0);
        camera.setViewUp(0, 0, 1);
      } else {
        camera.setPosition(120, -140, 90);
        camera.setViewUp(0, 0, 1);
      }
      camera.setFocalPoint(0, 0, 0);
      renderer.resetCamera();
      applyViewScale(camera, viewScale);
      renderer.resetCameraClippingRange();
      viewportHeight = currentViewportHeight(genericWindow);
      render();
    },
    selectMeshes(meshIds) {
      records.forEach((record, meshId) => {
        const selected = meshIds.includes(meshId);
        record.actors.forEach((actor) => {
          actor.getProperty().setEdgeVisibility(selected);
          actor.getProperty().setLineWidth(selected ? 2.5 : 1);
          actor.getProperty().setAmbient(selected ? 0.42 : 0.25);
        });
      });
      render();
    },
    setMeshVisibility(meshId, visible) {
      const record = records.get(meshId);
      if (!record) return;
      record.actors.forEach((actor) => actor.setVisibility(visible));
      render();
    },
    setDisplayMode(mode) {
      displayMode = mode;
      records.forEach((record) => {
        record.actors.forEach((actor) => {
          const property = actor.getProperty();
          if (mode === 'wireframe') property.setRepresentationToWireframe();
          else if (mode === 'points') property.setRepresentationToPoints();
          else property.setRepresentationToSurface();
        });
      });
      render();
    },
    screenDragRotation(deltaX, deltaY) {
      const renderer = genericWindow?.getRenderer();
      if (!renderer) return undefined;
      const camera = renderer.getActiveCamera();
      const up = normalizeVec3(camera.getViewUp());
      const forward = normalizeVec3(camera.getDirectionOfProjection());
      const right = normalizeVec3(crossVec3(forward, up));
      const rotationVector = addVec3Local(scaleVec3(up, deltaX), scaleVec3(right, deltaY));
      const dragLength = Math.hypot(rotationVector[0], rotationVector[1], rotationVector[2]);
      if (dragLength < 0.1) return undefined;
      return {
        axis: scaleVec3(rotationVector, 1 / dragLength),
        angleDeg: Math.min(18, dragLength * 0.28),
      };
    },
    setViewScale(scale) {
      viewScale = clampViewScale(scale);
      const renderer = genericWindow?.getRenderer();
      if (!renderer) return;
      renderer.resetCamera();
      applyViewScale(renderer.getActiveCamera(), viewScale);
      renderer.resetCameraClippingRange();
      viewportHeight = currentViewportHeight(genericWindow);
      render();
    },
    resize() {
      const previousHeight = viewportHeight;
      genericWindow?.resize();
      const nextHeight = currentViewportHeight(genericWindow);
      if (previousHeight && nextHeight && previousHeight !== nextHeight) {
        preserveVerticalObjectScale(genericWindow?.getRenderer().getActiveCamera(), nextHeight / previousHeight);
      }
      viewportHeight = nextHeight;
      genericWindow?.getRenderer().resetCameraClippingRange();
      render();
    },
    onPick(callback) {
      pickCallback = callback;
      return () => {
        if (pickCallback === callback) pickCallback = undefined;
      };
    },
    getViewportGuides() {
      return createViewportGuideSnapshot(genericWindow, records);
    },
    onViewportGuidesChange(callback) {
      guideCallbacks.add(callback);
      return () => {
        guideCallbacks.delete(callback);
      };
    },
    render,
    async loadFile(file) {
      const extension = file.name.split('.').pop()?.toLowerCase();
      const reader = readerForExtension(extension);
      if (!reader) {
        throw new Error(`暂不支持 .${extension ?? 'unknown'} 文件，请使用 STL/OBJ/PLY/VTP。`);
      }
      const dataset = await parseFile(file, extension, reader);
      const bounds = safeBounds(dataset);
      const mesh: MeshEntity = {
        id: `mesh-${Date.now().toString(36)}`,
        name: file.name.replace(/\.[^.]+$/, ''),
        sourceFormat: extension as MeshEntity['sourceFormat'],
        visible: true,
        locked: false,
        selected: true,
        color: '#4fb3ff',
        opacity: 1,
        bounds,
        stats: datasetStats(dataset),
        transform: { position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
      };
      return { mesh, dataset };
    },
  };
}

function clampViewScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(4, Math.max(0.2, scale));
}

function applyViewScale(camera: { zoom: (factor: number) => void }, scale: number): void {
  camera.zoom(clampViewScale(scale));
}

function currentViewportHeight(genericWindow: VtkGenericWindow | undefined): number | undefined {
  const height = genericWindow?.getContainer()?.getBoundingClientRect().height;
  return height && height > 0 ? height : undefined;
}

function preserveVerticalObjectScale(camera: VtkCamera | undefined, heightRatio: number): void {
  if (!camera || !Number.isFinite(heightRatio) || heightRatio <= 0 || heightRatio === 1) return;
  if (camera.getParallelProjection()) {
    camera.setParallelScale(camera.getParallelScale() * heightRatio);
    return;
  }
  const halfAngle = (camera.getViewAngle() * Math.PI) / 360;
  const nextAngle = (Math.atan(Math.tan(halfAngle) * heightRatio) * 360) / Math.PI;
  camera.setViewAngle(nextAngle);
}

function configurePicking(
  genericWindow: VtkGenericWindow,
  records: Map<string, RuntimeRecord>,
  callback: (meshId: string) => void,
  setSubscription: (subscription: RuntimeSubscription) => void,
): void {
  const interactor = genericWindow.getInteractor();
  const renderer = genericWindow.getRenderer();
  const picker = vtkPicker.newInstance();
  picker.setPickFromList(true);
  const subscription = interactor.onLeftButtonRelease((event: { position: { x: number; y: number; z?: number } }) => {
    picker.initializePickList();
    const actorToMesh = new Map<VtkActor, string>();
    records.forEach((record, meshId) => {
      record.actors.forEach((actor) => {
        actorToMesh.set(actor, meshId);
        picker.addPickList(actor);
      });
    });
    picker.pick([event.position.x, event.position.y, event.position.z ?? 0], renderer);
    const picked = picker.getActors().find((actor) => actorToMesh.has(actor));
    const meshId = picked ? actorToMesh.get(picked) : undefined;
    if (meshId) callback(meshId);
  });
  setSubscription(subscription);
}

function subscribeViewportGuideUpdates(genericWindow: VtkGenericWindow, callback: () => void): RuntimeSubscription[] {
  const renderer = genericWindow.getRenderer();
  const camera = renderer.getActiveCamera();
  const interactor = genericWindow.getInteractor() as unknown as ViewportGuideInteractor;
  const subscriptions: RuntimeSubscription[] = [camera.onModified(callback)];
  const animationSubscription = interactor.onAnimation?.(callback);
  const endAnimationSubscription = interactor.onEndAnimation?.(callback);
  if (animationSubscription) subscriptions.push(animationSubscription);
  if (endAnimationSubscription) subscriptions.push(endAnimationSubscription);
  return subscriptions;
}

function createViewportGuideSnapshot(genericWindow: VtkGenericWindow | undefined, records: Map<string, RuntimeRecord>): ViewportGuideSnapshot | null {
  if (!genericWindow) return null;
  const container = genericWindow.getContainer();
  const bounds = container?.getBoundingClientRect();
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;

  const renderer = genericWindow.getRenderer();
  const renderWindow = genericWindow.getApiSpecificRenderWindow() as unknown as ProjectingRenderWindow;
  const framebufferSize = renderWindow.getFramebufferSize();
  const framebufferWidth = framebufferSize[0];
  const framebufferHeight = framebufferSize[1];
  if (!framebufferWidth || !framebufferHeight) return null;

  const project = (point: Vec3): ViewportGuidePoint | null => {
    const displayPoint = renderWindow.worldToDisplay(point[0], point[1], point[2], renderer);
    if (!displayPoint.every(Number.isFinite)) return null;
    return {
      x: roundPixel((displayPoint[0] / framebufferWidth) * bounds.width),
      y: roundPixel(bounds.height - (displayPoint[1] / framebufferHeight) * bounds.height),
    };
  };

  const step = viewportGuideStep(records);
  const limit = step * 4;
  const axisLength = step * 3;
  const origin = project([0, 0, 0]);
  const xAxis = project([axisLength, 0, 0]);
  const yAxis = project([0, axisLength, 0]);
  const zAxis = project([0, 0, axisLength]);
  if (!origin || !xAxis || !yAxis || !zAxis) return null;

  const gridLines: ViewportGuideSnapshot['gridLines'] = [];
  for (let gridIndex = -4; gridIndex <= 4; gridIndex += 1) {
    const coordinate = gridIndex * step;
    const xLineStart = project([-limit, coordinate, 0]);
    const xLineEnd = project([limit, coordinate, 0]);
    const yLineStart = project([coordinate, -limit, 0]);
    const yLineEnd = project([coordinate, limit, 0]);
    if (xLineStart && xLineEnd) gridLines.push({ id: `x-${gridIndex}`, axis: 'x', from: xLineStart, to: xLineEnd });
    if (yLineStart && yLineEnd) gridLines.push({ id: `y-${gridIndex}`, axis: 'y', from: yLineStart, to: yLineEnd });
  }

  return {
    viewport: { width: roundPixel(bounds.width), height: roundPixel(bounds.height) },
    origin,
    axes: { x: xAxis, y: yAxis, z: zAxis },
    triad: {
      x: guideDirection(origin, xAxis, [1, -0.15]),
      y: guideDirection(origin, yAxis, [-0.72, -0.68]),
      z: guideDirection(origin, zAxis, [0.2, -0.98]),
    },
    gridLines,
  };
}

function viewportGuideStep(records: Map<string, RuntimeRecord>): number {
  let maximumExtent = 40;
  records.forEach((record) => {
    const position = record.mesh.transform.position;
    record.mesh.bounds.forEach((bound, boundIndex) => {
      const axisIndex = Math.floor(boundIndex / 2) as 0 | 1 | 2;
      maximumExtent = Math.max(maximumExtent, Math.abs(bound + position[axisIndex]));
    });
  });
  return niceGuideStep(maximumExtent / 4);
}

function niceGuideStep(rawStep: number): number {
  if (!Number.isFinite(rawStep) || rawStep <= 0) return 10;
  const exponent = Math.floor(Math.log10(rawStep));
  const base = 10 ** exponent;
  const normalized = rawStep / base;
  if (normalized <= 1) return base;
  if (normalized <= 2) return 2 * base;
  if (normalized <= 5) return 5 * base;
  return 10 * base;
}

function guideDirection(origin: ViewportGuidePoint, endpoint: ViewportGuidePoint, fallback: [number, number]): ViewportGuidePoint {
  const deltaX = endpoint.x - origin.x;
  const deltaY = endpoint.y - origin.y;
  const length = Math.hypot(deltaX, deltaY);
  if (!Number.isFinite(length) || length < 0.001) return { x: fallback[0], y: fallback[1] };
  return { x: roundPixel(deltaX / length), y: roundPixel(deltaY / length) };
}

function roundPixel(value: number): number {
  return Math.round(value * 100) / 100;
}

function createProceduralRecord(mesh: MeshEntity): RuntimeRecord {
  if (!mesh.geometry) {
    throw new Error(`Mesh ${mesh.name} does not include procedural geometry.`);
  }
  const pieces = actorsForGeometry(mesh.geometry, mesh.color, mesh.opacity);
  pieces.actors.forEach((actor) => {
    actor.setOrigin(...boundsCenter(mesh.bounds));
    actor.setPosition(...mesh.transform.position);
    actor.setOrientation(...mesh.transform.rotationDeg);
    actor.setScale(...mesh.transform.scale);
  });
  return { mesh, actors: pieces.actors, mappers: pieces.mappers };
}

function createDatasetRecord(mesh: MeshEntity, dataset: unknown): RuntimeRecord {
  const mapper = vtkMapper.newInstance();
  mapper.setInputData(dataset as never);
  const actor = vtkActor.newInstance();
  actor.setMapper(mapper);
  actor.setOrigin(...boundsCenter(mesh.bounds));
  actor.setPosition(...mesh.transform.position);
  actor.setOrientation(...mesh.transform.rotationDeg);
  actor.setScale(...mesh.transform.scale);
  applyActorStyle(actor, mesh.color, mesh.opacity);
  return { mesh, actors: [actor], mappers: [mapper], dataset };
}

function boundsCenter(bounds: MeshEntity['bounds']): Vec3 {
  return [
    (bounds[0] + bounds[1]) / 2,
    (bounds[2] + bounds[3]) / 2,
    (bounds[4] + bounds[5]) / 2,
  ];
}

function addVec3Local(left: Vec3, right: Vec3): Vec3 {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function scaleVec3(vector: Vec3, factor: number): Vec3 {
  return [vector[0] * factor, vector[1] * factor, vector[2] * factor];
}

function crossVec3(left: Vec3, right: Vec3): Vec3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function normalizeVec3(vector: number[]): Vec3 {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (!Number.isFinite(length) || length === 0) return [1, 0, 0];
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function actorsForGeometry(geometry: ProceduralGeometry, color: string, opacity: number): { actors: VtkActor[]; mappers: VtkMapper[] } {
  if (geometry.type === 'fanStage') {
    const actors: VtkActor[] = [];
    const mappers: VtkMapper[] = [];
    for (let index = 0; index < geometry.bladeCount; index += 1) {
      const angle = (Math.PI * 2 * index) / geometry.bladeCount;
      const y = Math.cos(angle) * (geometry.radius + geometry.bladeLength / 2);
      const z = Math.sin(angle) * (geometry.radius + geometry.bladeLength / 2);
      const source = vtkConeSource.newInstance({
        height: geometry.bladeLength,
        radius: geometry.bladeRadius,
        resolution: 4,
        center: [geometry.x, y, z],
        direction: [0, Math.cos(angle + 0.3), Math.sin(angle + 0.3)],
        capping: true,
      });
      const { actor, mapper } = actorFromSource(source.getOutputData(), color, opacity);
      actor.rotateX(12);
      actors.push(actor);
      mappers.push(mapper);
    }
    return { actors, mappers };
  }

  if (geometry.type === 'box') {
    const source = vtkCubeSource.newInstance({
      center: geometry.center,
      xLength: geometry.size[0],
      yLength: geometry.size[1],
      zLength: geometry.size[2],
      rotations: geometry.rotationDeg ?? [0, 0, 0],
    });
    const { actor, mapper } = actorFromSource(source.getOutputData(), color, geometry.opacity ?? opacity);
    return { actors: [actor], mappers: [mapper] };
  }

  if (geometry.type === 'sphere') {
    const source = vtkSphereSource.newInstance({
      radius: geometry.radius,
      center: geometry.center,
      thetaResolution: geometry.thetaResolution,
      phiResolution: geometry.phiResolution,
    });
    const { actor, mapper } = actorFromSource(source.getOutputData(), color, geometry.opacity ?? opacity);
    return { actors: [actor], mappers: [mapper] };
  }

  const source = geometry.type === 'cylinder'
    ? vtkCylinderSource.newInstance({
        radius: geometry.radius,
        height: geometry.height,
        center: geometry.center,
        direction: geometry.direction,
        resolution: geometry.resolution,
        capping: true,
      })
    : vtkConeSource.newInstance({
        radius: geometry.radius,
        height: geometry.height,
        center: geometry.center,
        direction: geometry.direction,
        resolution: geometry.resolution,
        capping: true,
      });
  const { actor, mapper } = actorFromSource(source.getOutputData(), color, geometry.opacity ?? opacity);
  return { actors: [actor], mappers: [mapper] };
}

function actorFromSource(dataset: unknown, color: string, opacity: number): { actor: VtkActor; mapper: VtkMapper } {
  const mapper = vtkMapper.newInstance();
  mapper.setInputData(dataset as never);
  const actor = vtkActor.newInstance();
  actor.setMapper(mapper);
  applyActorStyle(actor, color, opacity);
  return { actor, mapper };
}

function applyActorStyle(actor: VtkActor, color: string, opacity: number): void {
  const [red, green, blue] = hexToRgb(color);
  const property = actor.getProperty();
  property.setColor(red, green, blue);
  property.setOpacity(opacity);
  property.setEdgeVisibility(false);
  property.setAmbient(0.25);
  property.setDiffuse(0.72);
  property.setSpecular(0.35);
  property.setSpecularPower(22);
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '');
  const numeric = Number.parseInt(normalized, 16);
  return [((numeric >> 16) & 255) / 255, ((numeric >> 8) & 255) / 255, (numeric & 255) / 255];
}

function readerForExtension(extension?: string) {
  if (extension === 'stl') return vtkSTLReader.newInstance();
  if (extension === 'ply') return vtkPLYReader.newInstance();
  if (extension === 'obj') return vtkOBJReader.newInstance();
  if (extension === 'vtp') return vtkXMLPolyDataReader.newInstance();
  return undefined;
}

async function parseFile(file: File, extension: string | undefined, reader: ReturnType<typeof readerForExtension>): Promise<unknown> {
  if (!reader) throw new Error('缺少文件 reader。');
  if (extension === 'obj') {
    reader.parseAsText(await file.text());
  } else {
    (reader as { parseAsArrayBuffer: (content: ArrayBuffer) => void }).parseAsArrayBuffer(await file.arrayBuffer());
  }
  return reader.getOutputData(0);
}

function safeBounds(dataset: unknown): MeshEntity['bounds'] {
  const bounds = (dataset as { getBounds?: () => number[] }).getBounds?.() ?? [-1, 1, -1, 1, -1, 1];
  return [bounds[0], bounds[1], bounds[2], bounds[3], bounds[4], bounds[5]];
}

function datasetStats(dataset: unknown): MeshEntity['stats'] {
  const points = (dataset as { getPoints?: () => { getNumberOfPoints?: () => number } }).getPoints?.().getNumberOfPoints?.() ?? 0;
  const cells = (dataset as { getPolys?: () => { getNumberOfCells?: () => number } }).getPolys?.().getNumberOfCells?.() ?? 0;
  return { points, cells, triangles: cells };
}
