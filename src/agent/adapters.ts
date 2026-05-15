import { createRuleParser } from './ruleParser';
import type { AgentParseResult } from './types';
import type { AgentAdapter, AgentRequest, AgentResponse } from '../domain/protocol';
import { lowRisk, reviewRisk } from '../domain/protocol';
import { validateAgentResponse } from '../domain/validators';

export function createRuleParserAdapter(): AgentAdapter {
  const parser = createRuleParser();
  return {
    id: 'rule-parser',
    label: 'Offline fallback',
    async respond(request: AgentRequest, options) {
      throwIfAborted(options?.signal);
      const response = parseResultToAgentResponse(parser.parse(request.text, request.scene));
      throwIfAborted(options?.signal);
      return response;
    },
  };
}

export function createLlmAgentClient(options: { endpoint: string }): AgentAdapter {
  return {
    id: 'local-llm',
    label: 'Local LLM',
    async respond(request, respondOptions) {
      const response = await fetch(options.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: respondOptions?.signal,
      });
      const payload = await parseJsonResponse(response);
      if (!response.ok) throw new Error(agentApiErrorMessage(response.status, payload));
      const validation = validateAgentResponse(payload);
      if (!validation.ok) throw new Error(validation.error);
      return validation.value;
    },
  };
}

export function parseResultToAgentResponse(result: AgentParseResult): AgentResponse {
  if (result.kind === 'clarification') {
    return { kind: 'clarification', question: result.question, suggestions: result.suggestions };
  }
  if (result.kind === 'unsupported') {
    return { kind: 'message', text: result.message };
  }
  return {
    kind: 'actionDraft',
    action: result.action,
    explanation: result.explanation,
    confidence: result.confidence,
    risk: result.requiresConfirmation
      ? reviewRisk('需要先在视窗中预览并确认。', ['此操作会进入确认流程。'])
      : lowRisk(),
  };
}


async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Agent API returned ${response.status} with invalid JSON.`);
  }
}

function agentApiErrorMessage(status: number, payload: unknown): string {
  if (!isRecord(payload) || !isRecord(payload.error)) return `Agent API returned ${status}`;
  const message = typeof payload.error.message === 'string' ? payload.error.message : `Agent API returned ${status}`;
  const detail = extractProviderDetail(payload.error.details);
  return detail ? `Agent API returned ${status}: ${message} (${detail})` : `Agent API returned ${status}: ${message}`;
}

function extractProviderDetail(details: unknown): string | null {
  if (typeof details === 'string') return details;
  if (!isRecord(details)) return null;
  if (typeof details.message === 'string') return details.message;
  if (typeof details.code === 'string') return details.code;
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw new DOMException('Agent request was cancelled.', 'AbortError');
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
