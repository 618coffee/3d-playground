# AI Tab Copilot-Style Chat Redesign

## Solution

### Summary

Implemented the AI tab as a Copilot-like chat shell with local chat sessions, bottom composer, history reopening, Ask/Edit/Agent modes, one end-to-end model router, visible context chips, inline structured response cards, frontend mode guardrails, and backend request metadata validation.

### Changed Files

- `src/domain/protocol.ts`: added chat mode, model router, session, and message types.
- `src/agent/chatSessions.ts`: added localStorage-backed session persistence helpers.
- `src/agent/chatSessions.test.ts`: covered session creation, persistence, malformed storage recovery, trimming, request metadata, and response sanitization.
- `src/components/AgentPanel.tsx`: refactored the AI tab into the chat shell and wired sessions, controls, context chips, inline response cards, persisted history, and mode guardrails.
- `src/components/AgentPanel.test.tsx`: covered chat sessions, request metadata, mode/router controls, context chips, inline draft cards, draft review gates, and mode mismatch behavior.
- `src/styles.css`: added AI chat shell layout, feed, composer, context chip, session picker, and inline response-card styling.
- `backend/agent-api/src/validation.js`: validated/defaulted request session, mode, and router metadata.
- `backend/agent-api/src/validation.test.js`: covered metadata defaults, explicit values, and invalid values.
- `backend/agent-api/src/provider.js`: included mode/router in provider payload and prompt guidance.
- `backend/agent-api/src/provider.test.js`: covered provider metadata and mode guidance.
- `scripts/smoke-browser.mjs`: updated smoke coverage for the new chat controls and persisted sessions.
- `.gitignore`: ignored `.superpowers/` visual companion artifacts.

### Verification

- `npm run lint`: passed.
- `npm test -- --run`: passed, 12 files and 88 tests.
- `npm --prefix backend/agent-api test`: passed, 14 tests.
- `npm run build`: passed.
- `npm run smoke:browser`: passed.

### Implementation Follow-Ups

- Backend session CRUD and project-local storage.
- Model/router discovery endpoint for multiple routers.
- Slash commands, prompt shortcuts, and explicit attach/detach controls.
- Message-level retry, copy, edit/resend, delete, and branch-from-message.
- User-editable session titles.

---

## Status

Implemented.

## Context

The backend agent flow is now capable enough to process user requests and produce reviewed 3D operation drafts. The current AI tab still feels closer to a command parser: the prompt is at the top, conversation state only lives in the React component, sessions are not persisted, and model/mode controls are not represented as first-class workflow choices.

The requested direction is a GitHub Copilot Chat-like experience inside the right inspector panel: a bottom composer, model selection, agent mode selection, new chat sessions, saved history, reopening old sessions, and continuing previous conversations. The first implementation should focus on the AI tab rather than redesigning the whole application.

## Design Goals

- Make the AI tab feel like a chat-first assistant that can operate the 3D scene with review gates.
- Use a single-column layout that fits the current narrow right panel.
- Move the request composer to the bottom of the AI tab.
- Add new chat and history session workflows.
- Persist chat sessions locally in the browser for the first pass.
- Shape session data so backend persistence can replace local storage later.
- Add real request fields for session id, mode, and model router id.
- Support one end-to-end selectable model router in the first pass.
- Add Ask, Edit, and Agent modes with clear behavior boundaries.
- Preserve the existing operation draft, preview, confirmation, cancellation, and JSON review flows.
- Keep context attachments visible so users know what the assistant is using.
- Defer slash commands and complex message actions until after the core experience is stable.

## Chosen Approach

Use a Copilot-like chat shell with lightweight protocol expansion.

The frontend owns the first version of sessions through localStorage, while request/session types include fields that map cleanly to future backend session storage. Every agent request carries `sessionId`, `mode`, and `modelRouterId`. The backend validates those fields, includes them in provider payloads, and maps the single allowed model router to the current configured provider/model.

This gives the UI real behavior without requiring a full backend session service in the first pass.

## Alternatives Considered

### Pure Frontend UI Reflow

This would move the composer, add local sessions, and show mode/model controls without backend protocol changes. It is faster and lower risk, but the model selector would be partly cosmetic and the protocol would need to be redesigned later.

### Full Chat System

This would add backend session CRUD, file or database storage, model list APIs, message branching, message editing, retry, delete, and richer history management. It is a good long-term direction, but too large for the first UI/UX refinement pass.

## Layout And Interaction Design

The AI tab becomes a single-column chat shell.

Top header:

- New Chat icon button.
- History button that opens a compact in-panel session picker.
- Current session title, generated from the first user request.
- Compact state indicator when loading, errored, or attached to a pending draft.

Control area:

- Model Router selector with one enabled option in the first pass.
- Mode segmented control: Ask, Edit, Agent.
- Context chips for selected object(s), scene, recent history, and pending draft.

Conversation feed:

- User, assistant, tool, status, and error messages render in one chronological feed.
- `actionDraft`, `actionPlan`, `macroDraft`, `sceneAnswer`, and other structured responses render inline as assistant response cards.
- Draft cards keep existing actions: discard, JSON, confirm execute, confirm apply.
- Historical draft cards can be displayed, but only the active response or current pending command can be confirmed.
- Empty sessions show starter suggestions instead of permanently showing example prompt buttons.

Bottom composer:

- Composer is fixed at the bottom of the AI tab.
- Textarea supports multi-line input.
- Send/stop is a compact icon button at the lower right.
- Context chips remain visible directly above the textarea inside the composer surface.
- Sending while loading preserves the current cancellation behavior and guards against stale responses.

## Session Data Design

Sessions are stored in browser localStorage in the first pass.

```ts
type AgentChatSession = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  modelRouterId: string;
  mode: 'ask' | 'edit' | 'agent';
  messages: AgentChatMessage[];
  contextSnapshot?: AgentSessionContextSummary;
};

type AgentSessionContextSummary = {
  workspaceId?: string;
  selectedMeshIds: string[];
  historyEntryCount: number;
  pendingCommandId?: string;
};
```

Messages keep both display text and structured agent output when present.

```ts
type AgentChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'status';
  text: string;
  createdAt: string;
  response?: AgentResponse;
  request?: {
    text: string;
    mode: 'ask' | 'edit' | 'agent';
    modelRouterId: string;
  };
};
```

Session behavior:

- Opening the AI tab creates an empty session when no saved session exists.
- New Chat creates a new session and clears the visible feed without changing the 3D scene or operation timeline.
- History opens a saved session list.
- Reopening a session restores the feed and allows follow-up messages.
- Session title defaults to the first user message truncated to a short readable label.
- The store keeps a bounded recent list, initially 20 sessions, trimming by `updatedAt`.
- Corrupt or incompatible localStorage data is discarded and replaced with a new session.

## Agent Modes

### Ask

Ask mode answers questions about the current scene, selected objects, operation history, supported capabilities, or pending state. It should not produce executable operation drafts.

Allowed response kinds are `message`, `clarification`, and `sceneAnswer`. If the user asks for a mutation in Ask mode, the assistant should explain that Edit or Agent mode is needed, or ask for confirmation to switch modes.

### Edit

Edit mode produces one reviewed operation draft.

The primary response kind is `actionDraft`. It can also return `clarification`, `sceneAnswer`, or `message`. If the user asks for multi-step work, the assistant should suggest Agent mode instead of returning a plan.

### Agent

Agent mode produces multi-step plans or macros when useful.

Allowed response kinds include `actionPlan`, `macroDraft`, and `actionDraft`. Every step still passes through existing review, preview, confirmation, and execution gates. Agent mode does not automatically apply risky changes without user confirmation.

## Protocol Expansion

Frontend and backend extend `AgentRequest` with optional fields:

```ts
type AgentRequest = {
  id: string;
  sessionId?: string;
  text: string;
  mode?: 'ask' | 'edit' | 'agent';
  modelRouterId?: string;
  scene: SceneState;
  conversation: AgentConversationTurn[];
  pendingCommand?: OperationCommand | null;
  context?: unknown;
};
```

Compatibility rules:

- Missing `mode` defaults to `edit`.
- Missing `modelRouterId` defaults to the configured router.
- Missing `sessionId` remains valid for older callers and tests.

Backend rules:

- Validate `mode` against `ask`, `edit`, and `agent`.
- Validate `modelRouterId` against the configured router list.
- Reject unknown router ids so UI state cannot silently diverge from real provider behavior.
- Include mode and router information in the provider payload.
- Prompt the provider with mode-specific response guidance.
- Map the first pass router, for example `default-router`, to current env-based provider/model config.

## Context Attachments

The first pass keeps context attachments lightweight but visible.

Context chips should represent:

- Selected object names or a multiple-selection summary.
- Current scene/workspace context.
- Recent operation history availability.
- Pending draft or preview state.

These chips are informational first. Slash commands and explicit attach/detach controls are follow-up work.

## Error And Edge State Handling

- Backend unavailable: keep the session and draft text, then append an error/status message to the feed.
- Request cancelled: keep the user message and append a cancellation status message.
- Stale response after cancellation or resend: ignore it using the existing request serial guard.
- Scene changes after reopening an old session: keep the old messages, but context chips reflect the current scene.
- Historical draft cards: show them as history but disable confirm/apply unless they match the current active response or pending command.
- Mode mismatch response: surface a clear assistant/status message instead of executing an unexpected response kind.
- Storage corruption: recover by creating a new empty session.
- Session limit exceeded: remove oldest sessions by `updatedAt`.

## Acceptance Criteria

- AI tab uses a bottom composer layout.
- Empty chat shows starter suggestions instead of a persistent example button row.
- Users can create a new chat session.
- Users can open history and restore a previous session.
- Restored sessions can continue with new messages.
- Sessions persist across browser refresh through localStorage.
- Session data stores mode and model router at session and request level.
- Mode selector supports Ask, Edit, and Agent.
- Ask mode does not execute or confirm operation drafts.
- Edit mode focuses on one operation draft.
- Agent mode can show plans/macros while preserving review gates.
- Model router selector is end-to-end, even though only one router is enabled initially.
- Agent requests include `sessionId`, `mode`, and `modelRouterId`.
- Backend validates mode/router and includes them in provider payloads.
- Context chips show selection, scene/history, and pending draft state.
- Existing draft preview, discard, JSON, confirm, and pending command flows keep working.

## Testing Plan

Frontend unit tests:

- Session store creates, updates, opens, trims, and recovers from invalid localStorage.
- AgentPanel renders bottom composer and starter suggestions.
- New Chat creates a new session.
- History restores an old session and appends follow-up messages.
- Mode selector updates session state and request payload.
- Model router selector updates session state and request payload.
- Context chips render selected objects, recent history, and pending draft state.
- Action draft cards render inside the feed and retain confirm/discard behavior.
- Historical draft cards do not accidentally execute old operations.

Protocol and adapter tests:

- Requests include `sessionId`, `mode`, and `modelRouterId`.
- Missing fields use compatibility defaults.
- Abort/resend still ignores stale responses.

Backend tests:

- Request validation accepts valid modes and rejects invalid modes.
- Request validation accepts the configured router and rejects unknown routers.
- Provider payload includes mode and router fields.
- Provider prompt contains mode-specific guidance.
- Existing mock and LLM paths still pass smoke validation.

Browser smoke:

- Open the AI tab.
- Create a new chat.
- Send a prompt.
- See user and assistant messages plus a draft card.
- Refresh and verify the session can be reopened.

## Follow-Ups

- Backend session CRUD and project-local storage.
- Model/router discovery endpoint for multiple routers.
- Slash commands and prompt shortcuts.
- Message-level retry, copy, edit/resend, delete, and branch-from-message.
- Explicit attach/detach context controls.
- User-editable session titles.
