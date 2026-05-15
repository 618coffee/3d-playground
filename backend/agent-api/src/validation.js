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
    const viewerClipDraft = normalizeSimpleGeometryCutDraft(request);
    if (viewerClipDraft) return viewerClipDraft;

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
    const jobKind = enumValue(response.jobKind, ['geometryCut', 'meshing', 'solverRun', 'resultSummary'], 'jobKind');
    const viewerClipDraft = jobKind === 'geometryCut' ? normalizeSimpleGeometryCutDraft(request) : undefined;
    if (viewerClipDraft) return viewerClipDraft;

    return {
      kind,
      title: requiredString(response.title, 'title', 300),
      description: requiredString(response.description, 'description', 2000),
      jobKind,
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
  const color = normalizeHexColor(mesh.color);
  return {
    id: requiredString(mesh.id, 'scene.mesh.id', 200),
    name: optionalString(mesh.name, 'scene.mesh.name', 200) ?? mesh.id,
    sourceFormat: MESH_SOURCE_FORMATS.includes(mesh.sourceFormat) ? mesh.sourceFormat : 'procedural',
    visible: typeof mesh.visible === 'boolean' ? mesh.visible : true,
    locked: typeof mesh.locked === 'boolean' ? mesh.locked : false,
    selected: typeof mesh.selected === 'boolean' ? mesh.selected : false,
    ...(color ? { color, colorLabel: colorLabelForHex(color) } : {}),
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
    const source = enumValue(target.source, ['selection', 'allVisible'], `${path}.source`);
    const colorTarget = inferColorTarget(request, source === 'selection');
    return colorTarget ?? { source };
  }

  if (typeof target.name === 'string') {
    return {
      name: requiredString(target.name, `${path}.name`, 240),
      match: enumValue(target.match, ['exact', 'fuzzy'], `${path}.match`),
    };
  }

  throw new HttpError(502, 'invalid_operation_command', `${path} must use meshId, meshIds, source, or name.`);
}

function normalizeHexColor(value) {
  if (typeof value !== 'string') return undefined;
  const match = value.trim().match(/^#?([0-9a-f]{6})$/i);
  return match ? `#${match[1].toLowerCase()}` : undefined;
}

function colorLabelForHex(hex) {
  const red = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const green = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const lightness = (max + min) / 2;
  if (delta < 0.08) return lightness < 0.35 ? 'black' : lightness > 0.75 ? 'white' : 'gray';
  let hue;
  if (max === red) hue = ((green - blue) / delta) % 6;
  else if (max === green) hue = (blue - red) / delta + 2;
  else hue = (red - green) / delta + 4;
  const degrees = (hue * 60 + 360) % 360;
  if (degrees < 15 || degrees >= 345) return 'red';
  if (degrees < 36) return 'orange';
  if (degrees < 55) return 'gold';
  if (degrees < 75) return 'yellow';
  if (degrees < 165) return 'green';
  if (degrees < 195) return 'cyan';
  if (degrees < 255) return 'blue';
  if (degrees < 285) return 'purple';
  if (degrees < 345) return 'magenta';
  return 'gray';
}

function inferColorTarget(request, preferSelection) {
  const colorLabels = requestedColorLabels(request.text);
  if (colorLabels.length === 0) return undefined;
  const selectedIds = new Set(request.scene.selection ?? []);
  const visibleMeshes = request.scene.meshes.filter((mesh) => mesh.visible !== false);
  const selectedMeshes = visibleMeshes.filter((mesh) => selectedIds.has(mesh.id));
  const searchMeshes = preferSelection && selectedMeshes.length > 0 ? selectedMeshes : visibleMeshes;
  const matches = searchMeshes.filter((mesh) => colorLabels.includes(mesh.colorLabel));
  if (matches.length === 1) return { meshId: matches[0].id };
  return undefined;
}

function requestedColorLabels(text) {
  const labels = [];
  const add = (label) => {
    if (!labels.includes(label)) labels.push(label);
  };
  if (/(橙色|橘色|orange)/i.test(text)) add('orange');
  if (/(金色|金黄|gold|amber)/i.test(text)) add('gold');
  if (/(黄色|yellow)/i.test(text)) add('yellow');
  if (/(蓝色|blue)/i.test(text)) add('blue');
  if (/(青色|cyan)/i.test(text)) add('cyan');
  if (/(绿色|green)/i.test(text)) add('green');
  if (/(红色|red)/i.test(text)) add('red');
  if (/(紫色|purple)/i.test(text)) add('purple');
  if (/(粉色|洋红|magenta|pink)/i.test(text)) add('magenta');
  if (/(白色|white)/i.test(text)) add('white');
  if (/(黑色|black)/i.test(text)) add('black');
  if (/(灰色|gray|grey)/i.test(text)) add('gray');
  return labels;
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

function normalizeSimpleGeometryCutDraft(request) {
  const command = inferViewerClipCommand(request);
  if (!command) return undefined;
  const action = validateOperationCommand(command, request);
  return {
    kind: 'actionDraft',
    action,
    explanation: 'Converted a plane cut request into a viewer visual clipping draft.',
    confidence: 0.78,
    risk: normalizeActionRisk(undefined, [action]),
  };
}

function inferViewerClipCommand(request) {
  const text = request.text ?? '';
  if (!/(切|裁剪|剖|clip|cut|section|slice)/i.test(text)) return undefined;
  if (/(真实|永久|布尔|烘焙|导出|实体|拓扑|boolean|bake|baked|permanent|export|remesh)/i.test(text)) return undefined;

  const axis = parseClipAxis(text);
  if (!axis) return undefined;
  const target = inferClipTarget(text, request);
  if (!target) return undefined;
  const origin = parsePlaneOrigin(text) ?? 0;

  return {
    id: createCommandId('clipMesh'),
    type: 'clipMesh',
    target,
    params: {
      plane: { origin: originForAxis(axis, origin), normal: normalForAxis(axis) },
      keepSide: parseKeepSide(text, axis),
      mode: 'applyVisualClip',
      cap: true,
    },
    source: 'agent',
    rawText: request.text,
    confirmed: false,
  };
}

function inferClipTarget(text, request) {
  if (/(整个|全部|所有|全体|全场景|全模型|全部可见|所有可见|entire|whole|all visible|all meshes|everything)/i.test(text)) {
    return { source: 'allVisible' };
  }
  if (/(当前|选中|已选|所选|选择的|current|selected|selection)/i.test(text) && request.scene.selection.length > 0) {
    return { source: 'selection' };
  }
  return request.scene.selection.length > 0 ? { source: 'selection' } : undefined;
}

function parseClipAxis(text) {
  const pairAxis = parseAxisPairPlane(text);
  if (pairAxis) return pairAxis;
  const explicitAxis = text.match(/(?:^|[^A-Za-z0-9_-])([XYZxyz])\s*(?:-?\s*(?:轴|方向|=|平面|axis|direction|plane)|(?=$|[^A-Za-z0-9_-]))/i);
  if (explicitAxis) return explicitAxis[1].toLowerCase();
  if (/横向|左右|右|左|\bright\b|\bleft\b/i.test(text)) return 'x';
  if (/前后|纵向|\bfront\b|\bback\b/i.test(text)) return 'y';
  if (/上下|高度|\bup\b|\bdown\b|\btop\b|\bbottom\b|\bvertical\b/i.test(text)) return 'z';
  return undefined;
}

function parseAxisPairPlane(text) {
  const compact = text.toLowerCase().replace(/\s+/g, '');
  if (/[x][,，/\\-]?[y](?:平面|面|plane)/i.test(compact)) return 'z';
  if (/[x][,，/\\-]?[z](?:平面|面|plane)/i.test(compact)) return 'y';
  if (/[y][,，/\\-]?[z](?:平面|面|plane)/i.test(compact)) return 'x';
  return undefined;
}

function parsePlaneOrigin(text) {
  const planeMatch = text.match(/[XYZxyz]\s*=\s*(-?\d+(?:\.\d+)?)/);
  if (planeMatch) return Number(planeMatch[1]);
  const atMatch = text.match(/\b(?:at|origin|through)\s*(-?\d+(?:\.\d+)?)/i);
  if (atMatch) return Number(atMatch[1]);
  const cnMatch = text.match(/(?:坐标|位置|原点)\s*(-?\d+(?:\.\d+)?)/);
  return cnMatch ? Number(cnMatch[1]) : undefined;
}

function parseKeepSide(text, axis) {
  if (/(positive|正侧|正半|正坐标|正方向|正向|保留.*正)/i.test(text)) return 'positive';
  if (/(negative|负侧|负半|负坐标|负方向|负向|保留.*负)/i.test(text)) return 'negative';
  if (axis === 'x') {
    if (/(右|\bright\b)/i.test(text)) return 'positive';
    if (/(左|\bleft\b)/i.test(text)) return 'negative';
  }
  if (axis === 'y') {
    if (/(前|\bfront\b)/i.test(text)) return 'positive';
    if (/(后|\bback\b)/i.test(text)) return 'negative';
  }
  if (axis === 'z') {
    if (/(上|\bup\b|\bupper\b|\btop\b|\babove\b)/i.test(text)) return 'positive';
    if (/(下|\bdown\b|\blower\b|\bbottom\b|\bbelow\b)/i.test(text)) return 'negative';
  }
  return 'positive';
}

function originForAxis(axis, value) {
  if (axis === 'x') return [value, 0, 0];
  if (axis === 'y') return [0, value, 0];
  return [0, 0, value];
}

function normalForAxis(axis) {
  if (axis === 'x') return [1, 0, 0];
  if (axis === 'y') return [0, 1, 0];
  return [0, 0, 1];
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
