export function createMockAgentResponse(request) {
  const text = request.text.trim();
  const lower = text.toLowerCase();

  if (/(什么|which|what).*(选中|selected)|选中了什么|what is selected/i.test(text)) {
    const selected = request.scene.meshes.filter((mesh) => request.scene.selection.includes(mesh.id));
    return {
      kind: 'sceneAnswer',
      answer: selected.length > 0
        ? `当前选中 ${selected.map((mesh) => mesh.name).join(', ')}。`
        : '当前没有选中对象。',
      referencedMeshIds: selected.map((mesh) => mesh.id),
    };
  }

  if (/(仿真|求解|solver|simulation|meshing|网格划分|真实切割|boolean|bake)/i.test(text)) {
    return {
      kind: 'backendJobDraft',
      title: inferJobTitle(text),
      description: '这类请求需要未来本地后端 job worker 处理，当前仅生成可审阅的作业草稿，不会直接修改视窗。',
      jobKind: inferJobKind(text),
      risk: {
        level: 'high',
        summary: '需要本地后端作业执行。',
        warnings: ['当前 MVP 不会直接运行几何处理、网格划分或求解器。'],
        requiresConfirmation: true,
        reversible: false,
      },
    };
  }

  if (/(然后|再|and then|, then|；|;)/i.test(text)) {
    const steps = buildPlanSteps(request);
    if (steps.length > 0) {
      return {
        kind: lower.includes('macro') || text.includes('宏') ? 'macroDraft' : 'actionPlan',
        ...(lower.includes('macro') || text.includes('宏') ? { name: 'viewer-review-macro' } : {}),
        steps,
        explanation: '已把请求拆成浏览器安全的逐步操作，执行时会在失败或需要确认处停止。',
        risk: combineStepRisk(steps),
      };
    }
  }

  const action = inferSingleAction(request);
  if (!action) {
    return {
      kind: 'clarification',
      question: '要对哪个对象执行什么操作？',
      suggestions: request.scene.meshes.slice(0, 3).map((mesh) => `选择 ${mesh.name}`),
    };
  }

  return {
    kind: 'actionDraft',
    action,
    explanation: explainAction(action),
    confidence: 0.74,
    risk: deriveMockRisk(action),
  };
}

function buildPlanSteps(request) {
  const steps = [];
  const text = request.text;
  if (/(选择|select)/i.test(text)) {
    const action = selectAction(request);
    if (action) steps.push({ id: 'step-select', title: '选择对象', action, explanation: '选择匹配对象。', risk: deriveMockRisk(action) });
  }
  if (/(线框|wireframe)/i.test(text)) {
    const action = displayModeAction(request, 'wireframe');
    steps.push({ id: 'step-wireframe', title: '切换线框', action, explanation: '切换到线框显示。', risk: deriveMockRisk(action) });
  }
  if (/(点云|points)/i.test(text)) {
    const action = displayModeAction(request, 'points');
    steps.push({ id: 'step-points', title: '切换点显示', action, explanation: '切换到点显示。', risk: deriveMockRisk(action) });
  }
  if (/(旋转|rotate|turn|spin)/i.test(text)) {
    const action = rotateAction(request);
    if (action) steps.push({ id: 'step-rotate', title: '旋转对象', action, explanation: '旋转目标对象。', risk: deriveMockRisk(action) });
  }
  if (/(移动|平移|move|translate|shift)/i.test(text)) {
    const action = moveAction(request);
    if (action) steps.push({ id: 'step-move', title: '移动对象', action, explanation: '移动目标对象。', risk: deriveMockRisk(action) });
  }
  if (/(重置|复位|fit|reset)/i.test(text)) {
    const action = resetViewAction(request);
    steps.push({ id: 'step-reset', title: '适配视图', action, explanation: '重置并适配可见对象。', risk: deriveMockRisk(action) });
  }
  return steps.slice(0, 6);
}

function inferSingleAction(request) {
  const text = request.text;
  if (/(重置|复位|fit|reset)/i.test(text)) return resetViewAction(request);
  if (/(线框|wireframe)/i.test(text)) return displayModeAction(request, 'wireframe');
  if (/(点云|points)/i.test(text)) return displayModeAction(request, 'points');
  if (/(表面|surface)/i.test(text)) return displayModeAction(request, 'surface');
  if (/(选择|select)/i.test(text)) return selectAction(request);
  if (/(隐藏|hide)/i.test(text)) return visibilityAction(request, false);
  if (/(显示|show)/i.test(text)) return visibilityAction(request, true);
  if (/(锁定|lock)/i.test(text)) return lockAction(request, true);
  if (/(解锁|unlock)/i.test(text)) return lockAction(request, false);
  if (/(移动|平移|move|translate|shift)/i.test(text)) return moveAction(request);
  if (/(复制|克隆|copy|clone|duplicate)/i.test(text)) return cloneAction(request);
  if (/(切|裁剪|剖|clip|cut|section|slice)/i.test(text)) return clipAction(request);
  if (/(旋转|rotate|turn|spin)/i.test(text)) return rotateAction(request);
  return undefined;
}

function selectAction(request) {
  const target = inferTarget(request);
  if (!target) return undefined;
  return baseCommand(request, 'selectMesh', target, { mode: 'replace' });
}

function rotateAction(request) {
  const target = inferTarget(request, { allowSelection: true });
  if (!target) return undefined;
  return baseCommand(request, 'rotateMesh', target, {
    axis: inferAxis(request.text) ?? 'z',
    angleDeg: inferNumber(request.text) ?? 30,
    pivot: 'boundsCenter',
    space: 'world',
  });
}

function cloneAction(request) {
  const target = inferTarget(request, { allowSelection: true });
  if (!target) return undefined;
  const axis = inferAxis(request.text) ?? 'x';
  const distance = inferDistance(request.text) ?? 20;
  return baseCommand(request, 'cloneMesh', target, {
    count: Math.min(12, Math.max(1, Math.trunc(inferNumber(request.text) ?? 1))),
    offset: axisVector(axis, distance),
    unit: request.scene.unit,
    shareGeometry: true,
    namePattern: '{name}-copy-{n}',
  });
}

function moveAction(request) {
  const target = inferTarget(request, { allowSelection: true });
  if (!target) return undefined;
  const axis = inferAxis(request.text) ?? 'x';
  const distance = inferDistance(request.text) ?? inferNumber(request.text) ?? 10;
  return baseCommand(request, 'moveMesh', target, {
    offset: axisVector(axis, distance),
    unit: request.scene.unit,
  });
}

function clipAction(request) {
  const target = inferTarget(request, { allowSelection: true });
  if (!target) return undefined;
  const axis = inferAxis(request.text) ?? 'x';
  const origin = inferPlaneOrigin(request.text) ?? 0;
  return baseCommand(request, 'clipMesh', target, {
    plane: { origin: axisVector(axis, origin), normal: axisVector(axis, 1) },
    keepSide: /负|左|后|下|negative|left|back|below|lower/i.test(request.text) ? 'negative' : 'positive',
    mode: 'preview',
    cap: true,
  });
}

function visibilityAction(request, visible) {
  const target = inferTarget(request, { allowSelection: true });
  if (!target) return undefined;
  return baseCommand(request, 'setMeshVisibility', target, { visible });
}

function lockAction(request, locked) {
  const target = inferTarget(request, { allowSelection: true });
  if (!target) return undefined;
  return baseCommand(request, 'setMeshLocked', target, { locked });
}

function resetViewAction(request) {
  return baseCommand(request, 'resetView', { scope: 'viewer' }, { fit: 'visible', orientation: 'isometric' });
}

function displayModeAction(request, mode) {
  return baseCommand(request, 'setDisplayMode', { scope: 'viewer' }, { mode });
}

function inferTarget(request, options = {}) {
  const text = request.text.toLowerCase();
  if (/(整个|全部|所有|全体|全场景|全模型|全部可见|所有可见|entire|whole|all visible|all meshes|everything)/i.test(request.text)) {
    return { source: 'allVisible' };
  }
  const colorTarget = inferColorTarget(request);
  if (colorTarget) return colorTarget;
  if (/(当前|选中|selected|selection)/i.test(request.text) && request.scene.selection.length > 0) return { source: 'selection' };

  const exact = request.scene.meshes.find((mesh) => text.includes(mesh.id.toLowerCase()) || text.includes(mesh.name.toLowerCase()));
  if (exact) return { meshId: exact.id };

  const token = request.scene.meshes.find((mesh) => mesh.name.toLowerCase().split(/\s+/).some((part) => part.length > 2 && text.includes(part)));
  if (token) return { meshId: token.id };

  if (options.allowSelection && request.scene.selection.length > 0) return { source: 'selection' };
  return undefined;
}

function inferColorTarget(request) {
  const colorLabels = requestedColorLabels(request.text);
  if (colorLabels.length === 0) return undefined;
  const selectedIds = new Set(request.scene.selection ?? []);
  const visibleMeshes = request.scene.meshes.filter((mesh) => mesh.visible !== false);
  const selectedMeshes = visibleMeshes.filter((mesh) => selectedIds.has(mesh.id));
  const referencesSelection = /(当前|选中|已选|所选|选择的|current|selected|selection)/i.test(request.text);
  const searchMeshes = referencesSelection && selectedMeshes.length > 0 ? selectedMeshes : visibleMeshes;
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

function baseCommand(request, type, target, params) {
  return {
    id: `${type}-${Date.now().toString(36)}`,
    type,
    target,
    params,
    source: 'agent',
    rawText: request.text,
    confirmed: false,
  };
}

function deriveMockRisk(action) {
  const warnings = [];
  if (action.type === 'clipMesh') warnings.push('视觉切割需要用户检查预览后确认。');
  if (action.type === 'cloneMesh' && action.params.count > 5) warnings.push('大量复制可能影响浏览器帧率。');
  return {
    level: warnings.length > 0 ? 'medium' : 'low',
    summary: warnings.length > 0 ? '执行前需要审阅。' : '浏览器内可撤销的查看器操作。',
    warnings,
    requiresConfirmation: warnings.length > 0,
    reversible: true,
  };
}

function combineStepRisk(steps) {
  const warnings = [...new Set(steps.flatMap((step) => step.risk?.warnings ?? []))];
  return {
    level: warnings.length > 0 ? 'medium' : 'low',
    summary: '逐步执行浏览器安全操作。',
    warnings,
    requiresConfirmation: warnings.length > 0,
    reversible: true,
  };
}

function explainAction(action) {
  if (action.type === 'resetView') return '重置视角并适配可见对象。';
  if (action.type === 'setDisplayMode') return `切换显示模式为 ${action.params.mode}。`;
  if (action.type === 'rotateMesh') return `绕 ${Array.isArray(action.params.axis) ? action.params.axis.join(',') : action.params.axis.toUpperCase()} 轴旋转 ${action.params.angleDeg} 度。`;
  if (action.type === 'moveMesh') return `移动 ${action.params.offset.join(', ')} ${action.params.unit}。`;
  if (action.type === 'cloneMesh') return `复制 ${action.params.count} 个对象。`;
  if (action.type === 'clipMesh') return '创建视觉切割预览。';
  if (action.type === 'selectMesh') return '选择匹配对象。';
  return `准备 ${action.type} 操作。`;
}

function inferAxis(text) {
  const planeNormalAxis = inferAxisPairPlane(text);
  if (planeNormalAxis) return planeNormalAxis;

  const match = text.match(/[XYZxyz]\s*(轴|方向|=|plane|axis)?/);
  if (match) return match[0][0].toLowerCase();
  if (/左|右|left|right/i.test(text)) return 'x';
  if (/前|后|front|back/i.test(text)) return 'y';
  if (/上|下|top|bottom|up|down/i.test(text)) return 'z';
  return undefined;
}

function inferAxisPairPlane(text) {
  const compact = text.toLowerCase().replace(/\s+/g, '');
  if (/[x][,，/\\-]?[y](?:平面|面|plane)/i.test(compact)) return 'z';
  if (/[x][,，/\\-]?[z](?:平面|面|plane)/i.test(compact)) return 'y';
  if (/[y][,，/\\-]?[z](?:平面|面|plane)/i.test(compact)) return 'x';
  return undefined;
}

function inferNumber(text) {
  const match = text.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : undefined;
}

function inferDistance(text) {
  const matches = [...text.matchAll(/(-?\d+(?:\.\d+)?)\s*(mm|毫米|cm|厘米|m|米)/gi)];
  const last = matches[matches.length - 1];
  return last ? Number(last[1]) : undefined;
}

function inferPlaneOrigin(text) {
  const match = text.match(/[XYZxyz]\s*=\s*(-?\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : undefined;
}

function axisVector(axis, value) {
  if (axis === 'x') return [value, 0, 0];
  if (axis === 'y') return [0, value, 0];
  return [0, 0, value];
}

function inferJobKind(text) {
  if (/网格|mesh/i.test(text)) return 'meshing';
  if (/仿真|求解|solver|simulation/i.test(text)) return 'solverRun';
  if (/总结|summary|result/i.test(text)) return 'resultSummary';
  return 'geometryCut';
}

function inferJobTitle(text) {
  const kind = inferJobKind(text);
  if (kind === 'meshing') return '本地网格划分作业';
  if (kind === 'solverRun') return '本地仿真求解作业';
  if (kind === 'resultSummary') return '仿真结果摘要作业';
  return '真实几何处理作业';
}
