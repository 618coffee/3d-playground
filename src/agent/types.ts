import type { OperationCommand } from '../domain/actions';
import type { AgentAdapter, AgentMeshReference, AgentRequest, AgentResponse } from '../domain/protocol';
import type { SceneState } from '../domain/scene';

export type AgentParseResult =
  | {
      kind: 'action';
      action: OperationCommand;
      confidence: number;
      requiresConfirmation: boolean;
      explanation: string;
    }
  | {
      kind: 'clarification';
      question: string;
      suggestions: string[];
    }
  | {
      kind: 'unsupported';
      message: string;
    };

export type AgentParser = {
  parse: (text: string, scene: SceneState, meshReferences?: readonly AgentMeshReference[]) => AgentParseResult;
};

export type { AgentAdapter, AgentRequest, AgentResponse };
