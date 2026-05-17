# Solution

## Summary

Added AI rule-parser support for move/translate commands so the requested first workflow can produce a real `moveMesh` draft. Added a reusable recording script that drives the workbench in Chrome, injects a highlighted demo cursor/click ring, intercepts the AI API with deterministic responses, and writes four MP4 walkthroughs.

## Changed Files

- `src/agent/ruleParser.ts`: Parses move/translate commands, resolves the target, extracts axis and signed distance, and emits `moveMesh` actions.
- `src/agent/ruleParser.test.ts`: Covers `将选中对象沿着x轴正方向移动20mm` as a selection-targeted move command.
- `scripts/record-ai-workflows.mjs`: Records the four requested AI assistant scenarios with cursor/click highlights.
- `artifacts/ai-workflow-recordings/01-move-selection-x-20mm.mp4`: Selects fan and stator stages, then moves them +20 mm on X.
- `artifacts/ai-workflow-recordings/02-rotate-nacelle-z-90deg.mp4`: Selects the nacelle casing and rotates it 90 degrees around Z.
- `artifacts/ai-workflow-recordings/03-clone-stator-x-10mm.mp4`: Selects the stator stage and clones one copy with 10 mm X spacing.
- `artifacts/ai-workflow-recordings/04-clip-all-z0-positive.mp4`: Selects all turbofan components and applies a Z=0 positive-side visual clip.

## Verification

- `npm test -- src/agent/ruleParser.test.ts --reporter=dot`: passed, 16 tests.
- `node --check scripts/record-ai-workflows.mjs`: passed.
- `node scripts/record-ai-workflows.mjs`: passed and generated all four MP4 files.
- `ffprobe artifacts/ai-workflow-recordings/*.mp4`: all four videos are readable at 1440x900 with durations from 4.2s to 4.9s.
- `npm run lint`: passed.
- `npm test -- --reporter=dot`: failed with an existing mismatch in `src/App.test.tsx`; the test searches for a manual clip region named `切割预览`, while the current component exposes that region as `切割`.

## Follow-Ups

The full suite has one unrelated failing UI test around the manual clip section accessible name. The recordings and the move parser change were verified separately.

---

# AI Recording Move Support

## Status

Investigated. Not implemented yet.

## Context

The requested demo recordings include four AI assistant workflows. The first workflow selects `Blue titanium fan stage` and `Warm stator vane stage`, then asks the AI assistant to move the selected objects by +20 mm on the X axis.

## Findings

Manual verification in the running app showed that the AI assistant currently responds that move/translate commands are not supported. The rule parser supports selection, rotation, clone, clip, and reset commands, but does not parse move commands even though the domain command model and executor already support `moveMesh`.

## Reproduction Or Design Goals

Steps to reproduce:

1. Open the turbofan workspace.
2. Select `Blue titanium fan stage` and `Warm stator vane stage`.
3. Enter `将选中对象沿着x轴正方向移动20mm` in the AI assistant.
4. Send the request.

Expected behavior: the assistant creates a `moveMesh` action draft targeting the current selection with offset `[20, 0, 0]` in `mm`.

Actual behavior: the assistant replies that move/translate commands are not supported.

Acceptance criteria:

- Chinese move/translate commands parse to `moveMesh` for the current selection.
- Axis and distance are extracted from text such as `沿着x轴正方向移动20mm`.
- Existing rotation, clone, and clip parsing behavior remains intact.
- The four requested AI workflow recordings can be generated with visible pointer/click highlighting.

## Proposed Approach

Add move command parsing to the existing rule parser, reusing existing target, axis, and distance helpers where possible. Add a focused parser test before implementation.

## Risks And Open Questions

The phrase `移动` is already stripped from clone detail parsing when used as offset wording, so the move parser must run separately and avoid stealing clone commands.