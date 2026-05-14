# Solution

## Summary

Closed the eight MVP follow-up gaps with a more complete command lifecycle, richer workbench controls, better AI parsing, automated browser smoke coverage, and a compact UI polish pass. Risky operations now enter a pending confirmation flow, imports and scene changes are history-backed, and the viewer/object tree affordances are functional rather than placeholders.

## Changed Files

- `src/domain/actions.ts`, `src/domain/scene.ts`, `src/domain/executor.ts`: added display mode, visual clipping state, import/visibility/lock commands, validation, confirmation, and locked/hidden-object behavior.
- `src/viewer/vtkRuntime.ts`: added picking, display modes, orientation reset, visibility updates, and clip clear/apply handling.
- `src/App.tsx`: wired pending confirmation, import history, object-tree callbacks, viewer controls, and picking into the shared executor.
- `src/components/ObjectTree.tsx`, `src/components/InspectorPanel.tsx`, `src/components/ViewerPanel.tsx`, `src/components/TopBar.tsx`, `src/styles.css`: improved search, object controls, operation inputs, pending-action UI, viewer toolbar, and workbench polish.
- `src/agent/ruleParser.ts`, `src/agent/ruleParser.test.ts`: expanded named-target and English command parsing.
- `src/domain/executor.test.ts`: covered confirmation, visual clip application, imports, visibility, lock, and display mode behavior.
- `scripts/smoke-browser.mjs`, `package.json`, `README.md`: added and documented local Chrome browser smoke verification.

## Verification

- `npm run lint`: passed.
- `npm test`: passed, 24 tests across 3 files.
- `npm run build`: passed; Vite still reports the expected vtk.js large chunk warning.
- `npm run preview -- --host 127.0.0.1`: production preview started at `http://127.0.0.1:4173/`.
- `npm run smoke:browser`: passed against the production preview.

## Follow-Ups

- Real baked geometry cutting remains out of MVP scope and is explicitly rejected with guidance to use visual cutting.
- The vtk.js bundle still exceeds Vite's default chunk warning threshold; code-splitting vtk.js is a future performance task.

---

# MVP Gap Closure

## Status

In progress.

## Context

The first MVP implements the browser vtk.js workbench and passes tests/build, but the requirement and design review identified eight follow-up gaps before the demo feels like a coherent industrial tool.

## Findings

- Confirmation was only descriptive; risky actions could be executed directly.
- Clip operations were preview-only with no apply/cancel lifecycle.
- Import rebuilt history, so imports and earlier actions were not traceable together.
- Viewport picking and object tree controls were mostly placeholders.
- Manual controls were narrower than the requirement surface.
- Rule parsing handled the canned examples but not named targets or simple English variants.
- Browser smoke verification was manual rather than automated.
- The UI needed another compact polish pass to reduce placeholder feel.

## Design Goals

- Keep all manual and agent operations behind a validated command executor.
- Make risky actions previewable, confirmable, cancelable, undoable, and visible in history.
- Preserve import/load operations in the same traceable history stream.
- Make the main workbench controls feel operational: tree search, visibility, lock, picking, display mode, camera orientation, and adjustable operation inputs.
- Add automated smoke coverage for the default browser demo path.

## Proposed Approach

Implement the core action/history/runtime contract first, then wire UI affordances and parser improvements into that contract. Keep real baked geometry cutting and full LLM tool calling as documented future enhancements, but make the MVP semantics honest and complete for visual clipping and structured local actions.

## Risks And Open Questions

- VTK picking APIs vary by renderer setup; fallback behavior should keep object tree selection reliable.
- Browser smoke checks may require local server permissions in restricted environments.
- Baked geometry cutting remains out of MVP scope unless a later requirement explicitly asks for it.
