# AI Tab Copilot-Style Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the right-panel AI tab into a Copilot-like chat experience with local sessions, Ask/Edit/Agent modes, one end-to-end model router, visible context chips, and preserved 3D operation review gates.

**Architecture:** Add a small frontend chat-session store around localStorage, extend the shared agent request shape with session/mode/router fields, and refactor `AgentPanel` into a chat shell that renders structured agent responses inside the feed. Backend request validation and provider payloads will accept and enforce the new mode/router metadata while preserving compatibility defaults.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, Testing Library, Node test runner, local Node agent API, localStorage.

---

## File Structure

- Create `src/agent/chatSessions.ts`: owns chat session types, localStorage parsing, bounded session persistence, title generation, and message/session helpers.
- Create `src/agent/chatSessions.test.ts`: unit coverage for session creation, persistence, recovery, trimming, and updates.
- Modify `src/domain/protocol.ts`: add `AgentMode`, `ModelRouterId`, request metadata fields, and chat message/session-facing types used by the panel.
- Modify `src/agent/adapters.ts`: keep adapter API stable while sending the expanded request body.
- Modify `src/components/AgentPanel.tsx`: refactor into single-column chat shell, bottom composer, session picker, mode/router controls, inline response cards, and local session persistence.
- Modify `src/components/AgentPanel.test.tsx`: replace old composer assumptions with session, mode/router, feed, context chip, and draft-card behavior tests.
- Modify `src/styles.css`: add the chat shell layout, sticky bottom composer, in-panel history picker, segmented mode control, router select, context chips, and inline response-card styling.
- Modify `backend/agent-api/src/validation.js`: validate/default `sessionId`, `mode`, and `modelRouterId`.
- Modify `backend/agent-api/src/validation.test.js`: cover valid/default/invalid mode and router behavior.
- Modify `backend/agent-api/src/provider.js`: include mode/router in provider payload and add mode-specific prompt guidance.
- Create `backend/agent-api/src/provider.test.js`: unit coverage for provider payload metadata and mode guidance by exporting pure helpers from `provider.js`.
- Modify `scripts/smoke-browser.mjs`: verify new chat creation, sending, draft display, and refresh persistence.
- Modify `.gitignore`: add `.superpowers/` so visual companion artifacts do not remain untracked.
- Modify `docs/superpowers/specs/2026-05-16-ai-tab-copilot-chat-design.md`: prepend solution notes after implementation is complete.

---

### Task 1: Protocol And Backend Request Metadata

**Files:**

- Modify: `src/domain/protocol.ts`
- Modify: `backend/agent-api/src/validation.js`
- Modify: `backend/agent-api/src/validation.test.js`

- [ ] **Step 1: Add failing backend validation tests for metadata defaults**

Append this test to `backend/agent-api/src/validation.test.js`:

```js
test('defaults request mode and model router metadata', () => {
  const parsed = validateAgentRequest({
    id: 'metadata-defaults',
    text: '重置视角',
    scene: request.scene,
    conversation: [],
  });

  assert.equal(parsed.sessionId, undefined);
  assert.equal(parsed.mode, 'edit');
  assert.equal(parsed.modelRouterId, 'default-router');
});
```

- [ ] **Step 2: Add failing backend validation tests for explicit metadata**

Append this test to `backend/agent-api/src/validation.test.js`:

```js
test('preserves valid request session mode and model router metadata', () => {
  const parsed = validateAgentRequest({
    id: 'metadata-explicit',
    sessionId: 'session-abc123',
    text: '解释当前场景',
    mode: 'ask',
    modelRouterId: 'default-router',
    scene: request.scene,
    conversation: [],
  });

  assert.equal(parsed.sessionId, 'session-abc123');
  assert.equal(parsed.mode, 'ask');
  assert.equal(parsed.modelRouterId, 'default-router');
});
```

- [ ] **Step 3: Add failing backend validation tests for invalid metadata**

Append this test to `backend/agent-api/src/validation.test.js`:

```js
test('rejects invalid request mode and model router metadata', () => {
  assert.throws(() => validateAgentRequest({
    id: 'bad-mode',
    text: '解释当前场景',
    mode: 'review',
    scene: request.scene,
    conversation: [],
  }), /mode/);

  assert.throws(() => validateAgentRequest({
    id: 'bad-router',
    text: '解释当前场景',
    modelRouterId: 'other-router',
    scene: request.scene,
    conversation: [],
  }), /modelRouterId/);
});
```

- [ ] **Step 4: Run backend validation tests and confirm failure**

Run:

```bash
npm --prefix backend/agent-api test -- validation.test.js
```

Expected: FAIL because `sessionId`, `mode`, and `modelRouterId` are not returned by `validateAgentRequest` yet.

- [ ] **Step 5: Add protocol types in the frontend**

In `src/domain/protocol.ts`, add these exports near the existing type definitions:

```ts
export const AGENT_MODES = ['ask', 'edit', 'agent'] as const;
export type AgentMode = (typeof AGENT_MODES)[number];

export const MODEL_ROUTER_IDS = ['default-router'] as const;
export type ModelRouterId = (typeof MODEL_ROUTER_IDS)[number];

export type AgentRequestMetadata = {
  sessionId?: string;
  mode: AgentMode;
  modelRouterId: ModelRouterId;
};
```

Update `AgentConversationTurn` to keep the existing role union unchanged. Update `AgentRequest` to include the optional metadata fields:

```ts
export type AgentRequest = {
  id: string;
  sessionId?: string;
  text: string;
  mode?: AgentMode;
  modelRouterId?: ModelRouterId;
  scene: SceneState;
  conversation: AgentConversationTurn[];
  pendingCommand?: OperationCommand | null;
  context?: unknown;
};
```

- [ ] **Step 6: Add backend constants and validation**

In `backend/agent-api/src/validation.js`, add constants near the existing maximum constants:

```js
const AGENT_MODES = ['ask', 'edit', 'agent'];
const MODEL_ROUTER_IDS = ['default-router'];
const DEFAULT_AGENT_MODE = 'edit';
const DEFAULT_MODEL_ROUTER_ID = 'default-router';
```

In `validateAgentRequest`, return the parsed metadata:

```js
  return {
    requestId: optionalString(input.requestId ?? input.id, 'requestId', 128) ?? randomUUID(),
    sessionId: optionalString(input.sessionId, 'sessionId', 160),
    text,
    mode: input.mode === undefined ? DEFAULT_AGENT_MODE : enumValue(input.mode, AGENT_MODES, 'mode'),
    modelRouterId: input.modelRouterId === undefined ? DEFAULT_MODEL_ROUTER_ID : enumValue(input.modelRouterId, MODEL_ROUTER_IDS, 'modelRouterId'),
    scene,
    pendingAction: isRecord(input.pendingAction) ? input.pendingAction : undefined,
    pendingCommand: isRecord(input.pendingCommand) ? input.pendingCommand : undefined,
    conversation: validateConversation(input.conversation ?? input.messages),
  };
```

Keep `pendingAction` for compatibility and add `pendingCommand` because the frontend already sends `pendingCommand`.

- [ ] **Step 7: Run backend validation tests and confirm pass**

Run:

```bash
npm --prefix backend/agent-api test -- validation.test.js
```

Expected: PASS for all validation tests.

- [ ] **Step 8: Commit protocol metadata changes**

```bash
git add src/domain/protocol.ts backend/agent-api/src/validation.js backend/agent-api/src/validation.test.js
git commit -m "feat(agent): add chat request metadata"
```

---

### Task 2: Backend Provider Mode And Router Payload

**Files:**

- Modify: `backend/agent-api/src/provider.js`
- Create: `backend/agent-api/src/provider.test.js`

- [ ] **Step 1: Add provider tests for payload metadata and prompt guidance**

Create `backend/agent-api/src/provider.test.js` with:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProviderPayload, systemPrompt } from './provider.js';

const request = {
  text: '解释当前场景',
  mode: 'ask',
  modelRouterId: 'default-router',
  scene: { meshes: [], selection: [], unit: 'mm', displayMode: 'surface' },
  conversation: [],
};

test('provider payload includes chat mode and model router', () => {
  const payload = buildProviderPayload(request);

  assert.equal(payload.text, '解释当前场景');
  assert.equal(payload.mode, 'ask');
  assert.equal(payload.modelRouterId, 'default-router');
});

test('system prompt includes Ask Edit and Agent mode guidance', () => {
  const prompt = systemPrompt();

  assert.match(prompt, /Ask mode/);
  assert.match(prompt, /Edit mode/);
  assert.match(prompt, /Agent mode/);
  assert.match(prompt, /Ask mode.*sceneAnswer/s);
  assert.match(prompt, /Edit mode.*actionDraft/s);
  assert.match(prompt, /Agent mode.*actionPlan/s);
});
```

- [ ] **Step 2: Run provider tests and confirm failure**

Run:

```bash
npm --prefix backend/agent-api test -- provider.test.js
```

Expected: FAIL because `systemPrompt` and `buildProviderPayload` are not exported and payload does not include metadata.

- [ ] **Step 3: Export provider helpers and include metadata**

In `backend/agent-api/src/provider.js`, change `function systemPrompt()` to:

```js
export function systemPrompt() {
```

Rename `providerPayload` to an exported helper:

```js
export function buildProviderPayload(request) {
  return {
    text: request.text,
    mode: request.mode ?? 'edit',
    modelRouterId: request.modelRouterId ?? 'default-router',
    scene: request.scene,
    conversation: request.conversation,
    schemas: {
      agentResponse: AGENT_RESPONSE_SCHEMA,
      operationCommand: OPERATION_COMMAND_SCHEMA,
      actionRisk: ACTION_RISK_SCHEMA,
    },
  };
}
```

Update the call site in `callLlmProvider`:

```js
{ role: 'user', content: JSON.stringify(buildProviderPayload(request)) },
```

- [ ] **Step 4: Add mode guidance to the prompt**

In `systemPrompt()`, append these strings before the final `join(' ')`:

```js
    'Mode guidance is strict. Ask mode should answer questions about scene metadata, selected objects, operation history, supported capabilities, or pending state. In Ask mode, prefer message, clarification, or sceneAnswer and do not create executable operation drafts.',
    'Edit mode should produce at most one reviewed actionDraft for a concrete scene operation. If the user asks for multiple coordinated steps in Edit mode, ask them to switch to Agent mode.',
    'Agent mode may return actionPlan, macroDraft, or actionDraft, but every operation remains a reviewed draft and must not bypass confirmation.',
```

- [ ] **Step 5: Run backend provider tests and full backend tests**

Run:

```bash
npm --prefix backend/agent-api test -- provider.test.js
npm --prefix backend/agent-api test
```

Expected: PASS for provider tests and existing backend tests.

- [ ] **Step 6: Commit provider payload changes**

```bash
git add backend/agent-api/src/provider.js backend/agent-api/src/provider.test.js
git commit -m "feat(agent): include chat mode in provider payload"
```

---

### Task 3: Frontend Chat Session Store

**Files:**

- Create: `src/agent/chatSessions.ts`
- Create: `src/agent/chatSessions.test.ts`
- Modify: `src/domain/protocol.ts`

- [ ] **Step 1: Add frontend session types**

In `src/domain/protocol.ts`, after `AgentConversationTurn`, add:

```ts
export type AgentSessionContextSummary = {
  workspaceId?: string;
  selectedMeshIds: string[];
  historyEntryCount: number;
  pendingCommandId?: string;
};

export type AgentChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'status';
  text: string;
  createdAt: string;
  response?: AgentResponse;
  request?: {
    text: string;
    mode: AgentMode;
    modelRouterId: ModelRouterId;
  };
};

export type AgentChatSession = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  modelRouterId: ModelRouterId;
  mode: AgentMode;
  messages: AgentChatMessage[];
  contextSnapshot?: AgentSessionContextSummary;
};
```

- [ ] **Step 2: Write failing tests for session creation and title generation**

Create `src/agent/chatSessions.test.ts` with:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { createAgentChatSession, createAgentMessage, deriveSessionTitle } from './chatSessions';

beforeEach(() => localStorage.clear());

describe('chatSessions', () => {
  it('creates an empty edit session with the default model router', () => {
    const session = createAgentChatSession('session-1', '2026-05-16T00:00:00.000Z');

    expect(session).toMatchObject({
      id: 'session-1',
      title: 'New chat',
      createdAt: '2026-05-16T00:00:00.000Z',
      updatedAt: '2026-05-16T00:00:00.000Z',
      mode: 'edit',
      modelRouterId: 'default-router',
      messages: [],
    });
  });

  it('derives compact titles from the first user message', () => {
    expect(deriveSessionTitle('复制选中对象 3 个，沿 X 方向间隔 20mm')).toBe('复制选中对象 3 个，沿 X 方向间隔...');
    expect(deriveSessionTitle('   重置视角   ')).toBe('重置视角');
  });

  it('creates messages with stable request metadata', () => {
    const message = createAgentMessage({
      id: 'message-1',
      role: 'user',
      text: '解释当前场景',
      createdAt: '2026-05-16T00:00:01.000Z',
      request: { text: '解释当前场景', mode: 'ask', modelRouterId: 'default-router' },
    });

    expect(message.request).toEqual({ text: '解释当前场景', mode: 'ask', modelRouterId: 'default-router' });
  });
});
```

- [ ] **Step 3: Run session tests and confirm failure**

Run:

```bash
npm test -- --run src/agent/chatSessions.test.ts
```

Expected: FAIL because `chatSessions.ts` does not exist.

- [ ] **Step 4: Implement session creation helpers**

Create `src/agent/chatSessions.ts` with:

```ts
import type { AgentChatMessage, AgentChatSession, AgentMode, ModelRouterId } from '../domain/protocol';

export const AGENT_CHAT_STORAGE_KEY = 'industrial-simulation.agentChatSessions.v1';
export const MAX_AGENT_CHAT_SESSIONS = 20;
export const DEFAULT_AGENT_MODE: AgentMode = 'edit';
export const DEFAULT_MODEL_ROUTER_ID: ModelRouterId = 'default-router';

export function createAgentChatSession(id = createId('agent-session'), timestamp = new Date().toISOString()): AgentChatSession {
  return {
    id,
    title: 'New chat',
    createdAt: timestamp,
    updatedAt: timestamp,
    modelRouterId: DEFAULT_MODEL_ROUTER_ID,
    mode: DEFAULT_AGENT_MODE,
    messages: [],
  };
}

export function createAgentMessage(message: AgentChatMessage): AgentChatMessage {
  return { ...message };
}

export function deriveSessionTitle(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return 'New chat';
  return compact.length > 24 ? `${compact.slice(0, 24)}...` : compact;
}

export function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
```

- [ ] **Step 5: Run session tests and confirm pass**

Run:

```bash
npm test -- --run src/agent/chatSessions.test.ts
```

Expected: PASS.

- [ ] **Step 6: Add failing tests for load/save/update/trim/recovery**

Append to the `describe` block in `src/agent/chatSessions.test.ts`:

```ts
  it('saves loads and updates sessions', () => {
    const first = createAgentChatSession('session-1', '2026-05-16T00:00:00.000Z');
    const second = createAgentChatSession('session-2', '2026-05-16T00:00:01.000Z');

    saveAgentChatSessions([first, second]);

    expect(loadAgentChatSessions().map((session) => session.id)).toEqual(['session-2', 'session-1']);

    const updated = upsertAgentChatSession(loadAgentChatSessions(), {
      ...first,
      updatedAt: '2026-05-16T00:00:02.000Z',
      title: 'Updated',
    });

    expect(updated.map((session) => session.id)).toEqual(['session-1', 'session-2']);
    expect(updated[0].title).toBe('Updated');
  });

  it('trims saved sessions to the configured maximum', () => {
    const sessions = Array.from({ length: MAX_AGENT_CHAT_SESSIONS + 2 }, (_, index) => createAgentChatSession(
      `session-${index}`,
      `2026-05-16T00:00:${String(index).padStart(2, '0')}.000Z`,
    ));

    saveAgentChatSessions(sessions);

    const loaded = loadAgentChatSessions();
    expect(loaded).toHaveLength(MAX_AGENT_CHAT_SESSIONS);
    expect(loaded[0].id).toBe('session-21');
    expect(loaded.at(-1)?.id).toBe('session-2');
  });

  it('recovers from corrupted localStorage', () => {
    localStorage.setItem(AGENT_CHAT_STORAGE_KEY, '{not valid json');

    expect(loadAgentChatSessions()).toEqual([]);
  });
```

Update imports at the top:

```ts
import {
  AGENT_CHAT_STORAGE_KEY,
  MAX_AGENT_CHAT_SESSIONS,
  createAgentChatSession,
  createAgentMessage,
  deriveSessionTitle,
  loadAgentChatSessions,
  saveAgentChatSessions,
  upsertAgentChatSession,
} from './chatSessions';
```

- [ ] **Step 7: Run session tests and confirm failure**

Run:

```bash
npm test -- --run src/agent/chatSessions.test.ts
```

Expected: FAIL because persistence helpers are missing.

- [ ] **Step 8: Implement persistence helpers**

Append to `src/agent/chatSessions.ts`:

```ts
export function loadAgentChatSessions(storage: Storage = window.localStorage): AgentChatSession[] {
  const raw = storage.getItem(AGENT_CHAT_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return sortAndTrimSessions(parsed.filter(isAgentChatSession));
  } catch {
    return [];
  }
}

export function saveAgentChatSessions(sessions: AgentChatSession[], storage: Storage = window.localStorage): AgentChatSession[] {
  const next = sortAndTrimSessions(sessions);
  storage.setItem(AGENT_CHAT_STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function upsertAgentChatSession(sessions: AgentChatSession[], session: AgentChatSession): AgentChatSession[] {
  return sortAndTrimSessions([session, ...sessions.filter((item) => item.id !== session.id)]);
}

export function sortAndTrimSessions(sessions: AgentChatSession[]): AgentChatSession[] {
  return [...sessions]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, MAX_AGENT_CHAT_SESSIONS);
}

function isAgentChatSession(value: unknown): value is AgentChatSession {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || typeof value.title !== 'string') return false;
  if (typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') return false;
  if (!['ask', 'edit', 'agent'].includes(String(value.mode))) return false;
  if (value.modelRouterId !== DEFAULT_MODEL_ROUTER_ID) return false;
  if (!Array.isArray(value.messages)) return false;
  return value.messages.every(isAgentChatMessage);
}

function isAgentChatMessage(value: unknown): value is AgentChatMessage {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || typeof value.text !== 'string' || typeof value.createdAt !== 'string') return false;
  return ['user', 'assistant', 'tool', 'status'].includes(String(value.role));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
```

- [ ] **Step 9: Run session tests and lint**

Run:

```bash
npm test -- --run src/agent/chatSessions.test.ts
npm run lint
```

Expected: PASS for the session tests and TypeScript lint.

- [ ] **Step 10: Commit session store changes**

```bash
git add src/domain/protocol.ts src/agent/chatSessions.ts src/agent/chatSessions.test.ts
git commit -m "feat(agent): add local chat sessions"
```

---

### Task 4: AgentPanel Session Requests And Inline Feed State

**Files:**

- Modify: `src/components/AgentPanel.tsx`
- Modify: `src/components/AgentPanel.test.tsx`

- [ ] **Step 1: Add failing test for session metadata in requests**

Append this test to `src/components/AgentPanel.test.tsx`:

```tsx
  it('sends session mode and model router metadata with agent requests', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(actionDraft), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    localStorage.clear();

    render(
      <AgentPanel
        scene={createInitialScene()}
        selectedMeshes={[]}
        historyEntries={[]}
        pendingCommand={null}
        onExecute={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    fireEvent.change(screen.getByLabelText('AI 指令输入'), { target: { value: '解释当前场景' } });
    fireEvent.click(screen.getByRole('button', { name: '发送指令' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));

    expect(requestBody.sessionId).toMatch(/^agent-session-/);
    expect(requestBody.mode).toBe('ask');
    expect(requestBody.modelRouterId).toBe('default-router');
  });
```

- [ ] **Step 2: Add failing test for New Chat and persisted history**

Append this test to `src/components/AgentPanel.test.tsx`:

```tsx
  it('creates new sessions and reopens prior chat history', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(actionDraft), { status: 200 })));
    localStorage.clear();

    render(
      <AgentPanel
        scene={createInitialScene()}
        selectedMeshes={[]}
        historyEntries={[]}
        pendingCommand={null}
        onExecute={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('AI 指令输入'), { target: { value: '把当前对象绕 Z 轴旋转 30 度' } });
    fireEvent.click(screen.getByRole('button', { name: '发送指令' }));

    expect(await screen.findByText(/旋转对象/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '新建聊天' }));
    expect(screen.queryByText('把当前对象绕 Z 轴旋转 30 度')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '历史会话' }));
    fireEvent.click(screen.getByRole('button', { name: /把当前对象绕 Z 轴旋转/ }));

    expect(screen.getByText('把当前对象绕 Z 轴旋转 30 度')).toBeInTheDocument();
  });
```

- [ ] **Step 3: Run AgentPanel tests and confirm failure**

Run:

```bash
npm test -- --run src/components/AgentPanel.test.tsx
```

Expected: FAIL because session controls and metadata requests are not implemented.

- [ ] **Step 4: Import session helpers and initialize sessions**

At the top of `src/components/AgentPanel.tsx`, update imports:

```ts
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Bot, Check, ChevronDown, ChevronRight, History, MessageSquarePlus, Play, Sparkles, Square, X } from 'lucide-react';
import {
  createAgentChatSession,
  createAgentMessage,
  deriveSessionTitle,
  loadAgentChatSessions,
  saveAgentChatSessions,
  upsertAgentChatSession,
} from '../agent/chatSessions';
import type { AgentChatMessage, AgentChatSession, AgentMode, ModelRouterId } from '../domain/protocol';
```

Keep the existing `AgentResponse`, `AgentConversationTurn`, `AgentPlanStep`, and `ActionRisk` protocol imports in the same import block as the new protocol types.

Inside `AgentPanel`, add state:

```ts
  const initialSessions = useMemo(() => loadAgentChatSessions(), []);
  const initialSession = useMemo(() => initialSessions[0] ?? createAgentChatSession(), [initialSessions]);
  const [sessions, setSessions] = useState<AgentChatSession[]>(() => initialSessions.length > 0 ? initialSessions : [initialSession]);
  const [activeSessionId, setActiveSessionId] = useState(initialSession.id);
  const [historyOpen, setHistoryOpen] = useState(false);
```

Add derived active session:

```ts
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? sessions[0] ?? initialSession;
  const conversation = activeSession.messages.map(messageToConversationTurn);
```

Remove the old `const [conversation, setConversation] = useState<AgentConversationTurn[]>([]);`.

- [ ] **Step 5: Add session update helpers**

Inside `AgentPanel`, before `sendRequest`, add:

```ts
  const persistSessions = (nextSessions: AgentChatSession[]) => {
    const saved = saveAgentChatSessions(nextSessions);
    setSessions(saved.length > 0 ? saved : [createAgentChatSession()]);
  };

  const updateActiveSession = (updater: (session: AgentChatSession) => AgentChatSession) => {
    const updated = updater(activeSession);
    persistSessions(upsertAgentChatSession(sessions, updated));
    setActiveSessionId(updated.id);
    return updated;
  };

  const appendMessages = (messages: AgentChatMessage[]) => {
    updateActiveSession((session) => {
      const nextMessages = [...session.messages, ...messages];
      const firstUserMessage = nextMessages.find((message) => message.role === 'user');
      return {
        ...session,
        title: session.title === 'New chat' && firstUserMessage ? deriveSessionTitle(firstUserMessage.text) : session.title,
        updatedAt: new Date().toISOString(),
        messages: nextMessages,
      };
    });
  };

  const startNewChat = () => {
    const next = createAgentChatSession();
    persistSessions([next, ...sessions]);
    setActiveSessionId(next.id);
    setHistoryOpen(false);
    setResponse(null);
    setError(null);
    setDebugOpen(false);
    setPlanStatuses({});
  };

  const setSessionMode = (mode: AgentMode) => {
    updateActiveSession((session) => ({ ...session, mode, updatedAt: new Date().toISOString() }));
  };

  const setSessionModelRouter = (modelRouterId: ModelRouterId) => {
    updateActiveSession((session) => ({ ...session, modelRouterId, updatedAt: new Date().toISOString() }));
  };
```

Add helper function near the bottom of the file:

```ts
function messageToConversationTurn(message: AgentChatMessage): AgentConversationTurn {
  return { id: message.id, role: message.role === 'status' ? 'tool' : message.role, text: message.text, timestamp: message.createdAt };
}
```

- [ ] **Step 6: Update request sending to append messages and metadata**

In `sendRequest`, replace direct `setConversation` calls with `appendMessages`.

Create user message:

```ts
    const now = new Date().toISOString();
    const userMessage = createAgentMessage({
      id: createId('user'),
      role: 'user',
      text: prompt,
      createdAt: now,
      request: { text: prompt, mode: activeSession.mode, modelRouterId: activeSession.modelRouterId },
    });
    const nextConversation = [...conversation, messageToConversationTurn(userMessage)];
```

Append it:

```ts
    appendMessages([userMessage]);
```

Send metadata in the adapter request:

```ts
      const next = await adapter.respond({
        id: createId('agent-request'),
        sessionId: activeSession.id,
        text: prompt,
        mode: activeSession.mode,
        modelRouterId: activeSession.modelRouterId,
        scene,
        conversation: nextConversation.slice(-8),
        pendingCommand,
        context: buildAgentContext(scene, historyEntries),
      }, { signal: controller.signal });
```

Append assistant message with structured response:

```ts
      appendMessages([createAgentMessage({
        id: createId('assistant'),
        role: 'assistant',
        text: conversationSummary(validated.value),
        createdAt: new Date().toISOString(),
        response: validated.value,
      })]);
```

For cancellation append:

```ts
appendMessages([createAgentMessage({ id: createId('status'), role: 'status', text: '请求已取消。', createdAt: new Date().toISOString() })]);
```

For errors append:

```ts
const errorMessage = nextError instanceof Error ? nextError.message : 'Agent 请求失败。';
setError(errorMessage);
appendMessages([createAgentMessage({ id: createId('status'), role: 'status', text: `请求失败：${errorMessage}`, createdAt: new Date().toISOString() })]);
```

- [ ] **Step 7: Update discard and execution message appends**

In `discardDraft`, replace `setConversation` with:

```ts
    appendMessages([createAgentMessage({ id: createId('status'), role: 'status', text: '已丢弃操作草稿。', createdAt: new Date().toISOString() })]);
```

In `executeDraft`, replace `setConversation` with:

```ts
    appendMessages([createAgentMessage({ id: createId('status'), role: 'status', text: result.message, createdAt: new Date().toISOString() })]);
```

In `executePlan`, replace both `setConversation` calls with `appendMessages` using the same message shape.

- [ ] **Step 8: Add header controls and history picker markup**

At the top of the returned JSX inside `.agent-review-surface`, add:

```tsx
      <section className="agent-chat-header" aria-label="AI chat session controls">
        <div className="agent-chat-title">
          <strong>{activeSession.title}</strong>
          <span>{statusLabel(status)}</span>
        </div>
        <div className="agent-chat-header-actions">
          <button type="button" className="icon-button" aria-label="新建聊天" title="新建聊天" onClick={startNewChat}>
            <MessageSquarePlus size={15} aria-hidden="true" />
          </button>
          <button type="button" aria-label="历史会话" aria-expanded={historyOpen} onClick={() => setHistoryOpen((open) => !open)}>
            <History size={15} aria-hidden="true" /> History
          </button>
        </div>
      </section>
      {historyOpen ? <SessionPicker sessions={sessions} activeSessionId={activeSession.id} onOpen={(sessionId) => { setActiveSessionId(sessionId); setHistoryOpen(false); }} /> : null}
```

Add `SessionPicker` helper below `SelectionPills`:

```tsx
function SessionPicker({ sessions, activeSessionId, onOpen }: { sessions: AgentChatSession[]; activeSessionId: string; onOpen: (sessionId: string) => void }) {
  return (
    <section className="agent-session-picker" aria-label="AI chat history">
      {sessions.map((session) => (
        <button key={session.id} type="button" className={session.id === activeSessionId ? 'active' : ''} onClick={() => onOpen(session.id)}>
          <strong>{session.title}</strong>
          <span>{session.messages.length} messages</span>
        </button>
      ))}
    </section>
  );
}
```

Add `statusLabel` near helper functions:

```ts
function statusLabel(status: AgentStatus): string {
  if (status === 'loading') return 'Generating';
  if (status === 'error') return 'Error';
  if (status === 'cancelled') return 'Cancelled';
  if (status === 'ready') return 'Ready';
  return 'Idle';
}
```

- [ ] **Step 9: Add mode and router controls markup**

Above the prompt card, add:

```tsx
      <section className="agent-chat-controls" aria-label="AI chat controls">
        <label className="agent-router-select">
          <span>Model Router</span>
          <select aria-label="模型 router" value={activeSession.modelRouterId} onChange={(event) => setSessionModelRouter(event.target.value as ModelRouterId)}>
            <option value="default-router">Default router</option>
          </select>
        </label>
        <div className="agent-mode-segments" role="group" aria-label="AI mode">
          {(['ask', 'edit', 'agent'] as const).map((mode) => (
            <button key={mode} type="button" className={activeSession.mode === mode ? 'active' : ''} onClick={() => setSessionMode(mode)}>
              {modeLabel(mode)}
            </button>
          ))}
        </div>
      </section>
```

Add helper:

```ts
function modeLabel(mode: AgentMode): string {
  if (mode === 'ask') return 'Ask';
  if (mode === 'agent') return 'Agent';
  return 'Edit';
}
```

- [ ] **Step 10: Run AgentPanel tests and lint**

Run:

```bash
npm test -- --run src/components/AgentPanel.test.tsx
npm run lint
```

Expected: PASS for AgentPanel tests and TypeScript lint. Update the two existing tests named `uses a compact send control and removes retry, stop, and parse-review actions` and `places the model chip and send button in a footer below the full-width prompt input` so they assert the new `.agent-composer`, `AI composer` region, and `Default router` label instead of the old `.agent-prompt-footer` layout.

- [ ] **Step 11: Commit AgentPanel session request changes**

```bash
git add src/components/AgentPanel.tsx src/components/AgentPanel.test.tsx
git commit -m "feat(agent): add chat sessions to AI panel"
```

---

### Task 5: Chat Shell Layout, Context Chips, And Inline Draft Cards

**Files:**

- Modify: `src/components/AgentPanel.tsx`
- Modify: `src/components/AgentPanel.test.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Add failing tests for bottom composer and starter suggestions**

Append to `src/components/AgentPanel.test.tsx`:

```tsx
  it('renders starter suggestions only for an empty session and uses a bottom composer surface', () => {
    localStorage.clear();
    render(
      <AgentPanel
        scene={createInitialScene()}
        selectedMeshes={[]}
        historyEntries={[]}
        pendingCommand={null}
        onExecute={vi.fn()}
      />,
    );

    expect(screen.getByRole('region', { name: 'AI composer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '把当前对象绕 Z 轴旋转 30 度' })).toBeInTheDocument();
    expect(document.querySelector('.agent-composer')).toContainElement(screen.getByLabelText('AI 指令输入'));
  });
```

- [ ] **Step 2: Add failing test for context chips**

Append to `src/components/AgentPanel.test.tsx`:

```tsx
  it('shows context chips for selection history and pending draft', () => {
    const mesh = createMesh('fan-stage', 'Blue titanium fan stage', true);
    render(
      <AgentPanel
        scene={createInitialScene([mesh])}
        selectedMeshes={[mesh]}
        historyEntries={[{ id: 'h1', command: actionDraft.action, before: createInitialScene([mesh]), after: createInitialScene([mesh]), timestamp: '2026-05-16T00:00:00.000Z' }]}
        pendingCommand={actionDraft.action}
        onExecute={vi.fn()}
      />,
    );

    expect(screen.getByText('Blue titanium fan stage')).toBeInTheDocument();
    expect(screen.getByText('1 history')).toBeInTheDocument();
    expect(screen.getByText('Pending draft')).toBeInTheDocument();
  });
```

- [ ] **Step 3: Run tests and confirm failure**

Run:

```bash
npm test -- --run src/components/AgentPanel.test.tsx
```

Expected: FAIL because the composer region, starter suggestion behavior, and new chips are not wired.

- [ ] **Step 4: Render context chips inside the composer**

Replace the current prompt card at the top with a bottom composer section after the feed and response view:

```tsx
      <section className="agent-composer" aria-label="AI composer">
        <ContextChips selectedMeshes={selectedMeshes} historyCount={historyEntries.length} pendingCommand={pendingCommand} />
        <textarea
          id="agent-command-input"
          aria-label="AI 指令输入"
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={3}
          placeholder={composerPlaceholder(activeSession.mode)}
        />
        <div className="agent-composer-footer">
          <span className="agent-mode-chip">{modeLabel(activeSession.mode)} · Default router</span>
          <button
            type="button"
            className={`agent-send-button ${status === 'loading' ? 'is-stopping' : ''}`}
            disabled={status !== 'loading' && !text.trim()}
            aria-label={status === 'loading' ? '停止生成' : '发送指令'}
            title={status === 'loading' ? '停止当前请求；如果已编辑提示词则重新发送' : '发送指令'}
            onClick={() => void sendRequest()}
          >
            {status === 'loading' ? <Square size={15} aria-hidden="true" /> : <ArrowUp size={21} aria-hidden="true" strokeWidth={2.4} />}
          </button>
        </div>
      </section>
```

Add helpers:

```tsx
function ContextChips({ selectedMeshes, historyCount, pendingCommand }: { selectedMeshes: MeshEntity[]; historyCount: number; pendingCommand: OperationCommand | null }) {
  return (
    <div className="agent-context-chips" aria-label="AI context attachments">
      <SelectionPills selectedMeshes={selectedMeshes} />
      <span className="agent-selection-pill summary">Scene</span>
      <span className="agent-selection-pill muted">{historyCount} history</span>
      {pendingCommand ? <span className="agent-selection-pill summary">Pending draft</span> : null}
    </div>
  );
}

function composerPlaceholder(mode: AgentMode): string {
  if (mode === 'ask') return '询问当前场景、对象或操作历史';
  if (mode === 'agent') return '描述需要规划的多步 3D 操作';
  return '描述要审阅的 3D 操作';
}
```

Keep `SelectionPills` but let it render inside `ContextChips`.

- [ ] **Step 5: Render starter suggestions only for empty sessions**

Replace the always-visible example prompt row with:

```tsx
      {activeSession.messages.length === 0 ? (
        <div className="agent-starter-suggestions" aria-label="Starter prompts">
          {examples.map((example) => (
            <button key={example} disabled={status === 'loading'} onClick={() => void sendRequest(example)}>{example}</button>
          ))}
        </div>
      ) : null}
```

Place this above the conversation feed.

- [ ] **Step 6: Render structured responses from messages inside the feed**

Update `ConversationFeed` signature:

```tsx
function ConversationFeed({ messages, loading }: { messages: AgentChatMessage[]; loading: boolean }) {
```

Render each message and response:

```tsx
      {messages.map((message) => (
        <div key={message.id} className={`agent-message ${message.role === 'status' ? 'tool' : message.role}`}>
          <span className="agent-message-role">{message.role === 'user' ? 'You' : message.role === 'assistant' ? 'Assistant' : 'Status'}</span>
          <div className="agent-message-content">
            <p>{message.text}</p>
            {message.response ? <AgentResponseView response={message.response} debugOpen={false} planStatuses={{}} onToggleDebug={() => undefined} onDiscardDraft={() => undefined} onExecuteDraft={() => undefined} onExecutePlan={() => undefined} pendingCommand={null} historical /> : null}
          </div>
        </div>
      ))}
```

Add `historical?: boolean` to `AgentResponseView` props. When `historical` is true, keep JSON hidden and disable/omit confirm and discard actions:

```tsx
  historical = false,
```

In response action sections, wrap buttons:

```tsx
{historical ? (
  <span className="agent-historical-note">历史草稿仅供查看</span>
) : (
  <div className="agent-review-actions">
    <button onClick={onDiscardDraft}>
      <X size={15} /> 丢弃草稿
    </button>
    <button onClick={onToggleDebug} aria-expanded={debugOpen}>
      {debugOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />} JSON
    </button>
    <button className="primary-button" onClick={() => (pendingMatchesDraft ? onConfirmPending?.() : onExecuteDraft(response.action))} disabled={pendingMatchesDraft && !onConfirmPending}>
      {pendingMatchesDraft ? <Check size={15} /> : <Sparkles size={15} />} {pendingMatchesDraft ? '确认应用' : '确认执行'}
    </button>
  </div>
)}
```

Remove the standalone `AgentResponseView` call below `ConversationFeed`. The newest assistant message stores the active `response`, and `ConversationFeed` is responsible for rendering that response card exactly once.

- [ ] **Step 7: Add chat shell CSS**

Append to `src/styles.css` near the existing agent styles:

```css
.agent-review-surface {
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  gap: 10px;
  overflow: hidden;
}

.agent-chat-header,
.agent-chat-controls,
.agent-composer,
.agent-session-picker {
  border: 1px solid #273341;
  border-radius: 8px;
  background: #101720;
}

.agent-chat-header {
  min-height: 42px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 8px;
}

.agent-chat-title {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.agent-chat-title strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-chat-title span {
  color: #8fa3b8;
  font-size: 11px;
}

.agent-chat-header-actions,
.agent-mode-segments,
.agent-composer-footer {
  display: flex;
  align-items: center;
  gap: 6px;
}

.agent-chat-controls {
  display: grid;
  gap: 8px;
  padding: 8px;
}

.agent-router-select {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  color: #9cafc4;
  font-size: 12px;
}

.agent-router-select select {
  min-width: 0;
  height: 30px;
}

.agent-mode-segments {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
}

.agent-mode-segments button {
  min-width: 0;
  min-height: 30px;
  border-radius: 6px;
}

.agent-session-picker {
  padding: 8px;
  display: grid;
  gap: 6px;
}

.agent-session-picker button {
  width: 100%;
  min-width: 0;
  justify-content: space-between;
}

.agent-session-picker button strong,
.agent-session-picker button span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-starter-suggestions {
  display: grid;
  gap: 8px;
}

.agent-starter-suggestions button {
  justify-content: flex-start;
  text-align: left;
  white-space: normal;
  line-height: 1.25;
}

.agent-conversation-feed {
  min-height: 0;
  overflow: auto;
}

.agent-message-content {
  min-width: 0;
  display: grid;
  gap: 8px;
}

.agent-composer {
  padding: 8px;
  display: grid;
  gap: 8px;
}

.agent-context-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.agent-composer textarea {
  width: 100%;
  min-height: 72px;
  max-height: 180px;
  resize: vertical;
  border-color: #2b6f90;
  background: #0b1118;
}

.agent-composer-footer {
  justify-content: space-between;
}

.agent-historical-note {
  color: #8fa3b8;
  font-size: 12px;
}
```

- [ ] **Step 8: Run panel tests and lint**

Run:

```bash
npm test -- --run src/components/AgentPanel.test.tsx
npm run lint
```

Expected: PASS. Inspect the rendered panel manually if CSS grid causes the composer to scroll away.

- [ ] **Step 9: Commit layout changes**

```bash
git add src/components/AgentPanel.tsx src/components/AgentPanel.test.tsx src/styles.css
git commit -m "feat(agent): redesign AI tab chat layout"
```

---

### Task 6: Mode-Specific Frontend Guardrails

**Files:**

- Modify: `src/components/AgentPanel.tsx`
- Modify: `src/components/AgentPanel.test.tsx`

- [ ] **Step 1: Add failing tests for Ask and Edit mismatch handling**

Append to `src/components/AgentPanel.test.tsx`:

```tsx
  it('does not execute action drafts returned while in Ask mode', async () => {
    const execute = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(actionDraft), { status: 200 })));
    localStorage.clear();

    render(
      <AgentPanel
        scene={createInitialScene()}
        selectedMeshes={[]}
        historyEntries={[]}
        pendingCommand={null}
        onExecute={execute}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    fireEvent.change(screen.getByLabelText('AI 指令输入'), { target: { value: '把当前对象绕 Z 轴旋转 30 度' } });
    fireEvent.click(screen.getByRole('button', { name: '发送指令' }));

    expect(await screen.findByText(/Ask 模式/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /确认执行|确认应用/ })).not.toBeInTheDocument();
    expect(execute).not.toHaveBeenCalled();
  });

  it('asks users to switch to Agent mode when Edit receives a plan', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      kind: 'actionPlan',
      steps: [{ id: 'step-1', title: '重置视角', action: actionDraft.action }],
      explanation: 'Plan response',
      risk: actionDraft.risk,
    }), { status: 200 })));
    localStorage.clear();

    render(
      <AgentPanel
        scene={createInitialScene()}
        selectedMeshes={[]}
        historyEntries={[]}
        pendingCommand={null}
        onExecute={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('AI 指令输入'), { target: { value: '先旋转再重置视角' } });
    fireEvent.click(screen.getByRole('button', { name: '发送指令' }));

    expect(await screen.findByText(/请切换到 Agent 模式/)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
npm test -- --run src/components/AgentPanel.test.tsx
```

Expected: FAIL because mode mismatch handling is not implemented.

- [ ] **Step 3: Add response guard helper**

In `src/components/AgentPanel.tsx`, add:

```ts
function responseAllowedInMode(mode: AgentMode, response: AgentResponse): true | string {
  if (mode === 'ask' && (response.kind === 'actionDraft' || response.kind === 'actionPlan' || response.kind === 'macroDraft')) {
    return 'Ask 模式只回答场景和能力问题；请切换到 Edit 或 Agent 模式来生成操作草稿。';
  }
  if (mode === 'edit' && (response.kind === 'actionPlan' || response.kind === 'macroDraft')) {
    return 'Edit 模式一次只生成一个操作草稿；请切换到 Agent 模式来规划多步操作。';
  }
  return true;
}
```

In `sendRequest`, after validation and before `setResponse`:

```ts
      const modeCheck = responseAllowedInMode(activeSession.mode, validated.value);
      if (modeCheck !== true) {
        appendMessages([createAgentMessage({ id: createId('status'), role: 'status', text: modeCheck, createdAt: new Date().toISOString() })]);
        setStatus('ready');
        return;
      }
```

- [ ] **Step 4: Run mode guard tests**

Run:

```bash
npm test -- --run src/components/AgentPanel.test.tsx
```

Expected: PASS for the mode guard tests and existing panel tests.

- [ ] **Step 5: Commit mode guardrails**

```bash
git add src/components/AgentPanel.tsx src/components/AgentPanel.test.tsx
git commit -m "feat(agent): enforce AI chat modes"
```

---

### Task 7: Browser Smoke And Git Hygiene

**Files:**

- Modify: `scripts/smoke-browser.mjs`
- Modify: `.gitignore`
- Modify: `docs/superpowers/specs/2026-05-16-ai-tab-copilot-chat-design.md`

- [ ] **Step 1: Ignore visual companion artifacts**

Add this line to `.gitignore`:

```gitignore
.superpowers/
```

- [ ] **Step 2: Update browser smoke AI selectors**

In `scripts/smoke-browser.mjs`, inside the `smokeResult` page evaluation before sending the prompt, add checks for the new chat controls:

```js
    const newChatButton = [...document.querySelectorAll('button')].find((button) => button.getAttribute('aria-label') === '新建聊天');
    if (!(newChatButton instanceof HTMLButtonElement)) {
      throw new Error('New chat button not found');
    }
    newChatButton.click();
    await new Promise((resolve) => setTimeout(resolve, 80));

    const modeButtons = [...document.querySelectorAll('.agent-mode-segments button')].map((button) => button.textContent?.trim());
    const hasModeSegments = modeButtons.includes('Ask') && modeButtons.includes('Edit') && modeButtons.includes('Agent');
    const routerSelect = document.querySelector('select[aria-label="模型 router"]');
    const hasRouterSelect = routerSelect instanceof HTMLSelectElement && routerSelect.value === 'default-router';
```

After the existing AI send/confirm checks, add localStorage persistence checks:

```js
    const storedSessionsBeforeReload = JSON.parse(localStorage.getItem('industrial-simulation.agentChatSessions.v1') || '[]');
    const hasStoredAiSession = storedSessionsBeforeReload.some((session) => session.messages?.some((message) => message.text?.includes('把当前对象绕 Z 轴旋转 30 度')));
    location.reload();
    await new Promise((resolve) => setTimeout(resolve, 600));
    const restoredSessionVisible = document.body.innerText.includes('把当前对象绕 Z 轴旋转 30 度');
```

In the existing `return { ... }` object at the end of the page evaluation function, add these four properties before `hasCanvas`:

```js
  hasModeSegments,
  hasRouterSelect,
  hasStoredAiSession,
  restoredSessionVisible,
```

Add them to the failure condition:

```js
    || !smokeResult.hasModeSegments
    || !smokeResult.hasRouterSelect
    || !smokeResult.hasStoredAiSession
    || !smokeResult.restoredSessionVisible
```

Keep all existing canvas, panel, resize, and view scale checks.

- [ ] **Step 3: Run focused and full verification**

Run:

```bash
npm run lint
npm test -- --run
npm --prefix backend/agent-api test
npm run build
npm run smoke:browser
```

Expected: all commands PASS. If `npm run smoke:browser` cannot connect to the dev server, start the existing VS Code task `dev: industrial simulation workbench` and rerun only `npm run smoke:browser`.

- [ ] **Step 4: Prepend solution notes to the spec**

At the top of `docs/superpowers/specs/2026-05-16-ai-tab-copilot-chat-design.md`, above `# AI Tab Copilot-Style Chat Redesign`, add:

```md
# Solution

## Summary

Implemented the AI tab as a Copilot-like chat shell with local chat sessions, bottom composer, history reopening, Ask/Edit/Agent modes, one end-to-end model router, visible context chips, inline structured response cards, and backend request metadata validation.

## Changed Files

- `src/domain/protocol.ts`: added chat mode, model router, session, and message types.
- `src/agent/chatSessions.ts`: added localStorage-backed session persistence helpers.
- `src/agent/chatSessions.test.ts`: covered session creation, persistence, trimming, and corrupted storage recovery.
- `src/components/AgentPanel.tsx`: refactored the AI tab into the chat shell and wired sessions, controls, context chips, and inline response cards.
- `src/components/AgentPanel.test.tsx`: covered chat sessions, request metadata, mode/router controls, context chips, and draft behavior.
- `src/styles.css`: added AI chat shell layout and composer/session picker styling.
- `backend/agent-api/src/validation.js`: validated/defaulted request session, mode, and router metadata.
- `backend/agent-api/src/validation.test.js`: covered metadata defaults and invalid values.
- `backend/agent-api/src/provider.js`: included mode/router in provider payload and prompt guidance.
- `backend/agent-api/src/provider.test.js`: covered provider metadata and mode guidance.
- `scripts/smoke-browser.mjs`: updated smoke coverage for the new chat flow and persisted sessions.
- `.gitignore`: ignored `.superpowers/` visual companion artifacts.

## Verification

- `npm run lint`: passed.
- `npm test -- --run`: passed.
- `npm --prefix backend/agent-api test`: passed.
- `npm run build`: passed.
- `npm run smoke:browser`: passed.

## Follow-Ups

- Backend session CRUD and project-local storage.
- Model/router discovery endpoint for multiple routers.
- Slash commands, prompt shortcuts, and explicit attach/detach controls.
- Message-level retry, copy, edit/resend, delete, and branch-from-message.
- User-editable session titles.

---
```

If any verification command is skipped or fails due to an existing unrelated issue, record that exact result instead of the `passed` line.

- [ ] **Step 5: Commit smoke and documentation updates**

```bash
git add .gitignore scripts/smoke-browser.mjs docs/superpowers/specs/2026-05-16-ai-tab-copilot-chat-design.md
git commit -m "test(agent): verify AI chat sessions"
```

---

## Self-Review Checklist

- Spec coverage: This plan covers bottom composer, single-column chat shell, new/history sessions, localStorage persistence, future-compatible session data, Ask/Edit/Agent modes, one real model router, request protocol metadata, backend validation/payload, context chips, preserved draft review gates, mode mismatch handling, tests, smoke, and solution documentation.
- Scope control: Backend session CRUD, multiple routers, slash commands, message editing, message branching, explicit context attach/detach, and editable session titles remain follow-ups.
- Type consistency: The plan uses `AgentMode`, `ModelRouterId`, `AgentChatSession`, `AgentChatMessage`, `AgentSessionContextSummary`, `sessionId`, `mode`, and `modelRouterId` consistently across protocol, session store, panel, and backend request validation.
- Verification: Each task includes a failing-test step, an implementation step, a pass step, and a commit step. The final task runs frontend lint/tests, backend tests, build, and browser smoke.
