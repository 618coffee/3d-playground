import type {
  DisplayMode,
  MeshEntity,
  MeshSourceFormat,
  MeshTarget,
  OperationCommand,
  Vec3,
  VisualClip,
} from './actions';
import type { ActionRisk, AgentPlanStep, AgentResponse } from './protocol';

type ValidationSuccess<T> = { ok: true; value: T };
type ValidationFailure = { ok: false; error: string };
export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

const commandTypes = [
  'selectMesh',
  'rotateMesh',
  'moveMesh',
  'cloneMesh',
  'deleteMesh',
  'setMeshScale',
  'clipMesh',
  'resetView',
  'setMeshVisibility',
  'setMeshLocked',
  'setDisplayMode',
  'importMesh',
] as const;

const meshSourceFormats: MeshSourceFormat[] = ['procedural', 'stl', 'obj', 'ply', 'vtp', 'vtu', 'vtk'];
const displayModes: DisplayMode[] = ['surface', 'wireframe', 'points'];

export function validateOperationCommand(value: unknown): ValidationResult<OperationCommand> {
  if (!isRecord(value)) return fail('Command must be an object.');
  if (!isNonEmptyString(value.id)) return fail('Command id is required.');
  if (value.source !== 'ui' && value.source !== 'agent') return fail('Command source must be ui or agent.');
  if (value.rawText !== undefined && typeof value.rawText !== 'string') return fail('Command rawText must be a string.');
  if (value.confirmed !== undefined && typeof value.confirmed !== 'boolean') return fail('Command confirmed must be boolean.');
  if (!isOneOf(value.type, commandTypes)) return fail('Unsupported command type.');

  if (value.type === 'resetView') {
    if (!isViewerTarget(value.target)) return fail('resetView target must be viewer.');
    if (!isRecord(value.params)) return fail('resetView params are required.');
    if (value.params.fit !== 'visible' && value.params.fit !== 'selection') return fail('resetView fit is invalid.');
    if (!isOneOf(value.params.orientation, ['isometric', 'front', 'top', 'right'] as const)) return fail('resetView orientation is invalid.');
    return ok(value as OperationCommand);
  }

  if (value.type === 'setDisplayMode') {
    if (!isViewerTarget(value.target)) return fail('setDisplayMode target must be viewer.');
    if (!isRecord(value.params) || !isOneOf(value.params.mode, displayModes)) return fail('Display mode is invalid.');
    return ok(value as OperationCommand);
  }

  if (value.type === 'importMesh') {
    if (!isSceneTarget(value.target)) return fail('importMesh target must be scene.');
    if (!isRecord(value.params) || !isMeshEntity(value.params.mesh)) return fail('importMesh mesh is invalid.');
    return ok(value as OperationCommand);
  }

  if (!isMeshTarget(value.target)) return fail('Mesh command target is invalid.');
  if (!isRecord(value.params)) return fail('Command params are required.');

  if (value.type === 'selectMesh') {
    return isOneOf(value.params.mode, ['replace', 'add', 'remove'] as const) ? ok(value as OperationCommand) : fail('Selection mode is invalid.');
  }

  if (value.type === 'rotateMesh') {
    if (!isAxis(value.params.axis)) return fail('Rotation axis is invalid.');
    if (!Number.isFinite(value.params.angleDeg)) return fail('Rotation angle is invalid.');
    if (!isPivot(value.params.pivot)) return fail('Rotation pivot is invalid.');
    if (value.params.space !== 'world' && value.params.space !== 'local') return fail('Rotation space is invalid.');
    return ok(value as OperationCommand);
  }

  if (value.type === 'moveMesh') {
    if (!isVec3(value.params.offset)) return fail('Move offset is invalid.');
    if (!isOneOf(value.params.unit, ['mm', 'cm', 'm', 'model'] as const)) return fail('Move unit is invalid.');
    return ok(value as OperationCommand);
  }

  if (value.type === 'cloneMesh') {
    if (!Number.isFinite(value.params.count)) return fail('Clone count is invalid.');
    if (!isVec3(value.params.offset)) return fail('Clone offset is invalid.');
    if (!isOneOf(value.params.unit, ['mm', 'cm', 'm', 'model'] as const)) return fail('Clone unit is invalid.');
    if (typeof value.params.shareGeometry !== 'boolean') return fail('Clone shareGeometry must be boolean.');
    if (!isNonEmptyString(value.params.namePattern)) return fail('Clone namePattern is required.');
    return ok(value as OperationCommand);
  }

  if (value.type === 'deleteMesh') {
    return ok(value as OperationCommand);
  }

  if (value.type === 'setMeshScale') {
    return isVec3(value.params.scale) ? ok(value as OperationCommand) : fail('Scale vector is invalid.');
  }

  if (value.type === 'clipMesh') {
    if (!isClipPlane(value.params.plane)) return fail('Clip plane is invalid.');
    if (value.params.keepSide !== 'positive' && value.params.keepSide !== 'negative') return fail('Clip keepSide is invalid.');
    if (!isOneOf(value.params.mode, ['preview', 'applyVisualClip', 'clearVisualClip', 'bakeGeometry'] as const)) return fail('Clip mode is invalid.');
    if (typeof value.params.cap !== 'boolean') return fail('Clip cap must be boolean.');
    return ok(value as OperationCommand);
  }

  if (value.type === 'setMeshVisibility') {
    return typeof value.params.visible === 'boolean' ? ok(value as OperationCommand) : fail('Visibility value must be boolean.');
  }

  if (value.type === 'setMeshLocked') {
    return typeof value.params.locked === 'boolean' ? ok(value as OperationCommand) : fail('Locked value must be boolean.');
  }

  return fail('Unsupported command type.');
}

export function isOperationCommand(value: unknown): value is OperationCommand {
  return validateOperationCommand(value).ok;
}

export function validateAgentResponse(value: unknown): ValidationResult<AgentResponse> {
  if (!isRecord(value)) return fail('Agent response must be an object.');

  if (value.kind === 'message') {
    return typeof value.text === 'string' ? ok(value as AgentResponse) : fail('Agent message text must be a string.');
  }

  if (value.kind === 'clarification') {
    if (typeof value.question !== 'string') return fail('Clarification question is required.');
    if (!isStringArray(value.suggestions)) return fail('Clarification suggestions must be strings.');
    return ok(value as AgentResponse);
  }

  if (value.kind === 'actionDraft') {
    const command = validateOperationCommand(value.action);
    if (!command.ok) return fail(`Action draft command invalid: ${command.error}`);
    if (typeof value.explanation !== 'string') return fail('Action draft explanation is required.');
    if (!isUnitConfidence(value.confidence)) return fail('Action draft confidence must be between 0 and 1.');
    if (!isActionRisk(value.risk)) return fail('Action draft risk is invalid.');
    return ok({ ...value, action: command.value } as AgentResponse);
  }

  if (value.kind === 'actionPlan') {
    if (!Array.isArray(value.steps) || value.steps.length === 0) return fail('Action plan requires at least one step.');
    const steps: AgentPlanStep[] = [];
    for (const step of value.steps) {
      const validated = validateAgentPlanStep(step);
      if (!validated.ok) return fail(validated.error);
      steps.push(validated.value);
    }
    if (typeof value.explanation !== 'string') return fail('Action plan explanation is required.');
    if (!isActionRisk(value.risk)) return fail('Action plan risk is invalid.');
    return ok({ ...value, steps } as AgentResponse);
  }

  if (value.kind === 'sceneAnswer') {
    if (typeof value.answer !== 'string') return fail('Scene answer is required.');
    if (!isStringArray(value.referencedMeshIds)) return fail('Scene answer referencedMeshIds must be strings.');
    return ok(value as AgentResponse);
  }

  if (value.kind === 'macroDraft') {
    if (!isNonEmptyString(value.name)) return fail('Macro name is required.');
    if (!Array.isArray(value.steps) || value.steps.length === 0) return fail('Macro requires at least one step.');
    const steps: AgentPlanStep[] = [];
    for (const step of value.steps) {
      const validated = validateAgentPlanStep(step);
      if (!validated.ok) return fail(validated.error);
      steps.push(validated.value);
    }
    if (typeof value.explanation !== 'string') return fail('Macro explanation is required.');
    if (!isActionRisk(value.risk)) return fail('Macro risk is invalid.');
    return ok({ ...value, steps } as AgentResponse);
  }

  if (value.kind === 'backendJobDraft') {
    if (!isNonEmptyString(value.title)) return fail('Backend job title is required.');
    if (typeof value.description !== 'string') return fail('Backend job description is required.');
    if (!isOneOf(value.jobKind, ['geometryCut', 'meshing', 'solverRun', 'resultSummary'] as const)) return fail('Backend job kind is invalid.');
    if (!isActionRisk(value.risk)) return fail('Backend job risk is invalid.');
    return ok(value as AgentResponse);
  }

  return fail('Unsupported agent response kind.');
}

export function isAgentResponse(value: unknown): value is AgentResponse {
  return validateAgentResponse(value).ok;
}

function validateAgentPlanStep(value: unknown): ValidationResult<AgentPlanStep> {
  if (!isRecord(value)) return fail('Plan step must be an object.');
  if (!isNonEmptyString(value.id)) return fail('Plan step id is required.');
  if (!isNonEmptyString(value.title)) return fail('Plan step title is required.');
  if (value.explanation !== undefined && typeof value.explanation !== 'string') return fail('Plan step explanation must be a string.');
  if (value.risk !== undefined && !isActionRisk(value.risk)) return fail('Plan step risk is invalid.');
  const command = validateOperationCommand(value.action);
  if (!command.ok) return fail(`Plan step command invalid: ${command.error}`);
  return ok({ ...value, action: command.value } as AgentPlanStep);
}

function isMeshTarget(value: unknown): value is MeshTarget {
  if (!isRecord(value)) return false;
  if ('meshId' in value) return isNonEmptyString(value.meshId) && Object.keys(value).length === 1;
  if ('meshIds' in value) return Array.isArray(value.meshIds) && value.meshIds.every(isNonEmptyString);
  if ('source' in value) return value.source === 'selection' || value.source === 'allVisible';
  if ('name' in value) return isNonEmptyString(value.name) && (value.match === 'exact' || value.match === 'fuzzy');
  return false;
}

function isMeshEntity(value: unknown): value is MeshEntity {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id) || !isNonEmptyString(value.name)) return false;
  if (!isOneOf(value.sourceFormat, meshSourceFormats)) return false;
  if (typeof value.visible !== 'boolean' || typeof value.locked !== 'boolean' || typeof value.selected !== 'boolean') return false;
  if (typeof value.color !== 'string' || !Number.isFinite(value.opacity)) return false;
  if (!isBounds(value.bounds)) return false;
  if (!isRecord(value.stats) || !Number.isFinite(value.stats.points) || !Number.isFinite(value.stats.cells)) return false;
  if (value.stats.triangles !== undefined && !Number.isFinite(value.stats.triangles)) return false;
  if (!isRecord(value.transform)) return false;
  if (!isVec3(value.transform.position) || !isVec3(value.transform.rotationDeg) || !isVec3(value.transform.scale)) return false;
  if (value.clipping !== undefined && !isVisualClip(value.clipping)) return false;
  return true;
}

function isActionRisk(value: unknown): value is ActionRisk {
  if (!isRecord(value)) return false;
  if (!isOneOf(value.level, ['low', 'medium', 'high', 'blocked'] as const)) return false;
  return typeof value.summary === 'string'
    && isStringArray(value.warnings)
    && typeof value.requiresConfirmation === 'boolean'
    && typeof value.reversible === 'boolean';
}

function isVisualClip(value: unknown): value is VisualClip {
  if (!isRecord(value)) return false;
  return isClipPlane(value.plane)
    && (value.keepSide === 'positive' || value.keepSide === 'negative')
    && typeof value.cap === 'boolean';
}

function isClipPlane(value: unknown): value is VisualClip['plane'] {
  return isRecord(value) && isVec3(value.origin) && isVec3(value.normal);
}

function isAxis(value: unknown): value is 'x' | 'y' | 'z' | Vec3 {
  return value === 'x' || value === 'y' || value === 'z' || isVec3(value);
}

function isPivot(value: unknown): value is 'boundsCenter' | 'origin' | Vec3 {
  return value === 'boundsCenter' || value === 'origin' || isVec3(value);
}

function isVec3(value: unknown): value is Vec3 {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
}

function isBounds(value: unknown): value is [number, number, number, number, number, number] {
  return Array.isArray(value) && value.length === 6 && value.every(Number.isFinite);
}

function isViewerTarget(value: unknown): boolean {
  return isRecord(value) && value.scope === 'viewer';
}

function isSceneTarget(value: unknown): boolean {
  return isRecord(value) && value.scope === 'scene';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isUnitConfidence(value: unknown): value is number {
  return Number.isFinite(value) && Number(value) >= 0 && Number(value) <= 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isOneOf<T extends readonly unknown[]>(value: unknown, options: T): value is T[number] {
  return options.includes(value);
}

function ok<T>(value: T): ValidationSuccess<T> {
  return { ok: true, value };
}

function fail(error: string): ValidationFailure {
  return { ok: false, error };
}
