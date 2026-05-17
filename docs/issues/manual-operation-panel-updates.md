# Manual Operation Panel Updates

## Solution

### Summary

Updated the manual operation tab to use denser controls for repeated edits and fixed manual rotation history recording. Rotation now exposes X/Y/Z angle inputs at the same time, clone direction is a segmented X/Y/Z control, clip plane and keep-side are segmented controls, clip preview stays inline without a confirmation card, clip follow-up actions appear only after preview, and numeric fields have explicit increment/decrement controls that allow clearing the default value before typing a replacement.

Manual panel rotations now create operation timeline entries. Viewport drag rotation remains a current-scene update so it does not flood history.

### Changed Files

- `src/components/InspectorPanel.tsx`: reworked manual controls, added shared numeric stepper UI, set manual defaults, allowed numeric fields to be cleared before retyping, replaced clip selects with segmented controls, made clip preview show `清除切割` and `应用切割` only after preview, emitted raw text for manual operations.
- `src/App.tsx`: clear pending state for non-confirming previews so manual clip preview does not show a top confirmation card.
- `src/styles.css`: styled numeric steppers, segmented controls, the horizontal clip action row, and the distinct clear/apply clip button colors.
- `src/domain/executor.ts`: limited the rotate history suppression to viewport drag rotation.
- `src/components/InspectorPanel.test.tsx`: covered the new manual control structure, clearable numeric inputs, disabled clone defaults, clone enablement after valid quantity/spacing, progressive clip preview/apply/clear actions, and per-axis rotate execution.
- `src/domain/executor.test.ts`: covered manual rotation history recording and viewport drag suppression.
- `src/App.test.tsx`: covered manual panel rotation appearing in the operation timeline and the inline clip preview/apply/clear flow.

### Verification

- `npm test src/components/InspectorPanel.test.tsx src/domain/executor.test.ts -- --run`: 2 files passed, 17 tests passed.
- `npm test src/App.test.tsx src/components/InspectorPanel.test.tsx src/domain/executor.test.ts -- --run`: 3 files passed, 24 tests passed.
- Browser check at `http://127.0.0.1:5173/`: confirmed 6 numeric steppers, Z rotation defaults to `0`, clone count and distance default to `0`, clone count can be cleared before typing, clone button is disabled with primary styling until quantity and spacing are positive, clip starts with only `预览切割`, preview then shows color-distinct `清除切割` and `应用切割`, no pending confirmation card after manual preview, preview/apply/clear clip flow works inline, no clip plane/keep-side selects, X/Y/Z and positive/negative toggles, and right-aligned action rows.
- `npm test -- --run`: 12 files passed, 106 tests passed.
- `npm run lint`: passed.
- `npm run build`: passed; existing Vite chunk-size warning remains.

### Follow-Ups

- Applying X/Y/Z rotation in one click currently creates one history entry per non-zero axis. A future compound operation command could group those into one timeline row.

---

## Status

Investigated. Not implemented yet.

## Context

The manual tab in the operation workspace needs denser controls for repeated 3D edits. Manual actions should also appear in the operation timeline when the user explicitly clicks an operation button.

## Findings

- Rotation currently uses one shared angle input and three axis buttons, so users cannot prepare X, Y, and Z values at the same time.
- Clone direction is a select control, while the workflow is a small fixed option set that fits a segmented X/Y/Z control.
- Clip preview and apply buttons are on one row, but clear clip wraps to its own row.
- Numeric inputs rely on browser number input behavior; explicit stepper buttons will make increment/decrement controls consistent.
- `historyPolicy` treats every non-agent `rotateMesh` as a current-scene update. That keeps viewport drag rotation quiet, but it also suppresses explicit manual rotation button clicks from the timeline.

## Reproduction Or Design Goals

- Rotation section exposes X, Y, and Z angle fields at the same time.
- Clone direction uses X/Y/Z toggle buttons instead of a select.
- Clip preview, apply, and clear clip are aligned on one horizontal row.
- Numeric inputs have visible increment/decrement buttons at the right edge.
- Manual button-triggered operations are recorded in the operation timeline.
- Viewport drag rotation remains non-noisy and does not create timeline entries.

## Proposed Approach

- Replace the single rotation angle state with per-axis rotation values and one apply action that emits a rotate command for each non-zero axis.
- Introduce a small reusable numeric stepper control for manual numeric fields.
- Replace clone direction select markup with a segmented button group.
- Move clip clear into the same action row as preview and apply.
- Narrow the rotate history exception to commands marked as viewport drag rotation.

## Risks And Open Questions

- Applying multiple rotation axes will create one history entry per non-zero axis unless a compound command is added later.
- Stepper buttons should not make the already narrow right panel feel cramped.
