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
type PickSubscription = { unsubscribe: () => void };

type RuntimeRecord = {
  mesh: MeshEntity;
  actors: VtkActor[];
  mappers: VtkMapper[];
  dataset?: unknown;
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
  resize: () => void;
  onPick: (callback: (meshId: string) => void) => () => void;
  render: () => void;
  loadFile: (file: File) => Promise<LoadedMesh>;
};

export function createVtkRuntime(): VtkRuntime {
  let genericWindow: VtkGenericWindow | undefined;
  let displayMode: DisplayMode = 'surface';
  let pickCallback: ((meshId: string) => void) | undefined;
  let pickSubscription: PickSubscription | undefined;
  const records = new Map<string, RuntimeRecord>();

  const render = () => genericWindow?.getRenderWindow().render();

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
      this.resetView();
    },
    dispose() {
      pickSubscription?.unsubscribe();
      pickSubscription = undefined;
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
          actor.rotateX(axis[0] * angleDeg);
          actor.rotateY(axis[1] * angleDeg);
          actor.rotateZ(axis[2] * angleDeg);
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
      renderer.resetCameraClippingRange();
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
    resize() {
      genericWindow?.resize();
    },
    onPick(callback) {
      pickCallback = callback;
      return () => {
        if (pickCallback === callback) pickCallback = undefined;
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

function configurePicking(
  genericWindow: VtkGenericWindow,
  records: Map<string, RuntimeRecord>,
  callback: (meshId: string) => void,
  setSubscription: (subscription: PickSubscription) => void,
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

function createProceduralRecord(mesh: MeshEntity): RuntimeRecord {
  if (!mesh.geometry) {
    throw new Error(`Mesh ${mesh.name} does not include procedural geometry.`);
  }
  const pieces = actorsForGeometry(mesh.geometry, mesh.color, mesh.opacity);
  pieces.actors.forEach((actor) => {
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
  actor.setPosition(...mesh.transform.position);
  actor.setOrientation(...mesh.transform.rotationDeg);
  actor.setScale(...mesh.transform.scale);
  applyActorStyle(actor, mesh.color, mesh.opacity);
  return { mesh, actors: [actor], mappers: [mapper], dataset };
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
