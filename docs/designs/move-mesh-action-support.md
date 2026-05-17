# Move Mesh Action Support

# Solution

## Summary

Added `moveMesh` as a shared relative movement operation for manual controls and AI-generated drafts. Manual users can now enter X, Y, and Z offsets in the right panel, apply movement to the current selection, and see mesh position and history update. The backend agent API now accepts, validates, documents, and mock-generates `moveMesh` commands.

## Changed Files

- `src/domain/actions.ts`: added the `moveMesh` command shape.
- `src/domain/validators.ts`: accepts `moveMesh` with finite offset vectors and scene units.
- `src/domain/executor.ts`: applies relative offsets to scene state and the viewer runtime.
- `src/viewer/vtkRuntime.ts`: moves VTK actors and runtime mesh transform state.
- `src/components/InspectorPanel.tsx`: added manual X/Y/Z movement controls and pending move labels.
- `src/components/AgentPanel.tsx`: added move titles and review summaries for AI drafts.
- `src/agent/context.ts`: exposes `moveMesh` in supported AI context actions.
- `backend/agent-api/src/schema.js`: added `moveMesh` to command schema and LLM-facing params.
- `backend/agent-api/src/validation.js`: validates and normalizes backend `moveMesh` action drafts.
- `backend/agent-api/src/mock-agent.js`: infers `moveMesh` for move/translate/shift prompts.
- `backend/agent-api/src/provider.js`: guides real LLM providers to use `moveMesh` for movement requests.
- Frontend and backend tests: added coverage for validator, executor, UI emission, context, backend validation, provider prompt, and mock agent behavior.

## Verification

- Red tests first: frontend failed on missing `移动` region, unsupported executor command, and unsupported validator command; backend failed on missing `moveMesh` enum and mock inference.
- `npm test -- src/domain/validators.test.ts src/domain/executor.test.ts src/components/InspectorPanel.test.tsx src/agent/context.test.ts`: passed, 29 tests.
- `cd backend/agent-api && npm test`: passed, 17 tests.
- `npm run lint`: passed.
- `npm run build`: passed; Vite reported only the existing chunk-size warning.
- `npm test` from repo root: passed, 110 tests across 12 files.
- Browser verification on `http://127.0.0.1:5173/`: manual tab shows `移动`; applying X=10, Y=-5, Z=2 updates the selected mesh position and records `moveMesh` in the timeline.

## Follow-Ups

- Absolute position editing remains out of scope and can be added later as `setMeshPosition` if property-panel editing needs it.
- Bounds are still preserved rather than recomputed, matching existing rotate/scale transform behavior.

---

## Status

Implemented.

## Context

Manual operations and AI assistant operations both need support for moving selected objects along the X, Y, and Z axes. The action model is shared across the React UI, frontend runtime validation, operation execution, VTK rendering, and the backend agent API, so the feature must be implemented across those boundaries rather than as a UI-only control.

## Findings

- `OperationCommand` currently supports selection, rotation, cloning, scale, clipping, visibility, lock state, display mode, view reset, and import.
- Mesh entities already store `transform.position`, and clone operations use offsets, so the scene model is ready for movement.
- The frontend executor updates scene state and calls a VTK runtime port for visible transforms.
- The backend agent API validates LLM-generated commands against `COMMAND_TYPES` and `OPERATION_COMMAND_SCHEMA`; unsupported action types are rejected before reaching the browser.
- The mock agent currently infers rotate, clone, clip, visibility, lock, selection, and display actions, but not move actions.

## Design Goals

- Add a relative movement operation named `moveMesh`.
- Represent movement with `params.offset: [number, number, number]` and `params.unit` matching the scene unit.
- Support manual movement through X, Y, and Z numeric controls in the right panel.
- Support AI-generated movement drafts through backend schema, validation, mock inference, risk derivation, titles, and explanations.
- Apply movement to both scene state and the VTK actors.
- Keep movement viewer-safe, reversible through history, and low-risk by default.

## Proposed Approach

Use `moveMesh` instead of absolute `setMeshPosition` for this change. Relative movement matches phrases like "沿 X 轴移动 10mm" and avoids overwriting existing position when multiple selected objects have different origins. Absolute positioning can be added later for property editing if needed.

Implementation touches:

- Frontend command typing and runtime validation.
- Frontend operation executor and VTK runtime port.
- Manual operations panel controls.
- Backend command schema, validation, mock agent inference, and user-facing action metadata.
- Focused tests for frontend validators, executor behavior, UI command emission, and backend action validation.

## Acceptance Criteria

- Manual users can enter X, Y, and Z offsets and apply movement to selected objects.
- Movement updates `mesh.transform.position` and the rendered actor position.
- `moveMesh` commands are accepted by frontend validators and rejected when offset or unit is malformed.
- Backend validation accepts LLM-generated `moveMesh` commands and normalizes wrapper payloads.
- Mock AI requests such as "把当前对象沿 X 轴移动 10mm" produce a `moveMesh` draft.
- Movement history is recorded like other manual transform operations.

## Risks And Open Questions

- Bounds are not recomputed in this change; existing transform operations also preserve stored bounds and rely on transform state for placement.
- Unit conversion is not introduced. Offsets use the scene unit, matching clone offset behavior.
- Absolute position editing remains out of scope.