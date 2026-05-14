# Industrial Simulation MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a runnable browser MVP for an AI-assisted industrial 3D mesh workbench using vtk.js.

**Architecture:** The app is a Vite React TypeScript single-page workbench. React owns the UI, vtk.js is isolated behind a viewer/runtime layer, and all manual or agent-driven operations flow through a typed action executor.

**Tech Stack:** Vite, React, TypeScript, vtk.js, Vitest, Testing Library, Playwright-ready browser smoke checks.

---

## File Structure

- Create: `package.json` with scripts for dev, build, preview, test, lint.
- Create: `vite.config.ts`, `tsconfig*.json`, `index.html`.
- Create: `src/main.tsx`, `src/App.tsx`, `src/styles.css`.
- Create: `src/domain/actions.ts`, `src/domain/scene.ts`, `src/domain/history.ts`.
- Create: `src/agent/ruleParser.ts`, `src/agent/types.ts`.
- Create: `src/viewer/vtkRuntime.ts`, `src/viewer/sampleEngine.ts`.
- Create: `src/components/*` for TopBar, ObjectTree, ViewerPanel, Inspector, AgentPanel, HistoryTimeline.
- Create: `src/**/*.test.ts` for domain and agent behavior.
- Create: `src/test/setup.ts` for test environment.
- Create: `README.md` with run instructions and demo commands.

## Tasks

### Task 1: Scaffold Project

**Files:**

- Create: project config files and base Vite React app.
- Modify: keep existing `docs/` files intact.

- [x] Run `npm create vite@latest . -- --template react-ts` if compatible with existing docs; otherwise create equivalent files manually.
- [x] Install dependencies: `vtk.js`, `@vitejs/plugin-react`, `vite`, `typescript`, `react`, `react-dom`, `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`, `lucide-react`.
- [x] Verify scaffold with `npm run build` after initial config.

### Task 2: Domain Types And Tests

**Files:**

- Create: `src/domain/actions.ts`
- Create: `src/domain/scene.ts`
- Create: `src/domain/history.ts`
- Create: `src/domain/history.test.ts`

- [x] Write failing tests for history apply/undo/redo and scene cloning behavior.
- [x] Implement typed mesh entities, action commands, action results, history store.
- [x] Run `npm test -- src/domain/history.test.ts` and confirm green.

### Task 3: Agent Parser

**Files:**

- Create: `src/agent/types.ts`
- Create: `src/agent/ruleParser.ts`
- Create: `src/agent/ruleParser.test.ts`

- [x] Write failing tests for natural language commands: rotate, clone, clip, reset view, select.
- [x] Implement rule-based parser that returns whitelisted action JSON plus confidence and clarification requests.
- [x] Run `npm test -- src/agent/ruleParser.test.ts` and confirm green.

### Task 4: VTK Runtime And Sample Engine

**Files:**

- Create: `src/viewer/vtkRuntime.ts`
- Create: `src/viewer/sampleEngine.ts`

- [x] Implement a runtime wrapper around vtk.js GenericRenderWindow, renderer, actors, mappers, clipping planes, and camera controls.
- [x] Implement a procedural turbofan-style sample mesh made from public-domain-style generated geometry in code, so the app works even without downloading an external model.
- [x] Add file import hooks for STL/OBJ/PLY/VTP where vtk.js readers are available.

### Task 5: Workbench UI

**Files:**

- Create: `src/components/TopBar.tsx`
- Create: `src/components/ObjectTree.tsx`
- Create: `src/components/ViewerPanel.tsx`
- Create: `src/components/InspectorPanel.tsx`
- Create: `src/components/AgentPanel.tsx`
- Create: `src/components/HistoryTimeline.tsx`
- Modify: `src/App.tsx`, `src/styles.css`

- [x] Build the industrial workbench layout: top bar, object tree, central VTK viewport, inspector/operations/AI tabs, bottom history.
- [x] Add concise controls for load sample, import file, selection, display mode, rotate, clone, clip preview, reset camera.
- [x] Keep the UI desktop-first, compact, clear, and non-marketing.

### Task 6: Operation Execution Integration

**Files:**

- Create: `src/domain/executor.ts`
- Create: `src/domain/executor.test.ts`
- Modify: `src/App.tsx`

- [x] Write failing tests for rotate/clone/clip action normalization and history recording.
- [x] Implement executor that updates scene state and calls VTK runtime methods.
- [x] Connect manual UI and AgentPanel to the same executor.

### Task 7: Model Research And Asset Decision

**Files:**

- Modify: `README.md`
- Optional Create: `public/models/*` only when the source license is clear and direct download is reliable.

- [x] Search for a public aircraft engine or turbofan-related model with clear license and browser-usable format.
- [x] If a reliable model is found, add source attribution in README and wire it as a sample.
- [x] If no safe direct model is found, use the generated turbofan-style sample as the default and document how to import external STL/OBJ/PLY/VTP files.

### Task 8: Verification And Run

**Files:**

- Modify: `README.md`

- [x] Run `npm test`.
- [x] Run `npm run build`.
- [x] Start dev server with `npm run dev -- --host 127.0.0.1`.
- [x] Open the browser and verify the canvas renders a non-empty 3D scene and the AI commands execute.
