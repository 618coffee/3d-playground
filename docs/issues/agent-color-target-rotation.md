# Agent Color Target Rotation

# Solution

## Summary

Fixed color-targeted agent requests by preserving mesh color metadata through backend request validation, deriving a human-readable `colorLabel`, and using that label to narrow color-targeted selection commands to the uniquely matching mesh. Mock mode now also resolves color words before falling back to current selection. The frontend compact agent context now includes `color` and `colorLabel` as well.

## Changed Files

- `backend/agent-api/src/validation.js`: preserves normalized mesh colors, derives `colorLabel`, and narrows `source: 'selection'`/`allVisible` targets to a unique color match when the user prompt contains a color word.
- `backend/agent-api/src/validation.test.js`: covers color preservation, `colorLabel` derivation, and backend target narrowing for color-targeted rotation drafts.
- `backend/agent-api/src/mock-agent.js`: resolves color-targeted requests in mock mode before falling back to current selection.
- `backend/agent-api/src/mock-agent.test.js`: covers orange mesh rotation targeting in mock mode.
- `backend/agent-api/src/provider.js`: tells the LLM to use `colorLabel` for color-targeted requests and ask for clarification on ambiguous matches.
- `src/agent/context.ts`: adds `color` and `colorLabel` to compact frontend agent context.
- `src/agent/context.test.ts`: covers compact context color metadata.
- `docs/issues/agent-color-target-rotation.md`: records investigation and solution.

## Verification

- `npm --prefix backend/agent-api run check`: passed.
- `npm --prefix backend/agent-api run smoke`: passed.
- `npm --prefix backend/agent-api test`: passed, 9 backend tests.
- `npm run lint`: passed.
- `npm test -- --run`: passed, 61 frontend tests.
- `npm run build`: passed.
- `npm run smoke:browser`: passed at `http://127.0.0.1:5173/`.

## Follow-Ups

- A running `agent-api` process must be restarted to pick up the backend validation and provider prompt changes.
- Color labels are intentionally coarse. If future scenes contain multiple visually similar orange/gold parts, the agent should ask for clarification unless the prompt or selection uniquely identifies one.

---

## Status

Implemented and verified.

## Context

A user asked the agent to rotate the selected orange object around the Y axis by 30 degrees, but the visible result did not match the intended single orange target.

## Findings

- Browser reproduction showed that a direct selected-object Y rotation can produce a valid `rotateMesh` action with `axis: 'y'` and `angleDeg: 30`.
- After confirmation, the scene metadata for `Warm stator vane stage` updated to `rotationDeg: [0, 30, 0]`, so the executor path applies Y-axis rotation when the target is correct.
- The problematic screenshot showed the agent composer context pills as `6 个对象`, meaning the prompt was operating with a multi-selection context.
- Backend `validateSceneMesh()` strips `mesh.color` from the scene before the LLM provider receives it.
- Because color metadata is missing from the provider payload, a request like `橙色对象` cannot be resolved reliably by the LLM and may fall back to current selection or ask for clarification.

## Reproduction Or Design Goals

- Given scene meshes with colors such as `#f08a4b` and `#d5a553`, the backend request passed to the agent should preserve color metadata.
- The backend should expose a human-readable color label so prompts containing color words like `橙色` or `orange` can target the intended mesh.
- Mock mode should support color-targeted rotation so local development and tests match LLM mode expectations.
- The existing Y-axis rotation executor behavior should remain unchanged.

## Proposed Approach

- Preserve normalized `color` on validated backend scene meshes.
- Derive `colorLabel` from mesh colors during backend validation.
- Teach mock target inference to match color words against `colorLabel` and common color aliases.
- Add compact frontend agent context color fields for consistency.
- Add regression tests for backend color preservation, mock color targeting, and frontend context metadata.

## Risks And Open Questions

- Some colors are perceptually ambiguous. `#f08a4b` should be orange, while `#d5a553` is better treated as gold/amber to avoid matching two objects for `橙色`.
- Color targeting should ask for clarification when more than one mesh matches the same color label.
