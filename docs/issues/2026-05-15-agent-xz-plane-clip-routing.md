# Solution

## Summary

Explicit plane-cut prompts such as `沿x,z平面切开整个模型，保留y轴正坐标部分` now produce a viewer-safe visual clipping draft instead of a non-executable backend job or unnecessary clarification. The XZ plane maps to `normal=[0,1,0]`, whole-model wording targets all visible meshes, and clip drafts are previewed in the viewer as soon as the draft arrives. The confirmation UI now uses consistent operation-specific labels and clears stale action drafts after confirmation.

## Changed Files

- `src/agent/ruleParser.ts`: Added axis-pair plane parsing, whole-visible-model targeting, and positive/negative coordinate side parsing.
- `src/agent/ruleParser.test.ts`: Added regression coverage for XZ-plane whole-model clipping.
- `src/App.tsx`: Auto-previews clip action drafts, matching clone draft preview behavior.
- `src/components/AgentPanel.tsx`: Routes active pending draft confirmation through the shared pending confirmation path and clears stale drafts after apply/cancel.
- `src/components/AgentPanel.test.tsx`: Added regression coverage for pending draft confirmation and stale draft cleanup.
- `src/components/InspectorPanel.tsx`: Uses contextual pending confirmation labels such as `确认应用` and `确认复制`.
- `src/components/InspectorPanel.test.tsx`: Added regression coverage for contextual pending labels.
- `backend/agent-api/src/validation.js`: Normalizes unnecessary LLM `geometryCut` job drafts and clip clarifications into `clipMesh` action drafts when the user supplied enough plane-cut detail.
- `backend/agent-api/src/validation.test.js`: Added backend normalization regression tests.
- `backend/agent-api/src/mock-agent.js`: Added whole-model and axis-pair plane support for mock responses.
- `backend/agent-api/src/mock-agent.test.js`: Added mock-agent regression coverage.
- `backend/agent-api/src/provider.js`: Clarified LLM instructions to default simple plane cuts to reversible visual clipping.
- `backend/agent-api/src/schema.js`: Documented clipMesh defaults and XY/XZ/YZ plane normal mapping for provider payloads.

## Verification

- `npm test -- src/agent/ruleParser.test.ts`: passed, 15 tests.
- `npm test -- src/components/AgentPanel.test.tsx src/components/InspectorPanel.test.tsx`: passed, 8 tests.
- `cd backend/agent-api && node --test src/validation.test.js src/mock-agent.test.js`: passed, 5 tests.
- Browser verification at `http://127.0.0.1:5174/` against the real LLM API after hot-updating the compose container: right panel showed `视觉切割` and `待确认切割`, did not show backend job or clarification text, showed `确认应用` instead of `确认执行`, cleared the draft after confirmation, and canvas screenshot bytes changed by 106359 after preview.
- `npm test`: passed, 52 tests across 10 files.
- `npm run build`: passed.
- `cd backend/agent-api && npm test && npm run check`: passed, 6 backend tests and syntax checks.

## Follow-Ups

- The operation remains a visual clip, not a baked boolean mesh edit. Explicit permanent/baked/boolean/export requests still belong to future backend jobs.

---

# Agent XZ Plane Clip Routing

## Status

Resolved and verified.

## Context

The user asked the AI agent to run: `沿x,z平面切开整个模型，保留y轴正坐标部分`. The expected behavior is a visible clip through the whole model at the XZ plane (`y=0`), keeping the positive Y side and hiding the `y < 0` half. Instead, the right panel showed a backend job draft with only a discard button, and the viewer did not change.

## Findings

- `backendJobDraft` responses have no execute path in the UI; they only render a discard button and explicitly say they are waiting for a future job worker.
- The LLM system prompt tells the provider to return `backendJobDraft` for true geometry edits, so natural wording like "切开整个模型" can be routed away from the viewer even when a visual clipping plane can satisfy the request.
- The local rule parser supports simple `X=0`, `Y=0`, and `Z=0` plane clipping, but does not understand axis-pair plane names like `xz 平面` as `normal=[0,1,0]`.
- The local rule parser does not treat `整个模型` / all visible model wording as `{ source: 'allVisible' }`, so fallback behavior can clip only the current selection.
- Clip drafts are not previewed automatically when the draft arrives, unlike clone drafts.

## Reproduction Or Design Goals

1. Load the turbofan workspace.
2. Ask the agent: `沿x,z平面切开整个模型，保留y轴正坐标部分`.
3. Expected: the agent returns a viewer-safe `clipMesh` draft targeting all visible meshes, plane origin `[0,0,0]`, normal `[0,1,0]`, keep side `positive`, and the viewer shows a clip preview before final confirmation.
4. Actual: the LLM can return a `backendJobDraft` for `geometryCut`; the UI exposes only `丢弃草稿`, and no viewer action runs.

## Proposed Approach

- Strengthen the LLM prompt/schema guidance so browser-supported clipping plane requests return `actionDraft` with `clipMesh`, while backend geometry jobs are reserved for explicitly permanent/baked/boolean/export geometry edits.
- Add server-side normalization for simple geometryCut drafts produced from plane clipping language, converting them into viewer-safe `clipMesh` drafts.
- Teach the fallback rule parser axis-pair planes (`xy`, `xz`, `yz`) and whole-model targets.
- Auto-preview clip action drafts in the viewer when they arrive, matching the clone draft preview behavior.

## Risks And Open Questions

- This remains a visual clipping operation, not a baked mesh boolean cut; future job workers can still handle explicit permanent geometry edits.
- Axis-pair parsing must avoid confusing `x,z 平面` with two separate axis cuts.