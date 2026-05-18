# Solution

## Summary

Implemented workbench keyboard undo/redo and selected-mesh deletion on this branch. `Ctrl/Cmd+Z` now calls the existing history undo path, `Ctrl/Cmd+Shift+Z` and `Ctrl/Cmd+Y` call redo, and Delete/Backspace dispatch a new undoable `deleteMesh` operation outside text-editable elements.

## Changed Files

- `src/App.tsx`: Added keyboard routing for undo/redo/delete and a `deleteSelection` command dispatcher.
- `src/domain/actions.ts`: Added the `deleteMesh` operation shape.
- `src/domain/validators.ts`: Accepted `deleteMesh` commands.
- `src/domain/executor.ts`: Removed targeted meshes from scene/runtime, cleared deleted IDs from selection, and recorded delete operations in history.
- `src/viewer/vtkRuntime.ts`: Added `removeMesh(meshId)` for targeted actor removal.
- `src/components/AgentPanel.tsx`: Added the display title for `deleteMesh` drafts.
- `backend/agent-api/src/schema.js`: Added `deleteMesh` to the LLM operation schema.
- `backend/agent-api/src/validation.js`: Validated backend `deleteMesh` action drafts.
- `src/App.test.tsx`, `src/domain/executor.test.ts`, `src/domain/validators.test.ts`, `backend/agent-api/src/validation.test.js`: Added regression coverage.

## Verification

- `npx vitest run src/domain/validators.test.ts src/domain/executor.test.ts src/App.test.tsx --reporter=dot`: passed, 34 tests.
- `npm test -- --reporter=dot`: passed, 13 files and 138 tests.
- `npm run lint`: passed.
- `npm --prefix backend/agent-api test`: passed, 20 tests.
- `npm --prefix backend/agent-api run check`: passed.

## Follow-Ups

- None for the requested keyboard behavior.

---

# Keyboard Undo And Delete

Status: In progress

## Context

The workbench already exposes undo and redo controls in the top bar, and mesh copy/paste shortcuts are handled at the `App` level. The user reported that `Ctrl+Z` does not withdraw the last operation and the Delete key does not delete the selected component.

## Findings

- `HistoryStore` already supports `undo()` and `redo()`.
- `App` has `undo` and `redo` callbacks for the top bar, but the window keydown handler only handles copy/paste shortcuts.
- The operation protocol has no delete command, and the viewer runtime has no targeted mesh removal method.

## Reproduction Steps

1. Select or use the default selected mesh.
2. Perform a recorded operation such as keyboard copy/paste.
3. Press `Ctrl+Z` or `Cmd+Z`.
4. Select a mesh and press Delete.

## Proposed Approach

- Route `Ctrl/Cmd+Z` and `Ctrl/Cmd+Shift+Z` through the existing App `undo` and `redo` callbacks outside text-editable elements.
- Add a minimal `deleteMesh` operation command that targets selected meshes, removes them from scene/runtime, clears deleted IDs from selection, and records history for undo/redo.
- Bind Delete and Backspace to the new delete command outside text-editable elements.

## Acceptance Criteria

- `Ctrl/Cmd+Z` reverts the last recorded operation from the workbench.
- `Ctrl/Cmd+Shift+Z` redoes a reverted operation.
- Delete and Backspace remove the selected mesh from the scene and viewer.
- Delete operations are undoable through the existing history path.
- Shortcuts do not steal typing behavior from inputs, textareas, selects, or contenteditable elements.

## Risks Or Open Questions

- Deleting imported meshes must also clear their dataset references to avoid stale runtime restore data.