import { describe, expect, it, vi } from 'vitest';
import type { MeshEntity, OperationCommand } from '../domain/actions';
import type { HistoryEntry } from '../domain/history';
import type { AgentChatSession } from '../domain/protocol';
import type { SceneState } from '../domain/scene';
import {
  AGENT_CHAT_SESSIONS_STORAGE_KEY,
  DEFAULT_AGENT_CHAT_TITLE,
  MAX_AGENT_CHAT_SESSIONS,
  appendAgentChatMessage,
  createAgentChatSession,
  loadAgentChatSessions,
  saveAgentChatSessions,
  summarizeSessionContext,
  upsertAgentChatSession,
} from './chatSessions';

const baseMesh: MeshEntity = {
  id: 'mesh-1',
  name: 'compressor-core',
  sourceFormat: 'procedural',
  visible: true,
  locked: false,
  selected: true,
  color: '#4fb3ff',
  opacity: 1,
  bounds: [-1, 1, -1, 1, -1, 1],
  stats: { points: 24, cells: 12, triangles: 12 },
  transform: { position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
};

const scene: SceneState = {
  meshes: [
    baseMesh,
    {
      ...baseMesh,
      id: 'mesh-2',
      name: 'fan-stage',
      selected: false,
      transform: { position: [10, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
    },
  ],
  selection: ['mesh-1', 'mesh-2'],
  unit: 'mm',
  displayMode: 'surface',
};

const command: OperationCommand = {
  id: 'act-1',
  type: 'rotateMesh',
  target: { meshId: 'mesh-1' },
  params: { axis: 'z', angleDeg: 15, pivot: 'boundsCenter', space: 'world' },
  source: 'agent',
};

function createStorage(initialValue?: string): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map<string, string>();
  if (initialValue !== undefined) {
    values.set(AGENT_CHAT_SESSIONS_STORAGE_KEY, initialValue);
  }

  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}

describe('agent chat sessions', () => {
  it('creates a new edit session with default router, context summary, generated fields, and no messages', () => {
    const context = { meshCount: 2, selectedMeshIds: ['mesh-1'], historyCount: 3 };

    const session = createAgentChatSession(context);

    expect(session).toMatchObject({
      title: DEFAULT_AGENT_CHAT_TITLE,
      mode: 'edit',
      modelRouterId: 'default-router',
      context,
      messages: [],
    });
    expect(session.id).toEqual(expect.any(String));
    expect(session.id).not.toHaveLength(0);
    expect(new Date(session.createdAt).toString()).not.toBe('Invalid Date');
    expect(session.updatedAt).toBe(session.createdAt);
  });

  it('round-trips saved sessions through localStorage', () => {
    const storage = createStorage();
    const session = createAgentChatSession({ meshCount: 1, selectedMeshIds: ['mesh-1'], historyCount: 0 });
    const withMessage = appendAgentChatMessage(session, {
      role: 'assistant',
      text: 'Ready.',
      request: { text: 'Explain the scene', mode: 'ask', modelRouterId: 'default-router' },
      response: { kind: 'message', text: 'Ready.' },
    });

    saveAgentChatSessions([withMessage], storage);
    const loaded = loadAgentChatSessions(storage);

    expect(storage.setItem).toHaveBeenCalledWith(AGENT_CHAT_SESSIONS_STORAGE_KEY, expect.any(String));
    expect(loaded).toEqual([withMessage]);
    expect(loaded[0].messages[0].request).toEqual({ text: 'Explain the scene', mode: 'ask', modelRouterId: 'default-router' });
  });

  it('filters invalid sessions and strips invalid persisted responses', () => {
    const validSession = appendAgentChatMessage(createAgentChatSession({ meshCount: 1, selectedMeshIds: [], historyCount: 0 }), {
      role: 'assistant',
      text: 'Stale draft',
      response: { kind: 'message', text: 'Valid response' },
      createdAt: '2026-05-15T00:00:00.000Z',
    });
    const storedSession = {
      ...validSession,
      messages: [
        { ...validSession.messages[0], response: { kind: 'actionDraft', action: { type: 'rotateMesh' } } },
        { id: 'tool-1', role: 'tool', text: '已丢弃操作草稿。', createdAt: '2026-05-15T00:00:01.000Z' },
        { id: 'status-1', role: 'status', text: 'Thinking...', createdAt: '2026-05-15T00:00:02.000Z' },
      ],
    };
    const storage = createStorage(JSON.stringify([storedSession, { id: 'missing-required-fields' }]));

    const loaded = loadAgentChatSessions(storage);

    expect(loaded).toHaveLength(1);
    expect(loaded[0].messages).toEqual([
      { id: expect.any(String), role: 'assistant', text: 'Stale draft', createdAt: '2026-05-15T00:00:00.000Z' },
      { id: 'tool-1', role: 'tool', text: '已丢弃操作草稿。', createdAt: '2026-05-15T00:00:01.000Z' },
      { id: 'status-1', role: 'status', text: 'Thinking...', createdAt: '2026-05-15T00:00:02.000Z' },
    ]);
  });

  it('ignores malformed stored JSON and returns an empty array', () => {
    const storage = createStorage('{not valid json');

    expect(loadAgentChatSessions(storage)).toEqual([]);
  });

  it('sorts and bounds upserted sessions', () => {
    const sessions = Array.from({ length: MAX_AGENT_CHAT_SESSIONS }, (_, index) => ({
      ...createAgentChatSession({ meshCount: 0, selectedMeshIds: [], historyCount: 0 }, { title: `Session ${index}` }),
      id: `session-${index}`,
      updatedAt: `2026-05-15T00:${String(index).padStart(2, '0')}:00.000Z`,
    }));
    const newest = {
      ...createAgentChatSession({ meshCount: 0, selectedMeshIds: [], historyCount: 0 }, { title: 'Newest' }),
      id: 'newest-session',
      updatedAt: '2026-05-15T01:00:00.000Z',
    };

    const upserted = upsertAgentChatSession(sessions, newest);

    expect(upserted).toHaveLength(MAX_AGENT_CHAT_SESSIONS);
    expect(upserted[0]).toBe(newest);
    expect(upserted.some((session) => session.id === 'session-0')).toBe(false);
  });

  it('does not throw when localStorage rejects a write', () => {
    const storage = {
      setItem: vi.fn(() => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      }),
    };
    const session = createAgentChatSession({ meshCount: 0, selectedMeshIds: [], historyCount: 0 });

    expect(() => saveAgentChatSessions([session], storage)).not.toThrow();
  });

  it('handles unavailable default localStorage', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => {
        throw new DOMException('Blocked', 'SecurityError');
      },
    });

    try {
      expect(loadAgentChatSessions()).toEqual([]);
      expect(() => saveAgentChatSessions([])).not.toThrow();
    } finally {
      if (descriptor) {
        Object.defineProperty(globalThis, 'localStorage', descriptor);
      }
    }
  });

  it('appends messages, updates updatedAt, derives the first default title, and preserves explicit titles', () => {
    const session: AgentChatSession = {
      ...createAgentChatSession({ meshCount: 0, selectedMeshIds: [], historyCount: 0 }),
      createdAt: '2026-05-15T00:00:00.000Z',
      updatedAt: '2026-05-15T00:00:00.000Z',
    };
    const longText = '   Rotate the selected turbine assembly around the Z axis by exactly 30 degrees   ';

    const updated = appendAgentChatMessage(session, { role: 'user', text: longText });

    expect(updated).not.toBe(session);
    expect(session.messages).toHaveLength(0);
    expect(updated.messages).toHaveLength(1);
    expect(updated.messages[0]).toMatchObject({ role: 'user', text: longText });
    expect(updated.messages[0].id).toEqual(expect.any(String));
    expect(new Date(updated.messages[0].createdAt).toString()).not.toBe('Invalid Date');
    expect(updated.updatedAt).not.toBe(session.updatedAt);
    expect(updated.title).toBe(longText.trim().slice(0, 48));
    expect(updated.title).toHaveLength(48);

    const titledSession: AgentChatSession = { ...session, title: 'Explicit review thread' };
    const titledUpdate = appendAgentChatMessage(titledSession, { role: 'user', text: 'Rename this chat' });

    expect(titledUpdate.title).toBe('Explicit review thread');
  });

  it('summarizes session context from scene and history entries', () => {
    const history: HistoryEntry[] = [
      {
        id: 'act-1',
        command,
        before: { ...scene, selection: ['mesh-1'] },
        after: scene,
        timestamp: '2026-05-15T00:00:00.000Z',
      },
      {
        id: 'act-2',
        command: { ...command, id: 'act-2' },
        before: scene,
        after: { ...scene, selection: ['mesh-2'] },
        timestamp: '2026-05-15T00:01:00.000Z',
      },
    ];

    expect(summarizeSessionContext(scene, history)).toEqual({
      meshCount: 2,
      selectedMeshIds: ['mesh-1', 'mesh-2'],
      historyCount: 2,
    });
  });
});
