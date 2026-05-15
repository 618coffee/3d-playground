# LLM Integration Plan

## Status

Implemented through the local-first integration baseline.

The workbench now has shared runtime protocol validation, async agent adapters, compact scene context, a review-oriented AI panel, multi-step viewer plans, a local agent API skeleton, Docker Compose wiring, and explicit future backend job boundaries. True geometry processing, meshing, and solver execution remain job-worker follow-ups by design.

## Current Implementation Notes

- The default frontend path now calls `VITE_AGENT_API_URL || '/api/agent/respond'`. With Vite, `/api` is proxied to `http://127.0.0.1:8787`.
- The rule parser adapter still exists as an offline implementation path, but the default app does not automatically fall back to it when the local API is unreachable; network/API failures are shown in the AI panel.
- `AGENT_MODE=mock` is the default backend mode. `AGENT_MODE=llm` supports OpenAI-compatible, Azure OpenAI, and Azure AI Inference / AI Services endpoints.
- For Azure AI Foundry model deployments in this repo, use the AI Services/Cognitive Services model endpoint, such as `https://<resource>.cognitiveservices.azure.com`; do not use the Foundry project endpoint as the chat completions base URL.
- `backendJobDraft` and `BackendJob` types are protocol/UI foundations only. No queue, worker, solver, or geometry-processing backend is currently started.
- Detailed implementation notes are now kept in `docs/designs/agent-runtime-implementation.md`.

## Context

The current workbench already demonstrates natural-language 3D operations through a local rule parser. The next step is to integrate real LLM capability while keeping the CAD/CAE interaction model controlled, reversible, and auditable.

For the current requirement, the right scope is an LLM-backed controlled operation agent: natural language should become a validated `OperationCommand` draft, the user should review it, and the appropriate executor should apply it. The LLM should not directly manipulate vtk.js, browser objects, solver processes, or arbitrary code.

The project should stay local-first for now. The target deployment is Docker Desktop on the developer machine, not a cloud service. Any backend introduced for LLM calls should run as a local container, keep secrets in local environment variables, and expose only a local API to the browser app.

## Current Architecture Assessment

The existing architecture is a good base for LLM integration:

- `OperationCommand` is a typed whitelist for all supported 3D operations.
- `OperationExecutor` is the single execution path for manual UI and agent-originated commands.
- `HistoryStore` records executable operations and supports undo/redo.
- `VtkRuntime` is isolated behind a runtime port, so agent code does not touch vtk.js directly.
- The current `AgentPanel` already exposes parse, confidence, confirmation, and JSON action inspection.

The main gaps before adding a real LLM are:

- The agent boundary is synchronous and local. Real LLM calls need async state, streaming or pending status, retries, cancellation, and network error handling.
- `AgentPanel` creates `createRuleParser()` directly, so the UI is coupled to the parser implementation instead of an adapter interface.
- TypeScript types are not runtime validation. LLM output must be validated and normalized before reaching `OperationExecutor`.
- There is no context-packing layer that summarizes scene state for the LLM without sending full geometry data.
- There is no backend or proxy boundary for API credentials. Browser-only API calls would expose secrets.
- The execution boundary is not explicit enough yet. Lightweight viewer operations can remain in the browser, while future true geometry processing and simulation jobs should run in a backend or compute environment.
- The deployment boundary should be local-only at first. The backend should be containerized for Docker Desktop instead of designed around cloud hosting.
- Multi-step intent is not modeled. Real users will ask things like "select the fan, cut it in half, switch to wireframe, then fit view".

## Current UI Assessment

The desktop workbench layout is appropriate for an industrial 3D tool: object tree on the left, viewport in the center, inspector/action panel on the right, and operation history at the bottom.

The current AI tab is enough for MVP parsing, but not enough for a real LLM assistant:

- A four-line textarea plus parse/execute buttons does not represent conversation, clarification, tool progress, or retry states.
- JSON is useful for debugging, but should not be the main user-facing result. The primary UI should be a concise action review: target, operation, parameters, risk, and buttons.
- The pending confirmation card is well placed, but should become a shared review surface for LLM-generated commands and multi-step plans.
- AI should remain in the right panel for now, but the viewport should get a compact command bar or focus affordance so users do not have to hunt through tabs.
- The bottom timeline should keep recording final executed commands, while the AI panel should keep conversational reasoning and proposed actions.

## Design Goals

- Never let the LLM call vtk.js or execute arbitrary code.
- Treat `OperationCommand` as the shared protocol between frontend, backend, and tests.
- Keep all 3D mutations behind explicit executors instead of free-form model output.
- Keep API keys outside the browser.
- Run the first backend locally in Docker Desktop, without requiring cloud deployment.
- Send only scene metadata to the LLM by default, not imported mesh geometry.
- Make the LLM useful for command interpretation, target disambiguation, and multi-step planning.
- Preserve manual controls and the rule parser as a local fallback.
- Make every LLM-generated action reviewable, confirmable, undoable, and traceable.

## Proposed Architecture

```text
Shared Domain
  -> OperationCommand schema
  -> AgentResponse schema
  -> runtime validators

Frontend Workbench (local browser / Vite or containerized web app)
  -> Agent UI Controller
  -> RuleParserAdapter (offline fallback)
  -> LlmAgentClient (calls local backend API)
  -> Action Review UI
  -> ViewerOperationExecutor
  -> SceneState / HistoryStore
  -> VtkRuntime

Backend Agent API (local Docker Desktop container)
  -> LLM Provider Client
  -> Structured Output / Tool Schema
  -> Response Normalizer
  -> command validation
  -> later SimulationExecutor / JobExecutor
```

## Local Docker Deployment

The first backend should be designed for Docker Desktop, not cloud hosting.

Recommended local shape:

```text
docker compose
  -> web app container or Vite dev server on host
  -> agent-api container
  -> optional local storage volume
  -> optional future job-worker container
```

The browser app can run either as the existing Vite dev server on the host or as a containerized static web app. The `agent-api` container should expose a local endpoint such as `http://127.0.0.1:<port>/api/agent/respond` and read LLM credentials from a local `.env` file or Docker Compose environment variables. The credentials should never be baked into the frontend bundle.

For this local-first phase, do not add cloud deployment assumptions such as managed queues, object storage, cloud secrets, or hosted workers. Keep the interfaces clean enough that those can be added later if the project grows.

## Execution Ownership

`OperationCommand` should be shared, but execution should be split by responsibility.

Frontend owns lightweight viewer operations:

- `selectMesh`
- `resetView`
- `setDisplayMode`
- `setMeshVisibility`
- `setMeshLocked`
- `rotateMesh` for browser-loaded or procedural objects
- `cloneMesh` when it can share browser-side geometry safely
- `clipMesh` as visual clipping preview or visual clipping apply

Backend owns LLM and future heavy operations:

- API keys, model calls, rate limits, and logs
- local Docker container runtime for the agent API
- command generation, normalization, and optional server-side validation
- project persistence later
- true geometry cutting or boolean operations later
- meshing later
- solver job submission later
- simulation result extraction and summarization later

This means the first real LLM integration does not require moving the current viewer executor to the backend. The backend should generate and validate command drafts; the frontend should review and execute browser-safe viewer commands. Backend execution becomes necessary when commands represent real geometry processing, meshing, or solver work.

## Agent Response Model

The agent should return a discriminated union instead of only `AgentParseResult`:

```ts
type AgentResponse =
  | { kind: 'message'; text: string }
  | { kind: 'clarification'; question: string; suggestions: string[] }
  | { kind: 'actionDraft'; action: OperationCommand; explanation: string; confidence: number; risk: ActionRisk }
  | { kind: 'actionPlan'; steps: AgentPlanStep[]; explanation: string; risk: ActionRisk };
```

`actionDraft` handles the current single-command flow. `actionPlan` allows multi-step workflows later without forcing the first implementation to execute everything automatically.

## Scene Context Sent To LLM

Send compact metadata only:

- Unit, display mode, selected mesh ids.
- Mesh list: id, name, visibility, lock state, source format, stats, bounds, transform, clipping summary.
- Recent history summary: last few command types and raw user text.
- Supported action schema and safety rules.

Do not send raw imported file contents, polygon buffers, vertex arrays, or full vtk datasets in the first integration.

## Runtime Validation Flow

1. User submits natural language.
2. UI builds an `AgentRequest` from text, scene summary, pending command, and conversation history.
3. `LlmAgentClient` calls the local Docker-backed agent endpoint. `RuleParserAdapter` remains available as an offline adapter path, but the default app does not switch to it after a network failure.
4. Backend asks the LLM for a structured `AgentResponse`, then normalizes and validates it before returning.
5. Frontend validates the response shape again with runtime guards or a schema library.
6. Backend normalizes command ids, source, raw text, confirmation defaults, and risk flags; the frontend performs another shape validation pass.
7. Frontend performs local target/risk review before showing an action card or previewing a draft.
8. User confirms execution.
9. Browser-safe viewer commands run through `ViewerOperationExecutor` and record history.
10. Future geometry or simulation commands should be submitted to a backend `JobExecutor` and reflected in the UI as jobs, not applied directly by the viewer.

## UI Plan

Keep the right panel but change the AI tab from a parser demo into an assistant surface:

- Top: compact prompt box with send, stop, and retry controls.
- Middle: conversation/progress feed with user request, assistant clarification, and tool status.
- Action review card: operation type, target objects, key parameters, warnings, confidence, and buttons.
- Debug drawer: collapsible JSON action, hidden by default.
- Quick chips: example prompts and clarification suggestions.
- Footer state: offline fallback, LLM connected, loading, error, or cancelled.

Add a small viewport command affordance later:

- A compact "Ask AI" command bar near the viewport bottom or toolbar.
- It should submit into the same AI panel and expand/open the right panel if hidden.

## Recommended Implementation Phases

### Phase 1: Shared Command Protocol

Status: implemented.

- Promote `OperationCommand`, `AgentResponse`, and validation helpers into a shared domain boundary that both frontend and backend can import or mirror.
- Add runtime validators for `OperationCommand` and `AgentResponse`.
- Rename or conceptually separate the current executor as `ViewerOperationExecutor` so it is clear that it owns browser-safe viewer operations.
- Add tests that invalid LLM-like payloads never reach the viewer executor.

Implemented in `src/domain/protocol.ts`, `src/domain/validators.ts`, `src/domain/executor.ts`, and focused tests.

### Phase 2: Async Agent Adapter And Local Fallback

Status: implemented.

- Introduce `AgentAdapter` with async `respond(request): Promise<AgentResponse>`.
- Wrap the existing rule parser as `RuleParserAdapter`.
- Update `AgentPanel` to support loading, errors, retry, and cancellable requests.
- Keep current behavior working with no network dependency.

Implemented in `src/agent/adapters.ts` and `src/components/AgentPanel.tsx`. The frontend uses `VITE_AGENT_API_URL` when present; otherwise it uses `/api/agent/respond`, which is expected to be served by the local agent API through the Vite proxy. The local rule parser adapter remains available, but is not the default network-failure fallback.

### Phase 3: Scene Context Layer

Status: implemented.

- Add `buildAgentContext(scene, history)` with a compact scene summary.
- Send mesh metadata, selection, display mode, recent history, and supported actions.
- Do not send raw geometry buffers, imported file contents, or vtk datasets by default.

Implemented in `src/agent/context.ts`; tests assert that raw geometry and imported payload markers are omitted.

### Phase 4: Backend LLM Endpoint

Status: implemented as local API skeleton with mock, OpenAI-compatible, Azure OpenAI, and Azure AI Inference provider modes.

- Add a small local backend/proxy endpoint such as `POST /api/agent/respond`.
- Containerize the backend so it can run in Docker Desktop via Docker Compose.
- Store provider credentials in server environment variables only.
- Use structured output/tool schema so the model returns one of the allowed response shapes.
- Include a mock mode for tests and local demos without credentials.
- Return command drafts, clarification requests, messages, or future action plans rather than executing commands directly.

Implemented under `backend/agent-api/`. The backend normalizes and validates all responses before returning them to the browser.

### Phase 4.5: Local Docker Compose Runtime

Status: implemented.

- Add `Dockerfile` and `docker-compose.yml` for the local agent API.
- Decide whether the frontend stays as a host Vite dev server or gets a lightweight web container for demos.
- Add `.env.example` with local-only LLM configuration names and no real secrets.
- Document startup commands for Docker Desktop.
- Keep ports, CORS, and API base URL explicit so the browser app can call the local container reliably.

The frontend stays as the host Vite dev server for now. The agent API runs as `agent-api` on port `8787`.

Startup:

```bash
cp .env.example .env
docker compose up --build agent-api
npm run dev
```

`npm run dev` uses the Vite dev proxy to forward `/api/agent/respond` to `http://127.0.0.1:8787`, so no frontend environment variable is required for the default Docker-backed local workflow.

Default `AGENT_MODE=mock` needs no credentials. To use an OpenAI-compatible endpoint, set `AGENT_MODE=llm`, `LLM_BASE_URL`, `LLM_MODEL`, and `LLM_API_KEY` in local environment variables or `.env`. For Azure AI Inference / AI Services, set `LLM_PROVIDER=azure-ai-inference` and use the Cognitive Services model endpoint; the provider client appends `/openai/v1` when needed.

### Phase 5: AI Review UI

Status: implemented.

- Replace parse/execute with send/review/confirm.
- Show natural-language explanations and compact parameter summaries before JSON.
- Reuse the existing pending confirmation card pattern for risky actions.
- Keep manual operation tabs unchanged.

Implemented in `src/components/AgentPanel.tsx` and `src/styles.css` with a conversation feed, status footer, action review card, and collapsible JSON drawer.

### Phase 6: Multi-Step Viewer Plans

Status: implemented for viewer-safe plans and macro drafts.

- Add `actionPlan` display and execute one step at a time.
- Stop on failure or confirmation.
- Record each applied step in history with the original user request attached.
- Keep v1 plans limited to browser-safe viewer commands.

Implemented in the AI panel and shared `AgentResponse` protocol. Plan execution stops when the viewer executor returns preview, failed, or rejected status.

### Phase 7: Backend Geometry And Simulation Jobs

Status: protocol foundation implemented; real workers are still future work.

- Introduce local backend job commands for true geometry cutting, meshing, and solver execution.
- Run early job workers as Docker Desktop containers before considering cloud or HPC integration.
- Add job state to the UI: queued, running, failed, completed, cancelled.
- Let the viewer display job outputs such as generated meshes, scalar fields, screenshots, or result summaries.
- Keep these commands separate from immediate viewer commands so users can see when an operation is computationally heavy or irreversible.

Implemented as `backendJobDraft` in `AgentResponse` and `BackendJob` protocol types in `src/domain/jobs.ts`. No real geometry or solver worker is started yet.

### Phase 8: Advanced Design Iteration Loop

Status: first protocol/UI foundation implemented.

- Add scene question answering: "what is selected?", "which parts are hidden?".
- Add target disambiguation for fuzzy names.
- Add safe macro generation for repetitive operations.
- Add compare-and-suggest loops for simulation results, such as "run variant B and summarize pressure drop changes".
- Consider geometry upload or server-side analysis only after explicit user consent.

Implemented as `sceneAnswer` and `macroDraft` response kinds plus mock backend support. Simulation compare-and-suggest remains blocked on future job execution/results.

## Verification

Current validation commands:

```bash
npm --prefix backend/agent-api run check
npm --prefix backend/agent-api run smoke
npm run lint
npm test
npm run build
npm run smoke:browser
```

## Initial Prompt Policy

The LLM should be instructed to:

- Return only the structured response schema.
- Prefer clarification when target, angle, count, axis, or keep side is ambiguous.
- Refuse unsupported geometry operations instead of inventing actions.
- Use exact mesh ids from context.
- Never exceed executor limits, such as clone count limits.
- Treat locked objects as not editable unless the user explicitly asks to unlock them first.
- Default destructive or visually confusing operations to preview/review.
- Classify commands as viewer-safe or backend-job-required.
- Do not claim that a simulation result is known unless a solver or explicit result source produced it.

## Remaining Open Questions

- Should low-risk commands like `resetView` and `selectMesh` auto-apply, or should all LLM commands require confirmation in v1?
- Should conversation history persist across refreshes, or stay session-only?
- Should the shared command schema live in a dedicated package now, or be mirrored between frontend and backend until the backend shape is stable?

## Recommendation

Do not replace the whole agent layer with a direct LLM call. For this requirement, implement an LLM-backed controlled operation agent that runs local-first. The backend should run in Docker Desktop and generate validated `OperationCommand` drafts; the frontend should review and execute lightweight viewer commands through `ViewerOperationExecutor`; future true geometry and simulation work should enter through local backend job commands first. Cloud deployment can remain a later portability option, not a design requirement for the current project.
