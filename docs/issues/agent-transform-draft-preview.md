# Agent Transform Draft Preview

# Solution

## Summary

Fixed agent transform drafts so supported transforms now appear in the viewport before confirmation. `rotateMesh` and `setMeshScale` drafts apply a runtime-only preview, register as the active pending command, and reuse the existing restore-before-confirm / restore-on-cancel flow so the final confirmed operation is applied once through the executor.

## Changed Files

- `src/App.tsx`: previews `rotateMesh` and `setMeshScale` drafts in the runtime, marks them pending, and restores them with the existing runtime preview lifecycle.
- `src/components/InspectorPanel.tsx`: gives transform pending cards clearer titles, descriptions, and `确认应用` labels.
- `src/App.test.tsx`: adds a regression test proving agent rotate drafts call `runtime.rotateMesh` before confirmation and apply once more on confirm.
- `scripts/smoke-browser.mjs`: accepts both `确认执行` and the new preview-state `确认应用` button when confirming an AI draft.
- `docs/issues/agent-transform-draft-preview.md`: records investigation and solution.

## Verification

- `npm test -- src/App.test.tsx --run`: passed.
- `npm test -- src/App.test.tsx src/components/AgentPanel.test.tsx src/components/InspectorPanel.test.tsx src/components/ViewerPanel.test.tsx --run`: passed, 22 tests.
- `npm run lint`: passed.
- `npm test -- --run`: passed, 62 tests in 11 files.
- `npm run build`: passed.
- `npm run smoke:browser`: passed at `http://127.0.0.1:5173/`.

## Follow-Ups

- Rotate history/undo semantics remain intentionally unchanged here: viewport drag rotation still updates the current state without creating one history entry per drag tick. If AI-confirmed rotations should become timeline undo entries, that should be handled as a separate history-policy change.

---

## Status

Implemented and verified.

## Context

When the AI returns an action draft such as rotating the current object around the Z axis, the review card says the operation is previewable and asks for confirmation. In the viewport, however, the selected object stays unchanged until the user clicks confirm.

## Findings

- `AgentPanel` calls `onPreviewDraft` whenever an `actionDraft` arrives.
- `App.previewDraft()` restores any previous runtime preview, then previews only `clipMesh` and `cloneMesh` commands.
- `rotateMesh` drafts fall through the `command.type !== 'cloneMesh'` branch and do not touch the runtime or set `pendingCommand`.
- Because no pending command is registered, the review button stays in the `确认执行` path instead of the preview confirmation path.
- `execute()` already restores runtime previews before applying a confirmed pending command, so the missing piece is the initial runtime-only transform preview.

## Reproduction

1. Select a mesh in the workbench.
2. Ask AI to rotate the selected object, for example `把当前对象绕 Z 轴旋转 90 度`.
3. Wait for the action draft review card.
4. Observe that the viewport mesh has not rotated yet.
5. Click confirm and observe that the mesh rotates only then.

## Expected Behavior

- When a supported transform draft arrives, the viewport should immediately show the draft transform as a temporary preview.
- The command should become the active pending draft so the user can confirm or discard it.
- Discarding or replacing the draft should restore the viewport to the current committed scene.
- Confirming should first restore the preview, then apply the command once through the executor.

## Proposed Approach

- Add regression coverage for agent rotate drafts invoking runtime preview before confirmation.
- Extend `App.previewDraft()` and preview restoration classification so `rotateMesh` gets a runtime-only preview, similar to clone previews.
- Keep drag/UI rotation history behavior unchanged.

## Risks And Open Questions

- The existing history policy keeps rotate operations as current-state updates rather than separate history entries. This fix focuses on preview fidelity and does not change undo semantics for drag rotation.