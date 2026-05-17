# Solution

## Summary

Confirmed AI rotate drafts now create a history timeline entry. UI-origin rotate updates still use the existing no-noise path, so viewport drag rotation does not flood the timeline.

## Changed Files

- `src/domain/executor.ts`: record `rotateMesh` commands when they come from the agent; keep non-agent rotations as current-scene updates.
- `src/domain/executor.test.ts`: cover both UI rotate updates and agent rotate history recording.
- `src/App.test.tsx`: assert that confirming an AI rotate draft adds the raw command to the operation timeline.
- `docs/issues/agent-rotate-confirm-history.md`: record investigation and solution notes.

## Verification

- `npm test -- src/App.test.tsx src/domain/executor.test.ts`: 2 files passed, 17 tests passed.
- Browser reproduction at `http://127.0.0.1:5173`: before confirmation the timeline stayed empty; after confirmation it showed `rotateMesh` and `把当前对象绕 Z 轴旋转 30 度`, while the properties panel showed `0, 0, 30`.
- `npm test`: 12 files passed, 99 tests passed.
- `npm run build`: passed; existing chunk-size warning remains.

## Follow-Ups

- None for this bug.

---

# Agent Rotate Confirmation Missing History Entry

## Status

Investigated. Not implemented yet.

## Context

After an AI-generated rotate draft is confirmed, the selected mesh rotates and the status message updates, but the operation timeline remains empty.

## Findings

- `App.confirmPending` replays the pending agent command through `execute({ ...pendingCommand, confirmed: true })`.
- `createOperationExecutor` applies the rotation to scene state correctly.
- `historyPolicy` currently returns `update` for every `rotateMesh` command, so `HistoryStore.updateCurrent` updates the current scene without creating a timeline entry.
- This preserves the visual state but leaves no operation row for confirmed agent rotations.

## Reproduction

1. Select a mesh.
2. Ask AI to rotate it around the Z axis by 30 degrees.
3. Confirm the generated draft.
4. Observe that the mesh rotation changes, but the operation timeline still shows the empty state.

## Expected Behavior

A confirmed AI rotate draft should add a history timeline entry for the operation.

## Actual Behavior

The scene updates, but no history entry is recorded.

## Proposed Approach

Keep transient or continuous rotation updates from flooding history, but record AI-origin rotate commands as regular operations once they are executed.

## Risks And Open Questions

- Existing drag rotation behavior should remain non-noisy.
- Undo/redo behavior for AI rotations should continue to use the existing history store path.
