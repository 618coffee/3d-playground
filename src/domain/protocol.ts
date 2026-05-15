import type { OperationCommand } from './actions';
import type { SceneState } from './scene';

export type ActionRiskLevel = 'low' | 'medium' | 'high' | 'blocked';

export type ActionRisk = {
  level: ActionRiskLevel;
  summary: string;
  warnings: string[];
  requiresConfirmation: boolean;
  reversible: boolean;
};

export type AgentPlanStep = {
  id: string;
  title: string;
  action: OperationCommand;
  explanation?: string;
  risk?: ActionRisk;
};

export type AgentResponse =
  | { kind: 'message'; text: string }
  | { kind: 'clarification'; question: string; suggestions: string[] }
  | {
      kind: 'actionDraft';
      action: OperationCommand;
      explanation: string;
      confidence: number;
      risk: ActionRisk;
    }
  | {
      kind: 'actionPlan';
      steps: AgentPlanStep[];
      explanation: string;
      risk: ActionRisk;
    }
  | { kind: 'sceneAnswer'; answer: string; referencedMeshIds: string[] }
  | { kind: 'macroDraft'; name: string; steps: AgentPlanStep[]; explanation: string; risk: ActionRisk }
  | { kind: 'backendJobDraft'; title: string; description: string; jobKind: 'geometryCut' | 'meshing' | 'solverRun' | 'resultSummary'; risk: ActionRisk };

export type AgentConversationTurn = {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  text: string;
  timestamp: string;
};

export type AgentRequest = {
  id: string;
  text: string;
  scene: SceneState;
  conversation: AgentConversationTurn[];
  pendingCommand?: OperationCommand | null;
  context?: unknown;
};

export type AgentAdapter = {
  id: string;
  label: string;
  respond: (request: AgentRequest, options?: { signal?: AbortSignal }) => Promise<AgentResponse>;
};

export function lowRisk(summary = '浏览器内可撤销的查看器操作。'): ActionRisk {
  return {
    level: 'low',
    summary,
    warnings: [],
    requiresConfirmation: false,
    reversible: true,
  };
}

export function reviewRisk(summary: string, warnings: string[] = []): ActionRisk {
  return {
    level: warnings.length > 0 ? 'medium' : 'low',
    summary,
    warnings,
    requiresConfirmation: true,
    reversible: true,
  };
}
