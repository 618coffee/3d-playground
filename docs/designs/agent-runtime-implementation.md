# Agent Runtime And 3D Operation Implementation

## Status

Current implementation as of 2026-05-15.

This document describes what the code actually does today: how natural language reaches the local agent API, how LLM responses are constrained, how commands become reviewed viewer operations, and how those operations touch vtk.js objects.

## Scope

The system is a controlled operation planner, not an autonomous CAD executor. The LLM proposes structured drafts. Browser-side domain code validates, previews, confirms, executes, and records viewer-safe operations. Heavy geometry or simulation work is represented as future backend job drafts only.

## End-To-End Flow

```text
User prompt in AgentPanel
  -> buildAgentContext(scene, recent history)
  -> LlmAgentClient POST /api/agent/respond
  -> local agent-api validates AgentRequest
  -> LLM provider returns raw AgentResponse
  -> agent-api normalizes and validates AgentResponse
  -> frontend validates AgentResponse again
  -> AgentPanel shows review card / plan / answer / job draft
  -> user confirms or executes a plan step
  -> OperationExecutor validates command and target state
  -> HistoryStore updates SceneState
  -> VtkRuntime mutates actors, mappers, camera, or clipping planes
```

The LLM never receives raw imported file content, polygon arrays, vtk datasets, actor references, or browser runtime objects. It receives scene metadata, supported action names, safety rules, recent history summaries, and schema descriptions.

## Frontend Agent Request

`AgentPanel` creates an adapter with `VITE_AGENT_API_URL || '/api/agent/respond'`. In the default Vite workflow, `/api` is proxied to `http://127.0.0.1:8787` by `vite.config.ts`, so the browser talks to the local Docker/Node agent API without exposing provider credentials.

The request includes:

- `text`: the current user prompt.
- `scene`: the current `SceneState`.
- `conversation`: the last few panel turns.
- `pendingCommand`: a draft waiting for confirmation, when present.
- `context`: compact metadata from `buildAgentContext`.

`buildAgentContext` sends unit, display mode, selected ids, mesh metadata, bounds, transforms, lock/visibility state, clipping summaries, recent history, supported action names, and safety rules. It intentionally omits raw geometry payloads.

For concrete payloads, see `docs/designs/agent-runtime-flow-examples.md`. That companion document walks through a rotate request and a half-cut request from `buildAgentContext` through agent response, executor result, scene state, and vtk.js runtime side effects.

There is a `RuleParserAdapter`, but the current default app path always has an endpoint because `getAgentEndpoint()` returns `/api/agent/respond`. If the backend is down, the UI reports a request error rather than automatically retrying with the rule parser.

## Local Agent API

The local backend lives under `backend/agent-api`. It exposes:

- `GET /health`: returns `{ ok: true, mode }`.
- `POST /api/agent/respond`: validates the request, calls the configured LLM provider, validates the response, and returns JSON.

The backend no longer includes a mock provider mode. `callLlmProvider()` requires `LLM_API_KEY` or `LLM_ACCESS_TOKEN`.

Provider selection is explicit through `LLM_PROVIDER` or inferred from `LLM_BASE_URL`:

- `azure-openai` for `*.openai.azure.com` endpoints, using `AzureOpenAI` and `LLM_API_VERSION`.
- `azure-ai-inference` for AI Services / Cognitive Services style endpoints, with `/openai/v1` appended when needed.
- `openai-compatible` for generic chat-completions-compatible endpoints.

For Azure AI Foundry usage in this repo, use the AI Services/Cognitive Services model endpoint such as `https://<resource>.cognitiveservices.azure.com`, not the Foundry project endpoint under `*.services.ai.azure.com/api/projects/...`.

## LLM Prompt And Provider Payload

The backend system prompt instructs the model to return one JSON object matching `AgentResponse`, avoid Markdown, avoid vtk.js/code/file access, use mesh ids from context, and prefer reversible visual clipping for simple plane cut requests.

The provider payload includes:

- user text,
- validated scene metadata,
- recent conversation,
- `AGENT_RESPONSE_SCHEMA`,
- `OPERATION_COMMAND_SCHEMA`,
- `ACTION_RISK_SCHEMA`.

The provider is called with `response_format: { type: 'json_object' }` and low temperature. The returned content is parsed as JSON before validation.

## Response Shapes

The frontend and backend share the same conceptual `AgentResponse` union:

- `message`: plain response for unsupported or non-mutating requests.
- `clarification`: question plus suggestions when the target or parameters are ambiguous.
- `actionDraft`: one reviewed `OperationCommand`.
- `actionPlan`: multiple step drafts executed sequentially by the UI.
- `sceneAnswer`: answer based on scene metadata, with referenced mesh ids.
- `macroDraft`: reusable multi-step draft shape in the UI.
- `backendJobDraft`: future local worker job for geometry processing, meshing, solver runs, or result summaries.

The current UI displays all of these, but only `actionDraft`, `actionPlan`, and `macroDraft` can directly call the viewer executor. `backendJobDraft` is display-only and has a discard action; it does not enqueue or run a worker.

## Validation And Normalization

The backend validates both requests and responses in `backend/agent-api/src/validation.js`.

Important server-side rules:

- LLM-generated `importMesh` is blocked.
- Command ids, `source: 'agent'`, `rawText`, and `confirmed: false` are generated or normalized server-side.
- Mesh ids in `meshId`, `meshIds`, and scene answers must exist in scene context when context has meshes.
- Plan and macro steps are capped.
- `cloneMesh.count` is constrained to `1..12`.
- `clipMesh.plane.normal` cannot be zero.
- Risk can be provided by the model, but the backend derives safe defaults and warnings from commands.
- Older wrapper-style outputs such as `{ common, commands: { rotateMesh: ... } }` are normalized into one flat `OperationCommand` when possible.

There is also a specific correction path for simple plane cuts. If the user asks for a reversible plane cut and the model responds with a clarification or `geometryCut` job draft, the backend can convert that request into a viewer-safe `clipMesh` action draft. Requests for permanent, baked, boolean, exported, remeshed, or topological operations still stay outside immediate viewer execution.

The frontend validates the returned `AgentResponse` again in `src/domain/validators.ts` before displaying or executing it.

## Supported Operation Commands

Current `OperationCommand` types are:

| Command | Current execution owner | Notes |
| --- | --- | --- |
| `selectMesh` | Browser | Updates selection and runtime highlight. |
| `rotateMesh` | Browser | Rotates vtk actors and updates scene transform metadata. |
| `cloneMesh` | Browser | Clones procedural geometry or reuses imported datasets; preview clones are translucent runtime-only objects. |
| `setMeshScale` | Browser | Sets actor scale and scene transform scale. |
| `clipMesh` | Browser for visual modes | Uses vtk clipping planes; `bakeGeometry` is rejected by the viewer executor. |
| `resetView` | Browser | Moves camera to isometric/front/top/right and fits visible content. |
| `setMeshVisibility` | Browser | Sets actor visibility and removes hidden objects from selection. |
| `setMeshLocked` | Browser | Updates scene lock state; most commands reject locked targets. |
| `setDisplayMode` | Browser | Switches actor representation between surface, wireframe, and points. |
| `importMesh` | UI only | Created by file import flow, not by the LLM. |

Targets can use explicit ids, id lists, current selection, all visible meshes, or name matching. Scene-wide viewer commands use `{ scope: 'viewer' }`; import uses `{ scope: 'scene' }`.

## Review And Execution Semantics

All execution goes through `OperationExecutor`, whether the command came from manual UI controls or the agent panel.

Execution performs command shape validation, target resolution, locked-object checks, operation-specific validation, confirmation handling, scene mutation, runtime mutation, and history policy.

Risky or preview-oriented operations are not blindly applied:

- `clipMesh` with `mode: 'preview'` returns `status: 'preview'` and requires confirmation.
- `clipMesh` with `mode: 'applyVisualClip'` previews first unless `confirmed: true` is present.
- `cloneMesh` requires confirmation when count is greater than five.
- `clipMesh` with `mode: 'bakeGeometry'` is rejected in the current MVP.

`AgentPanel` calls `onPreviewDraft` for action drafts. Clip drafts are previewed through the executor. Clone drafts create temporary runtime clone actors without recording history until confirmation. Canceling a preview restores runtime actors from the current `HistoryStore` scene and imported dataset map.

Plans and macros execute one step at a time. Execution stops at the first `preview`, `failed`, or `rejected` result so the user can review before continuing.

## Scene And History State

`HistoryStore` owns the durable `SceneState` snapshots for undo/redo. Most applied commands record a new history entry. Rotation updates the current entry instead of adding one per drag/rotation update. Selection commands that do not change selection are ignored.

Imported datasets are kept in an app-level `Map<meshId, dataset>` because `SceneState` stores serializable mesh metadata, not vtk datasets. Clone commands copy dataset references for clones of imported meshes.

Undo, redo, preview cancel, and some confirmation paths rebuild the vtk runtime from the current scene plus dataset map.

## VTK Runtime Operations

`createVtkRuntime()` wraps vtk.js so React and agent code do not touch renderer internals directly. It manages:

- `vtkGenericRenderWindow`, renderer, interactor, active camera, and render scheduling.
- A `records` map from mesh id to actors, mappers, original mesh metadata, and optional imported dataset.
- Picking through `vtkPicker` and a pick list of current actors.
- Camera reset, view scale, resize behavior, and viewport guide projection.
- File readers for STL, PLY, OBJ, and VTP.

Procedural meshes are converted into vtk sources such as cube, cylinder, cone, sphere, and fan-stage blade actors. Imported meshes are converted into one mapper/actor from the parsed dataset.

Visual clipping is non-destructive. `previewClip()` removes existing clipping planes from each mapper for a mesh, creates a new `vtkPlane`, and adds it to the mapper. `clearClip()` removes all clipping planes. The original dataset or procedural geometry is not cut or exported.

Display mode maps to vtk actor property representation:

- `surface` -> `setRepresentationToSurface()`
- `wireframe` -> `setRepresentationToWireframe()`
- `points` -> `setRepresentationToPoints()`

Selection highlighting is actor styling only: edge visibility, line width, and ambient are adjusted. It does not change mesh geometry.

## Sample Workspaces And Imports

The app currently ships two procedural sample workspaces:

- `turbofan`: a compact transparent turbofan-style assembly for clipping and display-mode demos.
- `robotic-cell`: a denser industrial inspection cell with robot joints, conveyor, sensors, guard rails, and fixtures.

The import UI accepts STL, OBJ, PLY, and VTP through runtime readers. The type model reserves `vtu` and `vtk`, but the current runtime reader does not implement those formats yet.

## Backend Job Boundary

`src/domain/jobs.ts` defines job types and statuses for future work, and `backendJobDraft` lets the agent describe a future job. Today there is no queue, worker, polling loop, or output ingestion. The only command currently classified as backend-owned is `clipMesh` with `mode: 'bakeGeometry'`, and the viewer executor rejects that command with guidance to use visual clipping.

## Known Limits

- No automatic network-failure fallback from the default local API client to the rule parser.
- No persistent project save/restore yet.
- No true geometry cutting, capping mesh generation, boolean operations, meshing, solver execution, or result ingestion.
- No VTU/legacy VTK reader implementation despite the reserved source format types.
- No streaming LLM responses; provider calls return one JSON object.
- No shared package for schemas yet; frontend TypeScript validators and backend JavaScript validators mirror the same protocol.

## Verification Commands

Use these commands to verify the current implementation:

```bash
npm --prefix backend/agent-api run check
npm --prefix backend/agent-api run smoke
npm --prefix backend/agent-api test
npm run lint
npm test
npm run build
npm run smoke:browser
```
