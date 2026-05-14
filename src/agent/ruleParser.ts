import type { MeshTarget, OperationCommand, Vec3 } from '../domain/actions';
import type { SceneState } from '../domain/scene';
import type { AgentParser, AgentParseResult } from './types';

const axisMap: Record<string, 'x' | 'y' | 'z'> = {
  x: 'x',
  X: 'x',
  y: 'y',
  Y: 'y',
  z: 'z',
  Z: 'z',
};

type ParserCommand = 'select' | 'rotate' | 'clone' | 'clip';

export function createRuleParser(): AgentParser {
  return {
    parse(text, scene) {
      const normalized = text.trim();
      if (!normalized) {
        return { kind: 'unsupported', message: '请输入要执行的三维操作。' };
      }

      if (/(重置|复位).*(视角|视图)|reset/i.test(normalized)) {
        return actionResult({
          id: createActionId('reset'),
          type: 'resetView',
          target: { scope: 'viewer' },
          params: { fit: 'visible', orientation: 'isometric' },
          source: 'agent',
          rawText: text,
        }, 0.96, false, '重置视角并适配当前可见对象。');
      }

      if (isSelectCommand(normalized)) {
        const target = resolveTarget(normalized, scene, 'select');
        if (!target) {
          return targetClarification(scene);
        }
        return actionResult({
          id: createActionId('select'),
          type: 'selectMesh',
          target,
          params: { mode: 'replace' },
          source: 'agent',
          rawText: text,
        }, 0.82, false, '选择匹配的对象。');
      }

      if (/(旋转|转动|rotate|turn|spin)/i.test(normalized)) {
        const target = resolveTarget(normalized, scene, 'rotate');
        if (!target) {
          return targetClarification(scene);
        }
        const axis = parseAxis(normalized) ?? 'z';
        const angleDeg = parseNumberBefore(normalized, /(度|°|deg(?:rees?)?)/i) ?? parseFirstStandaloneNumber(normalized);
        if (angleDeg === undefined) {
          return { kind: 'clarification', question: '要旋转多少度？', suggestions: ['绕 Z 轴旋转 30 度', '绕 X 轴旋转 45 度'] };
        }
        return actionResult({
          id: createActionId('rotate'),
          type: 'rotateMesh',
          target,
          params: { axis, angleDeg, pivot: 'boundsCenter', space: 'world' },
          source: 'agent',
          rawText: text,
        }, 0.91, false, `绕 ${axis.toUpperCase()} 轴旋转 ${angleDeg} 度。`);
      }

      if (/(复制|克隆|copy|clone|duplicate)/i.test(normalized)) {
        const target = resolveTarget(normalized, scene, 'clone');
        if (!target) {
          return targetClarification(scene);
        }
        const count = parseCloneCount(normalized) ?? 1;
        const axis = parseAxis(normalized) ?? 'x';
        const distance = parseDistance(normalized) ?? 20;
        return actionResult({
          id: createActionId('clone'),
          type: 'cloneMesh',
          target,
          params: {
            count,
            offset: offsetForAxis(axis, distance),
            unit: scene.unit,
            shareGeometry: true,
            namePattern: '{name}-copy-{n}',
          },
          source: 'agent',
          rawText: text,
        }, 0.88, count > 5, `复制 ${count} 个对象，沿 ${axis.toUpperCase()} 方向间隔 ${distance}${scene.unit}。`);
      }

      if (/(切|裁剪|剖|clip|cut|section|slice)/i.test(normalized)) {
        const target = resolveTarget(normalized, scene, 'clip');
        if (!target) {
          return targetClarification(scene);
        }
        const axis = parseAxis(normalized);
        if (!axis) {
          return {
            kind: 'clarification',
            question: '需要沿哪个方向或平面切割？',
            suggestions: ['沿 X=0 平面切开', '沿 Y=0 平面切开', '沿 Z=0 平面切开'],
          };
        }
        const originValue = parsePlaneOrigin(normalized) ?? 0;
        const keepSide = parseKeepSide(normalized, axis);
        return actionResult({
          id: createActionId('clip'),
          type: 'clipMesh',
          target,
          params: {
            plane: { origin: originForAxis(axis, originValue), normal: normalForAxis(axis) },
            keepSide,
            mode: 'preview',
            cap: true,
          },
          source: 'agent',
          rawText: text,
        }, 0.86, true, `创建沿 ${axis.toUpperCase()}=${originValue} 的切割预览。`);
      }

      return { kind: 'unsupported', message: '暂时只支持选择、旋转、复制、切割和重置视角。' };
    },
  };
}

function actionResult(
  action: OperationCommand,
  confidence: number,
  requiresConfirmation: boolean,
  explanation: string,
): AgentParseResult {
  return { kind: 'action', action, confidence, requiresConfirmation, explanation };
}

function targetClarification(scene: SceneState): AgentParseResult {
  return {
    kind: 'clarification',
    question: '要操作哪个对象？请先在视窗或对象树中选择对象。',
    suggestions: scene.meshes.slice(0, 4).map((mesh) => mesh.name),
  };
}

function createActionId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function isSelectCommand(text: string): boolean {
  if (/(复制|克隆|copy|clone|duplicate|旋转|转动|rotate|turn|spin|切|裁剪|剖|clip|cut|section|slice)/i.test(text)) {
    return false;
  }
  return /^(选择|选中)\s*/.test(text) || /^(select|choose|pick)\b/i.test(text);
}

function resolveTarget(text: string, scene: SceneState, command: ParserCommand): MeshTarget | undefined {
  const targetName = extractTargetName(text, command);
  if (targetName) {
    if (referencesSelection(targetName)) {
      return { source: 'selection' };
    }
    return targetFromName(targetName, scene);
  }

  if (referencesSelection(text)) {
    return { source: 'selection' };
  }

  return scene.selection.length > 0 && command !== 'select' ? { source: 'selection' } : undefined;
}

function extractTargetName(text: string, command: ParserCommand): string | undefined {
  let targetText = stripCommandWords(text, command);
  if (command === 'rotate') targetText = stripRotateDetails(targetText);
  if (command === 'clone') targetText = stripCloneDetails(targetText);
  if (command === 'clip') targetText = stripClipDetails(targetText);
  targetText = stripFillerWords(targetText);

  const cleaned = cleanTargetName(targetText);
  return cleaned || undefined;
}

function stripCommandWords(text: string, command: ParserCommand): string {
  const commandPatterns: Record<ParserCommand, RegExp> = {
    select: /\b(select|choose|pick)\b|选择|选中/gi,
    rotate: /\b(rotate|turn|spin)\b|旋转|转动/gi,
    clone: /\b(copy|clone|duplicate)\b|复制|克隆/gi,
    clip: /\b(clip|cut|section|slice)\b|切开|切割|裁剪|剖切|剖/gi,
  };
  return text.replace(commandPatterns[command], ' ');
}

function stripRotateDetails(text: string): string {
  return text
    .replace(/绕\s*[XYZxyz]\s*(轴|方向)?/g, ' ')
    .replace(/\b(?:around|about)\s+(?:the\s+)?[XYZxyz]\s*(?:-?\s*axis)?\b/gi, ' ')
    .replace(/\b(?:along)\s+(?:the\s+)?[XYZxyz]\s*(?:-?\s*(?:axis|direction))?\b/gi, ' ')
    .replace(/[XYZxyz]\s*(轴|方向)/g, ' ')
    .replace(/-?\d+(?:\.\d+)?\s*(度|°|deg(?:rees?)?)/gi, ' ')
    .replace(/(^|[\s,，])(?:by\s+)?-?\d+(?:\.\d+)?(?=$|[\s,，])/gi, ' ')
    .replace(/\b(?:by|degrees?|deg|axis|around|about)\b/gi, ' ');
}

function stripCloneDetails(text: string): string {
  return text
    .replace(/(?:间隔|距离|偏移|移动)\s*-?\d+(?:\.\d+)?\s*(mm|毫米|cm|厘米|m|米)?/gi, ' ')
    .replace(/\b(?:spacing|distance|offset)\s*(?:of\s+)?-?\d+(?:\.\d+)?\s*(mm|cm|m)?\b/gi, ' ')
    .replace(/-?\d+(?:\.\d+)?\s*(mm|毫米|cm|厘米|m|米)/gi, ' ')
    .replace(/沿\s*[XYZxyz]\s*(轴|方向)?/g, ' ')
    .replace(/\b(?:along|on)\s+(?:the\s+)?[XYZxyz]\s*(?:-?\s*(?:axis|direction))?\b/gi, ' ')
    .replace(/(^|[\s,，])-?\d+(?:\.\d+)?\s*(个|份|次|copies?|clones?|instances?)(?=$|[\s,，。.!?])/gi, ' ')
    .replace(/\b(?:copies?|clones?|instances?|times)\b/gi, ' ');
}

function stripClipDetails(text: string): string {
  return text
    .replace(/沿\s*[XYZxyz]\s*=\s*-?\d+(?:\.\d+)?\s*(平面|面)?/gi, ' ')
    .replace(/[XYZxyz]\s*=\s*-?\d+(?:\.\d+)?/gi, ' ')
    .replace(/\b(?:at|on|through|along)\s+(?:the\s+)?[XYZxyz]\s*(?:-?\s*(?:axis|plane))?\s+(?:at|origin)\s+-?\d+(?:\.\d+)?\b/gi, ' ')
    .replace(/\b(?:at|on|through|along)\s+(?:the\s+)?[XYZxyz]\s*(?:-?\s*(?:axis|plane))?\b/gi, ' ')
    .replace(/\b(?:keep|retain)\s+(?:the\s+)?(?:positive|negative|left|right|upper|lower|top|bottom|front|back|above|below)(?:\s+side)?\b/gi, ' ')
    .replace(/(只?保留|留下)?\s*(左|右|上|下|前|后|正|负)\s*(半边|一侧|侧)?/g, ' ')
    .replace(/\b(?:plane|side|keep|retain|at|origin|through)\b/gi, ' ')
    .replace(/[XYZxyz]\s*(轴|方向|平面|面)/g, ' ');
}

function stripFillerWords(text: string): string {
  return text
    .replace(/\b(?:please|the|a|an|mesh|object|part|component|target|model)\b/gi, ' ')
    .replace(/(对象|网格|模型|部件|零件|这个|那个|把|将|对|给)/g, ' ');
}

function cleanTargetName(text: string): string {
  return text
    .replace(/[“”"']/g, '')
    .replace(/[，,。.!?？；;:：()\[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function referencesSelection(text: string): boolean {
  return /(当前|选中|已选|所选|选择的|current|selected|selection)/i.test(text) || /选择(对象|网格|模型)/.test(text);
}

function targetFromName(name: string, scene: SceneState): MeshTarget {
  const exact = scene.meshes.find((mesh) => sameText(mesh.id, name) || sameText(mesh.name, name));
  if (exact) return { meshId: exact.id };

  const fuzzyMatches = scene.meshes.filter((mesh) => containsText(mesh.id, name) || containsText(mesh.name, name));
  if (fuzzyMatches.length === 1) return { meshId: fuzzyMatches[0].id };

  return { name, match: 'fuzzy' };
}

function sameText(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function containsText(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function parseAxis(text: string): 'x' | 'y' | 'z' | undefined {
  const explicitAxis = text.match(/(?:^|[^A-Za-z0-9_-])([XYZxyz])\s*(?:-?\s*(?:轴|方向|=|平面|axis|direction|plane)|(?=$|[^A-Za-z0-9_-]))/i);
  if (explicitAxis) {
    return axisMap[explicitAxis[1]];
  }
  if (/横向|左右|右|左|\bright\b|\bleft\b/i.test(text)) return 'x';
  if (/前后|纵向|\bfront\b|\bback\b/i.test(text)) return 'y';
  if (/上下|高度|\bup\b|\bdown\b|\btop\b|\bbottom\b|\bvertical\b/i.test(text)) return 'z';
  return undefined;
}

function parseFirstStandaloneNumber(text: string): number | undefined {
  const match = text.match(/(?:^|[^A-Za-z0-9_-])(-?\d+(?:\.\d+)?)(?=$|[^A-Za-z0-9_-])/);
  return match ? Number(match[1]) : undefined;
}

function parseNumberBefore(text: string, suffix: RegExp): number | undefined {
  const suffixMatch = text.match(suffix);
  if (suffixMatch?.index === undefined) return undefined;
  const before = text.slice(0, suffixMatch.index);
  const matches = [...before.matchAll(/(?:^|[^A-Za-z0-9_-])(-?\d+(?:\.\d+)?)(?=$|[^A-Za-z0-9_-])/g)];
  const last = matches[matches.length - 1];
  return last ? Number(last[1]) : undefined;
}

function parseCloneCount(text: string): number | undefined {
  const labelled = text.match(/(-?\d+(?:\.\d+)?)\s*(个|份|次|copies?|clones?|instances?)/i);
  if (labelled) return Number(labelled[1]);
  return parseFirstStandaloneNumber(text);
}

function parseDistance(text: string): number | undefined {
  const labelled = text.match(/(?:间隔|距离|偏移|移动)\s*(-?\d+(?:\.\d+)?)\s*(mm|毫米|cm|厘米|m|米)?/i);
  if (labelled) return Number(labelled[1]);
  const englishLabelled = text.match(/(?:spacing|distance|offset)\s*(?:of\s+)?(-?\d+(?:\.\d+)?)\s*(mm|cm|m)?/i);
  if (englishLabelled) return Number(englishLabelled[1]);
  const unitMatches = [...text.matchAll(/(-?\d+(?:\.\d+)?)\s*(mm|毫米|cm|厘米|m|米)/gi)];
  const last = unitMatches[unitMatches.length - 1];
  return last ? Number(last[1]) : undefined;
}

function parsePlaneOrigin(text: string): number | undefined {
  const planeMatch = text.match(/[XYZxyz]\s*=\s*(-?\d+(?:\.\d+)?)/);
  if (planeMatch) return Number(planeMatch[1]);
  const atMatch = text.match(/\b(?:at|origin|through)\s*(-?\d+(?:\.\d+)?)/i);
  if (atMatch) return Number(atMatch[1]);
  const cnMatch = text.match(/(?:坐标|位置|原点)\s*(-?\d+(?:\.\d+)?)/);
  return cnMatch ? Number(cnMatch[1]) : undefined;
}

function parseKeepSide(text: string, axis: 'x' | 'y' | 'z'): 'positive' | 'negative' {
  if (/(positive|正侧|正半|保留正)/i.test(text)) return 'positive';
  if (/(negative|负侧|负半|保留负)/i.test(text)) return 'negative';

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

  return 'negative';
}

function offsetForAxis(axis: 'x' | 'y' | 'z', distance: number): Vec3 {
  if (axis === 'x') return [distance, 0, 0];
  if (axis === 'y') return [0, distance, 0];
  return [0, 0, distance];
}

function originForAxis(axis: 'x' | 'y' | 'z', value: number): Vec3 {
  if (axis === 'x') return [value, 0, 0];
  if (axis === 'y') return [0, value, 0];
  return [0, 0, value];
}

function normalForAxis(axis: 'x' | 'y' | 'z'): Vec3 {
  if (axis === 'x') return [1, 0, 0];
  if (axis === 'y') return [0, 1, 0];
  return [0, 0, 1];
}
