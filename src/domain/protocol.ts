import type { OperationCommand } from './actions';
import type { SceneState } from './scene';

export type AgentMeshReference = {
  label: string;
  meshId: string;
};

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

export const AGENT_MODES = ['ask', 'edit', 'agent'] as const;
export type AgentMode = (typeof AGENT_MODES)[number];

export const MODEL_ROUTER_IDS = ['default-router'] as const;
export type ModelRouterId = (typeof MODEL_ROUTER_IDS)[number];

export type AgentSessionContextSummary = {
  meshCount: number;
  selectedMeshIds: string[];
  historyCount: number;
};

export type AgentChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'status';
  text: string;
  request?: {
    text: string;
    mode: AgentMode;
    modelRouterId: ModelRouterId;
    meshReferences?: AgentMeshReference[];
  };
  response?: AgentResponse;
  createdAt: string;
};

export type AgentChatSession = {
  id: string;
  title: string;
  mode: AgentMode;
  modelRouterId: ModelRouterId;
  messages: AgentChatMessage[];
  context: AgentSessionContextSummary;
  createdAt: string;
  updatedAt: string;
};

export type AgentRequestMetadata = {
  sessionId?: string;
  mode: AgentMode;
  modelRouterId: ModelRouterId;
};

export type AgentRequest = {
  id: string;
  sessionId?: string;
  text: string;
  mode?: AgentMode;
  modelRouterId?: ModelRouterId;
  scene: SceneState;
  conversation: AgentConversationTurn[];
  pendingCommand?: OperationCommand | null;
  meshReferences?: AgentMeshReference[];
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
