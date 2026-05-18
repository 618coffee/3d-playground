# Solution

## Summary

Implemented app-level mesh clipboard support for workbench clone paste and AI chat mention paste. Workbench paste is handled by `App` through `cloneMesh`; `AgentPanel` only consumes clipboard entries for visible `@Name` mentions and hidden mesh ID request bindings.

## Changed Files

- `src/domain/meshClipboard.ts`: Added clipboard snapshot, mention text, and clone offset helpers.
- `src/domain/protocol.ts`: Added mesh reference request metadata.
- `src/agent/types.ts`: Allowed parser calls to receive hidden mesh references.
- `src/agent/adapters.ts`: Passed hidden references to the offline parser.
- `src/agent/ruleParser.ts`: Resolved pasted mentions through mesh IDs with complete mention-boundary matching.
- `src/components/AgentPanel.tsx`: Added chat paste mention behavior, hidden request bindings, and stale-reference filtering.
- `src/components/InspectorPanel.tsx`: Threaded App-owned clipboard entries into the AI panel.
- `src/App.tsx`: Added app-owned keyboard mesh clipboard, workbench paste clone behavior, and workspace-load clipboard clearing.
- `backend/agent-api/src/validation.js`: Preserved scene-valid mesh references in validated agent requests.
- `backend/agent-api/src/provider.js`: Included mesh references in the LLM provider payload.
- `src/domain/meshClipboard.test.ts`, `src/agent/ruleParser.test.ts`, `src/components/AgentPanel.test.tsx`, `src/App.test.tsx`: Added regression coverage for helpers, parser mention resolution, chat paste, workbench paste, stale workspace clipboard clearing, and an existing clipping test label drift.
- `backend/agent-api/src/validation.test.js`, `backend/agent-api/src/provider.test.js`: Added backend coverage for mesh reference validation and provider payload forwarding.
- `docs/designs/clipboard-mesh-references.md`: Recorded design and implementation solution notes.
- `docs/superpowers/plans/clipboard-mesh-references-implementation-plan.md`: Added the implementation plan used for task-by-task execution.

## Verification

- `npx vitest run src/domain/meshClipboard.test.ts src/agent/ruleParser.test.ts src/components/AgentPanel.test.tsx src/App.test.tsx --reporter=dot`: passed, 4 test files and 78 tests.
- `npm test -- --reporter=dot`: passed, 13 frontend test files and 134 tests.
- `npm --prefix backend/agent-api test`: passed, 19 tests.
- `npm run lint`: passed, TypeScript app and node configs completed without errors.
- `npm --prefix backend/agent-api run check`: passed, backend source files completed `node --check` without errors.

## Follow-Ups

- Rich, chip-like mention rendering remains out of scope for this pass.

---

# Clipboard Mesh References

## Status

Designed. Not implemented yet.

## Context

The workbench should support two clipboard-driven workflows for selected scene parts:

- In the viewer/workbench, selecting a part and pressing `Ctrl+C`/`Cmd+C`, then `Ctrl+V`/`Cmd+V`, should duplicate the selected part without placing the copy directly on top of the original.
- In the AI chat composer, pressing paste after copying a selected part should insert a visible reference to that part so one chat prompt can address multiple parts independently.

The user-facing chat text should stay readable, using `@Part name`, while the app keeps the hidden `meshId` mapping needed for stable command targeting.

## Findings

- The domain protocol already supports `cloneMesh`, `selectMesh`, `moveMesh`, and mesh targets by `meshId`, `meshIds`, name, selection, or all visible meshes.
- `cloneMesh` already applies incremental offsets and creates distinct clone IDs in the operation executor.
- The app keeps selected meshes in `scene.selection` and passes `selectedMeshes` to `AgentPanel`.
- The AI panel currently sends plain prompt text plus scene context, but does not preserve inline mention-to-mesh mappings.
- Browser system clipboard support for structured custom data is unnecessary for this MVP; an app-level clipboard is enough for same-page copy/paste workflows.

## Design Goals

- `Ctrl+C`/`Cmd+C` copies the current selection as mesh references when the user is not editing text.
- `Ctrl+V`/`Cmd+V` outside text inputs clones the copied meshes through the existing command executor.
- Viewer/workbench paste uses a deterministic non-zero offset so clones do not overlap originals.
- `Ctrl+V`/`Cmd+V` inside the AI composer inserts clean mentions such as `@Blue titanium fan stage`.
- The AI request includes a hidden mapping from mention text to `meshId` so the parser and LLM can target references reliably.
- Multiple copied meshes paste as multiple mentions and can be used in the same sentence for different instructions.
- Native text copy/paste behavior remains unchanged in ordinary inputs and textareas when no mesh reference paste is being handled.

## Proposed Approach

Add a small app-level mesh clipboard owned by `App`. Workbench copy/paste is completed entirely in `App`; `AgentPanel` only receives read access to the same clipboard so the chat composer can paste mesh mentions:

- Store copied mesh references as `{ id, name, bounds, transform }` snapshots.
- Add a global keydown handler in `App` for `Ctrl/Cmd+C` and `Ctrl/Cmd+V` when the active element is not text-editable.
- On copy, snapshot the current selected meshes and update a lightweight status message.
- On paste outside text-editable controls, `App` executes a `cloneMesh` command with `target: { meshIds }`, `count: 1`, `shareGeometry: true`, and a computed offset. This path does not depend on `AgentPanel`.
- Compute the default offset from copied mesh bounds, preferring positive X with at least `20mm` spacing and enough distance to clear the copied selection's bounding width.
- After paste cloning, rely on the existing executor/history/runtime path so undo, timeline, dataset references, and renderer updates stay consistent.

For AI chat:

- Add an `onPaste` handler to the composer textarea.
- If the app mesh clipboard has entries, prevent the default paste and insert mention text at the caret.
- Track mention bindings in component state as `{ label, meshId }` for the current draft.
- When sending, include the bindings in hidden request context and optionally append a compact machine-readable note to the prompt sent to the adapter, while preserving the visible user message as typed.
- Extend the local rule parser target resolution so explicit `@Name` mentions resolve by the hidden `meshId` mapping before falling back to name or selection.

## Acceptance Criteria

- Selecting a mesh, copying it, and pasting in the workbench creates one clone offset from the original.
- The clone operation appears in history and can be undone through existing history behavior.
- Copying multiple selected meshes and pasting in the workbench clones all copied meshes with the same non-overlapping offset.
- Pasting into the AI composer inserts visible `@Name` mentions without exposing raw IDs in the textarea.
- Sending a prompt with two pasted mentions preserves both hidden mesh IDs for parser/agent targeting.
- Existing normal textarea typing and empty clipboard behavior continue to work.

# Testing

- Add app-level tests for keyboard copy/paste clone behavior, including clone offset and command history effects.
- Add AI panel tests for composer paste inserting visible mentions and request payload carrying hidden reference mappings.
- Add parser/context tests for resolving mention mappings to stable mesh IDs.
- Run the targeted tests first, then the full test suite or at least the project lint/build command if the full suite is too slow.

## Risks And Open Questions

- Mention labels can collide when two meshes share a name. The hidden binding should remain authoritative, and the UI can disambiguate later if needed.
- Rich mention rendering is out of scope for this pass; the textarea will stay plain text.
- Cross-tab or cross-app mesh clipboard support is out of scope for this MVP.
- If a copied mesh is deleted before paste, paste should skip missing IDs and report that no copied objects are available rather than failing silently.
