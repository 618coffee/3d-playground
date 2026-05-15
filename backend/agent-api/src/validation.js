import { randomUUID } from 'node:crypto';
import { HttpError } from './errors.js';
import { COMMAND_TYPES, DISPLAY_MODES, RISK_LEVELS, UNITS } from './schema.js';

const MAX_TEXT_LENGTH = 8000;
const MAX_HISTORY_ITEMS = 12;
const MAX_PLAN_STEPS = 8;
const MESH_SOURCE_FORMATS = ['procedural', 'stl', 'obj', 'ply', 'vtp', 'vtu', 'vtk'];

export function validateAgentRequest(input) {
  if (!isRecord(input)) {
    throw new HttpError(400, 'invalid_request', 'Request body must be a JSON object.');
  }

  const text = requiredString(input.text, 'text', MAX_TEXT_LENGTH).trim();
  if (!text) {
    throw new HttpError(400, 'invalid_request', 'Request field "text" cannot be empty.');
  }

  const context = isRecord(input.context) ? input.context : undefined;
  const scene = validateScene(input.scene ?? context?.scene);

  return {
    requestId: optionalString(input.requestId, 'requestId', 128) ?? randomUUID(),
    text,
    scene,
    pendingAction: isRecord(input.pendingAction) ? input.pendingAction : undefined,
    conversation: validateConversation(input.conversation ?? input.messages),
  };
}

export function validateAgentResponse(input, request) {
  const response = unwrapResponse(input);
  if (!isRecord(response)) {
    throw new HttpError(502, 'invalid_agent_response', 'Provider returned a non-object response.');
  }

  const kind = enumValue(response.kind, ['message', 'clarification', 'actionDraft', 'actionPlan', 'sceneAnswer', 'macroDraft', 'backendJobDraft'], 'kind');
  if (kind === 'message') {
    return {
      kind,
      text: requiredString(response.text ?? response.message, 'text', 4000),
    };
  }

  if (kind === 'clarification') {
    return {
      kind,
      question: requiredString(response.question, 'question', 1000),
      suggestions: stringList(response.suggestions, 'suggestions', 6),
    };
  }

  if (kind === 'actionDraft') {
    const action = validateOperationCommand(response.action, request);
    return {
      kind,
      action,
      explanation: optionalString(response.explanation, 'explanation', 2000) ?? defaultExplanation(action),
      confidence: normalizedConfidence(response.confidence),
      risk: normalizeActionRisk(response.risk, [action]),
    };
  }

  if (kind === 'sceneAnswer') {
    return {
      kind,
      answer: requiredString(response.answer, 'answer', 4000),
      referencedMeshIds: meshIdList(response.referencedMeshIds, request, 'referencedMeshIds'),
    };
  }

  if (kind === 'backendJobDraft') {
    return {
      kind,
      title: requiredString(response.title, 'title', 300),
      description: requiredString(response.description, 'description', 2000),
      jobKind: enumValue(response.jobKind, ['geometryCut', 'meshing', 'solverRun', 'resultSummary'], 'jobKind'),
      risk: normalizeActionRisk(response.risk, [], { fallbackLevel: 'high', fallbackWarnings: ['需要未来本地后端 worker 执行。'] }),
    };
  }

  const stepsInput = response.steps;
  if (!Array.isArray(stepsInput) || stepsInput.length === 0) {
    throw new HttpError(502, 'invalid_agent_response', `${kind}.steps must contain at least one step.`);
  }
  if (stepsInput.length > MAX_PLAN_STEPS) {
    throw new HttpError(502, 'invalid_agent_response', `actionPlan.steps cannot exceed ${MAX_PLAN_STEPS} steps.`);
  }

  const steps = stepsInput.map((step, index) => validatePlanStep(step, index, request));
  if (kind === 'macroDraft') {
    return {
      kind,
      name: requiredString(response.name, 'name', 160),
      steps,
      explanation: optionalString(response.explanation, 'explanation', 2000) ?? 'Reusable viewer-safe macro draft.',
      risk: normalizeActionRisk(response.risk, steps.map((step) => step.action)),
    };
  }
  return {
    kind,
    steps,
    explanation: optionalString(response.explanation, 'explanation', 2000) ?? 'Planned viewer-safe operations for review.',
    risk: normalizeActionRisk(response.risk, steps.map((step) => step.action)),
  };
}

export function validateOperationCommand(input, request) {
  input = normalizeOperationCommand(input);
  if (!isRecord(input)) {
    throw new HttpError(502, 'invalid_operation_command', 'OperationCommand must be an object.');
  }

  const type = enumValue(input.type, COMMAND_TYPES, 'action.type');
  if (type === 'importMesh') {
    throw new HttpError(502, 'unsupported_operation', 'LLM-generated importMesh commands are not allowed.');
  }

  const common = {
    id: optionalString(input.id, 'action.id', 160) ?? createCommandId(type),
    type,
    source: 'agent',
    rawText: optionalString(input.rawText, 'action.rawText', MAX_TEXT_LENGTH) ?? request.text,
    confirmed: false,
  };

  if (type === 'resetView') {
    return {
      ...common,
      target: validateScopeTarget(input.target, 'viewer', 'action.target'),
      params: {
        fit: enumValue(input.params?.fit, ['visible', 'selection'], 'action.params.fit'),
        orientation: enumValue(input.params?.orientation, ['isometric', 'front', 'top', 'right'], 'action.params.orientation'),
      },
    };
  }

  if (type === 'setDisplayMode') {
    return {
      ...common,
      target: validateScopeTarget(input.target, 'viewer', 'action.target'),
      params: {
        mode: enumValue(input.params?.mode, DISPLAY_MODES, 'action.params.mode'),
      },
    };
  }

  const target = validateMeshTarget(input.target, request, 'action.target');
  if (type === 'selectMesh') {
    return {
      ...common,
      target,
      params: { mode: enumValue(input.params?.mode, ['replace', 'add', 'remove'], 'action.params.mode') },
    };
  }

  if (type === 'rotateMesh') {
    return {
      ...common,
      target,
      params: {
        axis: validateAxis(input.params?.axis, 'action.params.axis'),
        angleDeg: finiteNumber(input.params?.angleDeg, 'action.params.angleDeg'),
        pivot: validatePivot(input.params?.pivot, 'action.params.pivot'),
        space: enumValue(input.params?.space, ['world', 'local'], 'action.params.space'),
      },
    };
  }

  if (type === 'cloneMesh') {
    return {
      ...common,
      target,
      params: {
        count: integerInRange(input.params?.count, 'action.params.count', 1, 12),
        offset: vec3(input.params?.offset, 'action.params.offset'),
        unit: enumValue(input.params?.unit, UNITS, 'action.params.unit'),
        shareGeometry: booleanValue(input.params?.shareGeometry, 'action.params.shareGeometry'),
        namePattern: optionalString(input.params?.namePattern, 'action.params.namePattern', 160) ?? '{name}-copy-{n}',
      },
    };
  }

  if (type === 'setMeshScale') {
    return {
      ...common,
      target,
      params: { scale: vec3(input.params?.scale, 'action.params.scale', { positive: true }) },
    };
  }

  if (type === 'clipMesh') {
    const normal = vec3(input.params?.plane?.normal, 'action.params.plane.normal');
    if (vectorLength(normal) === 0) {
      throw new HttpError(502, 'invalid_operation_command', 'action.params.plane.normal cannot be a zero vector.');
    }
    return {
      ...common,
      target,
      params: {
        plane: {
          origin: vec3(input.params?.plane?.origin, 'action.params.plane.origin'),
          normal,
        },
        keepSide: enumValue(input.params?.keepSide, ['positive', 'negative'], 'action.params.keepSide'),
        mode: enumValue(input.params?.mode, ['preview', 'applyVisualClip', 'clearVisualClip', 'bakeGeometry'], 'action.params.mode'),
        cap: booleanValue(input.params?.cap, 'action.params.cap'),
      },
    };
  }

  if (type === 'setMeshVisibility') {
    return {
      ...common,
      target,
      params: { visible: booleanValue(input.params?.visible, 'action.params.visible') },
    };
  }

  if (type === 'setMeshLocked') {
    return {
      ...common,
      target,
      params: { locked: booleanValue(input.params?.locked, 'action.params.locked') },
    };
  }

  throw new HttpError(502, 'invalid_operation_command', `Unsupported action type: ${type}`);
}

export function deriveActionRisk(command) {
  const backendJobRequired = command.type === 'clipMesh' && command.params.mode === 'bakeGeometry';
  const requiresConfirmation = command.type === 'clipMesh' || (command.type === 'cloneMesh' && command.params.count > 5) || backendJobRequired;
  const level = backendJobRequired || (command.type === 'cloneMesh' && command.params.count > 8)
    ? 'high'
    : requiresConfirmation
      ? 'medium'
      : 'low';

  return {
    level,
    summary: riskSummary(level, command),
    warnings: riskWarnings(command),
    requiresConfirmation,
    reversible: !backendJobRequired,
  };
}

function validatePlanStep(input, index, request) {
  if (!isRecord(input)) {
    throw new HttpError(502, 'invalid_agent_response', `actionPlan.steps[${index}] must be an object.`);
  }
  const action = validateOperationCommand(input.action, request);
  return {
    id: optionalString(input.id, `actionPlan.steps[${index}].id`, 160) ?? `step-${index + 1}`,
    title: optionalString(input.title, `actionPlan.steps[${index}].title`, 160) ?? commandTitle(action),
    action,
    explanation: optionalString(input.explanation, `actionPlan.steps[${index}].explanation`, 2000) ?? defaultExplanation(action),
    risk: normalizeActionRisk(input.risk, [action]),
  };
}

function validateScene(input) {
  if (!isRecord(input)) {
    return { meshes: [], selection: [], unit: 'mm', displayMode: 'surface' };
  }

  const meshes = Array.isArray(input.meshes) ? input.meshes.slice(0, 200).filter(isRecord).map(validateSceneMesh) : [];
  const meshIds = new Set(meshes.map((mesh) => mesh.id));
  const selection = Array.isArray(input.selection)
    ? input.selection.filter((id) => typeof id === 'string' && meshIds.has(id)).slice(0, 200)
    : [];

  return {
    meshes,
    selection,
    unit: UNITS.includes(input.unit) ? input.unit : 'mm',
    displayMode: DISPLAY_MODES.includes(input.displayMode) ? input.displayMode : 'surface',
  };
}

function validateSceneMesh(mesh) {
  return {
    id: requiredString(mesh.id, 'scene.mesh.id', 200),
    name: optionalString(mesh.name, 'scene.mesh.name', 200) ?? mesh.id,
    sourceFormat: MESH_SOURCE_FORMATS.includes(mesh.sourceFormat) ? mesh.sourceFormat : 'procedural',
    visible: typeof mesh.visible === 'boolean' ? mesh.visible : true,
    locked: typeof mesh.locked === 'boolean' ? mesh.locked : false,
    selected: typeof mesh.selected === 'boolean' ? mesh.selected : false,
    bounds: Array.isArray(mesh.bounds) && mesh.bounds.length === 6 ? mesh.bounds.filter(Number.isFinite).slice(0, 6) : undefined,
    stats: isRecord(mesh.stats) ? {
      points: finiteOrDefault(mesh.stats.points, 0),
      cells: finiteOrDefault(mesh.stats.cells, 0),
      ...(Number.isFinite(mesh.stats.triangles) ? { triangles: mesh.stats.triangles } : {}),
    } : undefined,
    transform: isRecord(mesh.transform) ? {
      position: safeVec3(mesh.transform.position, [0, 0, 0]),
      rotationDeg: safeVec3(mesh.transform.rotationDeg, [0, 0, 0]),
      scale: safeVec3(mesh.transform.scale, [1, 1, 1]),
    } : undefined,
    clipping: isRecord(mesh.clipping) ? { present: true } : undefined,
  };
}

function validateConversation(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(-MAX_HISTORY_ITEMS).filter(isRecord).map((item) => ({
    role: enumValue(item.role, ['user', 'assistant', 'system', 'tool'], 'conversation.role'),
    content: requiredString(item.content ?? item.text, 'conversation.content', 4000),
  }));
}

function validateMeshTarget(target, request, path) {
  if (!isRecord(target)) {
    throw new HttpError(502, 'invalid_operation_command', `${path} must be an object.`);
  }

  if (typeof target.meshId === 'string') {
    assertKnownMeshId(target.meshId, request, `${path}.meshId`);
    return { meshId: target.meshId };
  }

  if (Array.isArray(target.meshIds)) {
    const meshIds = [...new Set(target.meshIds.filter((id) => typeof id === 'string' && id.trim()))];
    if (meshIds.length === 0) {
      throw new HttpError(502, 'invalid_operation_command', `${path}.meshIds must include at least one id.`);
    }
    meshIds.forEach((id) => assertKnownMeshId(id, request, `${path}.meshIds`));
    return { meshIds };
  }

  if (target.source !== undefined) {
    return { source: enumValue(target.source, ['selection', 'allVisible'], `${path}.source`) };
  }

  if (typeof target.name === 'string') {
    return {
      name: requiredString(target.name, `${path}.name`, 240),
      match: enumValue(target.match, ['exact', 'fuzzy'], `${path}.match`),
    };
  }

  throw new HttpError(502, 'invalid_operation_command', `${path} must use meshId, meshIds, source, or name.`);
}

function validateScopeTarget(target, expectedScope, path) {
  if (!isRecord(target) || target.scope !== expectedScope) {
    throw new HttpError(502, 'invalid_operation_command', `${path}.scope must be "${expectedScope}".`);
  }
  return { scope: expectedScope };
}

function normalizeActionRisk(input, commands, options = {}) {
  const derived = combineRisks(commands.map(deriveActionRisk));
  if (!isRecord(input)) return derived;

  const level = RISK_LEVELS.includes(input.level) ? input.level : options.fallbackLevel ?? derived.level;
  return {
    level,
    summary: optionalString(input.summary, 'risk.summary', 500) ?? derived.summary,
    warnings: stringList(input.warnings ?? input.reasons, 'risk.warnings', 6, { fallback: derived.warnings.length > 0 ? derived.warnings : options.fallbackWarnings }),
    requiresConfirmation: typeof input.requiresConfirmation === 'boolean' ? input.requiresConfirmation : derived.requiresConfirmation,
    reversible: typeof input.reversible === 'boolean' ? input.reversible : derived.reversible,
  };
}

function combineRisks(risks) {
  if (risks.length === 0) {
    return {
      level: 'low',
      summary: 'Review before execution.',
      warnings: [],
      requiresConfirmation: true,
      reversible: true,
    };
  }
  const highRisk = risks.find((risk) => risk.level === 'high');
  const mediumRisk = risks.find((risk) => risk.level === 'medium');
  const top = highRisk ?? mediumRisk ?? risks[0];
  return {
    level: top.level,
    summary: risks.length > 1 ? 'Review each planned operation before execution.' : top.summary,
    warnings: [...new Set(risks.flatMap((risk) => risk.warnings))],
    requiresConfirmation: risks.some((risk) => risk.requiresConfirmation),
    reversible: risks.every((risk) => risk.reversible),
  };
}

function riskSummary(level, command) {
  if (command.type === 'clipMesh' && command.params.mode === 'bakeGeometry') return 'Requires a future backend geometry job.';
  if (command.type === 'clipMesh') return 'Creates or applies a visual clipping state for review.';
  if (command.type === 'cloneMesh' && command.params.count > 5) return 'May create enough meshes to affect browser responsiveness.';
  return level === 'low' ? 'Viewer-safe draft for local review.' : 'Review before applying.';
}

function riskWarnings(command) {
  if (command.type === 'clipMesh' && command.params.mode === 'bakeGeometry') return ['真实几何切割需要未来本地后端作业，当前不会直接执行。'];
  if (command.type === 'clipMesh') return ['视觉切割需要用户检查预览后确认。'];
  if (command.type === 'cloneMesh' && command.params.count > 5) return ['大量复制可能影响浏览器帧率。'];
  return [];
}

function meshIdList(value, request, path) {
  if (!Array.isArray(value)) return [];
  const ids = [...new Set(value.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim()))].slice(0, 20);
  ids.forEach((id) => assertKnownMeshId(id, request, path));
  return ids;
}

function defaultExplanation(command) {
  if (command.type === 'resetView') return 'Reset the camera view.';
  if (command.type === 'setDisplayMode') return `Switch display mode to ${command.params.mode}.`;
  if (command.type === 'rotateMesh') return `Rotate the target ${command.params.angleDeg} degrees.`;
  if (command.type === 'cloneMesh') return `Clone the target ${command.params.count} time(s).`;
  if (command.type === 'clipMesh') return 'Create a visual clipping draft for review.';
  return `Prepare ${command.type} for review.`;
}

function commandTitle(command) {
  if (command.type === 'resetView') return 'Reset view';
  if (command.type === 'setDisplayMode') return 'Set display mode';
  if (command.type === 'rotateMesh') return 'Rotate mesh';
  if (command.type === 'cloneMesh') return 'Clone mesh';
  if (command.type === 'clipMesh') return 'Preview clip';
  if (command.type === 'selectMesh') return 'Select mesh';
  if (command.type === 'setMeshVisibility') return 'Set visibility';
  if (command.type === 'setMeshLocked') return 'Set lock state';
  return command.type;
}

function unwrapResponse(input) {
  if (isRecord(input) && isRecord(input.response)) return input.response;
  return input;
}

function normalizeOperationCommand(input) {
  if (!isRecord(input) || !isRecord(input.commands)) return input;

  const commandEntries = Object.entries(input.commands).filter(([type]) => COMMAND_TYPES.includes(type));
  if (commandEntries.length !== 1) return input;

  const [type, commandValue] = commandEntries[0];
  const command = isRecord(commandValue) ? commandValue : {};
  const common = isRecord(input.common) ? input.common : {};

  return {
    id: command.id ?? common.id ?? input.id,
    type,
    source: command.source ?? common.source ?? input.source,
    rawText: command.rawText ?? common.rawText ?? input.rawText,
    confirmed: command.confirmed ?? common.confirmed ?? input.confirmed,
    target: normalizeWrappedTarget(command.target ?? input.target),
    params: command.params ?? input.params,
  };
}

function normalizeWrappedTarget(target) {
  return Array.isArray(target) && target.length === 1 ? target[0] : target;
}

function assertKnownMeshId(meshId, request, path) {
  const knownIds = new Set(request.scene.meshes.map((mesh) => mesh.id));
  if (knownIds.size > 0 && !knownIds.has(meshId)) {
    throw new HttpError(502, 'invalid_operation_command', `${path} "${meshId}" is not present in scene context.`);
  }
}

function createCommandId(type) {
  return `${type}-${randomUUID()}`;
}

function enumValue(value, allowed, path) {
  if (allowed.includes(value)) return value;
  throw new HttpError(502, 'invalid_schema_value', `${path} must be one of: ${allowed.join(', ')}.`);
}

function booleanValue(value, path) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  throw new HttpError(502, 'invalid_schema_value', `${path} must be a boolean.`);
}

function finiteNumber(value, path) {
  if (Number.isFinite(value)) return normalizeNumber(value);
  throw new HttpError(502, 'invalid_schema_value', `${path} must be a finite number.`);
}

function integerInRange(value, path, min, max) {
  if (Number.isInteger(value) && value >= min && value <= max) return value;
  throw new HttpError(502, 'invalid_schema_value', `${path} must be an integer from ${min} to ${max}.`);
}

function normalizedConfidence(value) {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, normalizeNumber(value)));
}

function validateAxis(value, path) {
  if (['x', 'y', 'z'].includes(value)) return value;
  const vector = vec3(value, path);
  if (vectorLength(vector) === 0) {
    throw new HttpError(502, 'invalid_schema_value', `${path} cannot be a zero vector.`);
  }
  return vector;
}

function validatePivot(value, path) {
  if (['boundsCenter', 'origin'].includes(value)) return value;
  return vec3(value, path);
}

function vec3(value, path, options = {}) {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new HttpError(502, 'invalid_schema_value', `${path} must be a 3-number array.`);
  }
  const vector = value.map((item) => finiteNumber(item, path));
  if (options.positive && vector.some((item) => item <= 0)) {
    throw new HttpError(502, 'invalid_schema_value', `${path} values must be greater than 0.`);
  }
  return vector;
}

function safeVec3(value, fallback) {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)
    ? value.map(normalizeNumber)
    : fallback;
}

function stringList(value, path, max, options = {}) {
  if (!Array.isArray(value)) return options.fallback ?? [];
  return value
    .filter((item) => typeof item === 'string' && item.trim())
    .map((item) => item.trim().slice(0, 500))
    .slice(0, max);
}

function requiredString(value, path, maxLength) {
  if (typeof value !== 'string') {
    throw new HttpError(502, 'invalid_schema_value', `${path} must be a string.`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new HttpError(502, 'invalid_schema_value', `${path} cannot be empty.`);
  }
  return trimmed.slice(0, maxLength);
}

function optionalString(value, path, maxLength) {
  if (value === undefined || value === null) return undefined;
  return requiredString(value, path, maxLength);
}

function finiteOrDefault(value, fallback) {
  return Number.isFinite(value) ? normalizeNumber(value) : fallback;
}

function normalizeNumber(value) {
  return Object.is(value, -0) ? 0 : value;
}

function vectorLength(vector) {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
