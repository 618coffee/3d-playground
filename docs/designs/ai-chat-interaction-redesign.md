# AI Chat Interaction Redesign

# Solution

## Summary

Implemented the AI panel as a VS Code-like chat composer. The prompt remains at the top of the AI tab, selected objects render as context pills in the input surface, old retry/stop/parse-review buttons are removed, and a single icon button now sends, stops, or stops-and-resends depending on request state and edited prompt text. Review follow-up also keeps cancel enabled when the prompt is cleared during loading and prevents cancelled late responses from updating the UI. A later layout pass makes the textarea span the composer width, moves `LLM API` below the input, and aligns it with a Copilot-style blue up-arrow send button.

## Changed Files

- `src/components/AgentPanel.tsx`: added selection pills, compact chat composer, editable loading state, request sequence guarding, and abort-before-resend behavior.
- `src/components/InspectorPanel.tsx`: passes selected meshes into the AI panel.
- `src/components/AgentPanel.test.tsx`: covers the new composer controls, selection pills, editable loading state, and abort/resend flow.
- `src/components/InspectorPanel.test.tsx`: covers chat visibility with no selected object.
- `src/styles.css`: styles the composer, pills, textarea, and single send/stop icon button.
- `scripts/smoke-browser.mjs`: updates browser smoke coverage for the new send button and current Vite dev task URL.
- `docs/designs/ai-chat-interaction-redesign.md`: records the redesign and implementation notes.

## Verification

- `npm run lint`: passed.
- `npm test -- --run`: passed, 60 tests across 10 test files.
- `npm run build`: passed.
- `npm run smoke:browser`: passed at `http://127.0.0.1:5173/`.

## Follow-Ups

- Server-side provider cancellation is still not implemented; the browser aborts and ignores stale responses, but the local backend may keep provider work running until that request naturally finishes.
- Inline editing of old conversation turns is still out of scope for this pass; the current prompt remains editable and can be resent at any time.

---

## Status

Implemented and verified.

## Context

The AI panel currently behaves like a command parser: a textarea, example buttons, retry/stop buttons, and a primary parse/review action. The requested direction is closer to VS Code Copilot Chat: the prompt box stays at the top, selected scene objects are visible as context pills inside the prompt surface, and the send control becomes a compact icon button that can cancel an in-flight turn.

## Findings

- `AgentPanel` already owns conversation state, request state, and an `AbortController` for cancelling frontend fetches.
- `createLlmAgentClient` already passes `AbortSignal` into `fetch`, so resending can abort stale responses on the client.
- `InspectorPanel` receives `selectedMeshes` but does not pass them to `AgentPanel` today.
- The right sidebar already defaults to the AI tab and does not hide the AI panel when selection is empty; the redesign should preserve that behavior.
- The backend does not currently stop provider work after client abort. The frontend can abort and ignore stale responses, but server-side cancellation is future work.

## Design Goals

- Keep the chat box at the top of the AI panel.
- Display selection context in the prompt box as pills for no selection, one selection, and multiple selections.
- Remove visible retry and stop buttons.
- Replace the parse/review button with a single icon button: send when idle, stop/cancel while loading.
- Keep the prompt editable while loading and after a response completes.
- When the user sends again during an in-flight request, abort the previous request and start the new one.
- Ignore stale aborted responses so an older turn cannot overwrite the latest response.
- Preserve existing draft review, plan execution, pending preview, and conversation behavior.

## Proposed Approach

Update `AgentPanel` with a compact chat input surface that contains selection context pills, editable textarea, and one icon action. Add a request sequence id so aborted or stale responses cannot write state after a newer request starts. Pass `selectedMeshes` from `InspectorPanel` into `AgentPanel`. Replace retry/stop tests with tests for selection pills, editable loading input, send/cancel button state, and abort-before-resend behavior.

## Acceptance Criteria

- Agent prompt textarea remains enabled during loading.
- No `重试`, `停止`, or `解析审阅` buttons remain in the AI panel.
- A send icon button is available when idle or after completion.
- The same icon button cancels the active request while loading.
- Sending a new prompt while loading aborts the previous request and sends the latest prompt.
- Selection pills show `未选择对象`, one object name, or a multiple-selection summary plus selected object names.
- Existing action draft discard, preview, confirmation, and pending resolution tests still pass.

## Risks And Open Questions

- Server-side provider calls may keep running after the browser aborts. This is outside the current frontend change and should be handled later by request lifecycle support in `backend/agent-api`.
- Inline editing of historical conversation turns is not included in this pass. The current prompt remains editable and can resend or revise the latest prompt at any time.
