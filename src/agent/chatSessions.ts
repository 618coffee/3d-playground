import type { HistoryEntry } from '../domain/history';
import {
  AGENT_MODES,
  MODEL_ROUTER_IDS,
  type AgentChatMessage,
  type AgentChatSession,
  type AgentMode,
  type AgentSessionContextSummary,
  type ModelRouterId,
} from '../domain/protocol';
import type { SceneState } from '../domain/scene';
import { validateAgentResponse } from '../domain/validators';

export const AGENT_CHAT_SESSIONS_STORAGE_KEY = 'industrial-sim.agentChatSessions.v1';
export const DEFAULT_AGENT_CHAT_TITLE = 'New chat';
export const MAX_AGENT_CHAT_SESSIONS = 20;

export function summarizeSessionContext(scene: SceneState, history: HistoryEntry[]): AgentSessionContextSummary {
  return {
    meshCount: scene.meshes.length,
    selectedMeshIds: [...scene.selection],
    historyCount: history.length,
  };
}

export function createAgentChatSession(
  context: AgentSessionContextSummary,
  options: Partial<Pick<AgentChatSession, 'mode' | 'modelRouterId' | 'title'>> = {},
): AgentChatSession {
  const timestamp = nowIso();

  return {
    id: generateSessionId(),
    title: options.title ?? DEFAULT_AGENT_CHAT_TITLE,
    mode: options.mode ?? 'edit',
    modelRouterId: options.modelRouterId ?? 'default-router',
    messages: [],
    context: {
      meshCount: context.meshCount,
      selectedMeshIds: [...context.selectedMeshIds],
      historyCount: context.historyCount,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function loadAgentChatSessions(storage?: Pick<Storage, 'getItem'>): AgentChatSession[] {
  try {
    const targetStorage = storage ?? getLocalStorage();
    if (!targetStorage) return [];

    const stored = targetStorage.getItem(AGENT_CHAT_SESSIONS_STORAGE_KEY);
    if (!stored) return [];

    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];

    return parsed.map(normalizeAgentChatSession).filter(isAgentChatSession).sort(compareSessionsByUpdatedAtDesc).slice(0, MAX_AGENT_CHAT_SESSIONS);
  } catch {
    return [];
  }
}

export function saveAgentChatSessions(sessions: AgentChatSession[], storage?: Pick<Storage, 'setItem'>): void {
  try {
    const targetStorage = storage ?? getLocalStorage();
    if (!targetStorage) return;

    targetStorage.setItem(AGENT_CHAT_SESSIONS_STORAGE_KEY, JSON.stringify(limitSessions(sessions)));
  } catch {
    // localStorage may be unavailable or full; callers should keep in-memory state.
  }
}

export function appendAgentChatMessage(
  session: AgentChatSession,
  message: Omit<AgentChatMessage, 'id' | 'createdAt'> & Partial<Pick<AgentChatMessage, 'id' | 'createdAt'>>,
): AgentChatSession {
  const timestamp = nowIso();
  const nextMessage: AgentChatMessage = {
    ...message,
    id: message.id ?? generateSessionId(),
    createdAt: message.createdAt ?? timestamp,
  };
  const nextTitle = deriveNextTitle(session.title, nextMessage);

  return {
    ...session,
    title: nextTitle,
    messages: [...session.messages, nextMessage],
    updatedAt: timestamp,
  };
}

export function upsertAgentChatSession(sessions: AgentChatSession[], session: AgentChatSession): AgentChatSession[] {
  const sessionExists = sessions.some((existingSession) => existingSession.id === session.id);
  const nextSessions = sessionExists
    ? sessions.map((existingSession) => (existingSession.id === session.id ? session : existingSession))
    : [session, ...sessions];

  return limitSessions(nextSessions);
}

function generateSessionId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function getLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function deriveNextTitle(title: string, message: AgentChatMessage): string {
  const trimmedText = message.text.trim();
  if (title === DEFAULT_AGENT_CHAT_TITLE && message.role === 'user' && trimmedText.length > 0) {
    return trimmedText.slice(0, 48);
  }

  return title;
}

function compareSessionsByUpdatedAtDesc(left: AgentChatSession, right: AgentChatSession): number {
  return right.updatedAt.localeCompare(left.updatedAt);
}

function limitSessions(sessions: AgentChatSession[]): AgentChatSession[] {
  return [...sessions].sort(compareSessionsByUpdatedAtDesc).slice(0, MAX_AGENT_CHAT_SESSIONS);
}

function normalizeAgentChatSession(value: unknown): AgentChatSession | null {
  if (!isRecord(value)) return null;
  if (!isString(value.id) || !isString(value.title) || !isString(value.createdAt) || !isString(value.updatedAt)) return null;
  if (!isAgentMode(value.mode) || !isModelRouterId(value.modelRouterId)) return null;
  if (!isSessionContextSummary(value.context) || !Array.isArray(value.messages)) return null;

  const messages = value.messages.map(normalizeAgentChatMessage).filter(isAgentChatMessage);

  return {
    id: value.id,
    title: value.title,
    mode: value.mode,
    modelRouterId: value.modelRouterId,
    messages,
    context: {
      meshCount: value.context.meshCount,
      selectedMeshIds: [...value.context.selectedMeshIds],
      historyCount: value.context.historyCount,
    },
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function isAgentChatSession(value: unknown): value is AgentChatSession {
  return value !== null;
}

function normalizeAgentChatMessage(value: unknown): AgentChatMessage | null {
  if (!isRecord(value)) return null;
  if (!isString(value.id) || !isChatRole(value.role) || !isString(value.text) || !isString(value.createdAt)) return null;

  const message: AgentChatMessage = {
    id: value.id,
    role: value.role,
    text: value.text,
    createdAt: value.createdAt,
  };

  if (isAgentChatMessageRequest(value.request)) {
    message.request = value.request;
  }

  if (value.response !== undefined) {
    const response = validateAgentResponse(value.response);
    if (response.ok) {
      message.response = response.value;
    }
  }

  return message;
}

function isAgentChatMessage(value: unknown): value is AgentChatMessage {
  return value !== null;
}

function isSessionContextSummary(value: unknown): value is AgentSessionContextSummary {
  if (!isRecord(value)) return false;
  return (
    typeof value.meshCount === 'number' &&
    typeof value.historyCount === 'number' &&
    Array.isArray(value.selectedMeshIds) &&
    value.selectedMeshIds.every(isString)
  );
}

function isAgentChatMessageRequest(value: unknown): value is NonNullable<AgentChatMessage['request']> {
  if (!isRecord(value)) return false;
  return isString(value.text) && isAgentMode(value.mode) && isModelRouterId(value.modelRouterId);
}

function isAgentMode(value: unknown): value is AgentMode {
  return AGENT_MODES.includes(value as AgentMode);
}

function isModelRouterId(value: unknown): value is ModelRouterId {
  return MODEL_ROUTER_IDS.includes(value as ModelRouterId);
}

function isChatRole(value: unknown): value is AgentChatMessage['role'] {
  return value === 'user' || value === 'assistant' || value === 'tool' || value === 'status';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}