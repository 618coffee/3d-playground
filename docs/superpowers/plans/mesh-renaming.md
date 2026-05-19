# Mesh Renaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add undoable mesh renaming from both the object tree and the properties panel.

**Architecture:** Introduce rename as a first-class `OperationCommand` so all UI entry points share validation, history, and status messages. Components emit commands rather than mutating scene state directly.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, existing scene executor and history store.

---

## File Structure

- Modify `src/domain/actions.ts`: add the `renameMesh` command type.
- Modify `src/domain/validators.ts`: allow and validate rename command payloads.
- Modify `src/domain/executor.ts`: apply rename, allow locked targets, add messages and no-op history policy.
- Modify `src/domain/executor.test.ts`: cover applied rename, trimmed names, no-op rename, and locked mesh rename.
- Modify `src/components/ObjectTree.tsx`: add inline editing and an `onRename` callback.
- Create `src/components/ObjectTree.test.tsx`: cover object tree rename submission and empty-name cancellation.
- Modify `src/components/InspectorPanel.tsx`: make `PropertiesPanel` accept `onRename` and render editable selected-name UI.
- Modify `src/components/InspectorPanel.test.tsx`: cover properties rename submission.
- Modify `src/App.tsx`: wire both UI entry points to `renameMesh` commands.
- Modify `src/styles.css`: add compact rename input styles.

### Task 1: Domain Command

**Files:**
- Modify: `src/domain/actions.ts`
- Modify: `src/domain/validators.ts`
- Modify: `src/domain/executor.ts`
- Test: `src/domain/executor.test.ts`

- [ ] **Step 1: Write failing executor tests**

Add tests that execute `renameMesh` with `target: { meshId: 'fan-1' }`, verify the current mesh name changes, history records the command, whitespace is trimmed, unchanged names do not add a history entry, and locked meshes can be renamed.

- [ ] **Step 2: Run domain tests to verify failure**

Run: `npm test -- src/domain/executor.test.ts src/domain/validators.test.ts --run`

Expected: FAIL because `renameMesh` is not an accepted command type.

- [ ] **Step 3: Implement command shape and validation**

Add `renameMesh` to `OperationCommand`, `commandTypes`, and `validateOperationCommand`. Validate `params.name` with the existing non-empty string helper.

- [ ] **Step 4: Implement executor behavior**

In `applyToScene`, update matching mesh names to `command.params.name.trim()`. In `successMessage`, return `已重命名对象。`. In `historyPolicy`, ignore rename commands that do not change any target name. In `canOperateOnLocked`, allow `renameMesh`.

- [ ] **Step 5: Run domain tests to verify pass**

Run: `npm test -- src/domain/executor.test.ts src/domain/validators.test.ts --run`

Expected: PASS.

### Task 2: Object Tree Rename UI

**Files:**
- Modify: `src/components/ObjectTree.tsx`
- Create: `src/components/ObjectTree.test.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Write failing component tests**

Render `ObjectTree` with one mesh and an `onRename` mock. Double-click the object name, change the textbox value, press Enter, and expect `onRename('fan-1', 'New fan')`. Also verify whitespace-only input exits edit mode without calling `onRename`.

- [ ] **Step 2: Run object tree test to verify failure**

Run: `npm test -- src/components/ObjectTree.test.tsx --run`

Expected: FAIL because no edit textbox exists.

- [ ] **Step 3: Implement inline rename state**

Add `onRename?: (meshId: string, name: string) => void`, local `editingMeshId` and `editingName` state, and handlers for commit/cancel. Use Enter to commit, Escape to cancel, blur to commit, and stop propagation while editing so row selection does not fire accidentally.

- [ ] **Step 4: Add compact styles**

Style `.object-rename-input` to fit inside the existing object row without changing row height.

- [ ] **Step 5: Run object tree test to verify pass**

Run: `npm test -- src/components/ObjectTree.test.tsx --run`

Expected: PASS.

### Task 3: Properties Rename UI And Wiring

**Files:**
- Modify: `src/components/InspectorPanel.tsx`
- Modify: `src/components/InspectorPanel.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Write failing properties test**

Render `PropertiesPanel` with `onRename`, edit the selected-name textbox, press Enter, and expect `onRename('fan-1', 'Renamed fan')`.

- [ ] **Step 2: Run properties test to verify failure**

Run: `npm test -- src/components/InspectorPanel.test.tsx --run`

Expected: FAIL because the properties title is not editable.

- [ ] **Step 3: Implement editable properties title**

Add `onRename?: (meshId: string, name: string) => void` to `PropertiesPanel`. For single selection, render a labeled text input bound to the selected mesh name and commit on Enter or blur. For multi-selection, keep the summary text behavior.

- [ ] **Step 4: Wire App callbacks**

Add `renameMesh(meshId, name)` in `App.tsx` that executes a `renameMesh` command and pass it to `ObjectTree` and `PropertiesPanel`.

- [ ] **Step 5: Run component tests to verify pass**

Run: `npm test -- src/components/ObjectTree.test.tsx src/components/InspectorPanel.test.tsx --run`

Expected: PASS.

### Task 4: Final Verification And Documentation

**Files:**
- Modify: `docs/designs/mesh-renaming.md`

- [ ] **Step 1: Run focused test suite**

Run: `npm test -- src/domain/executor.test.ts src/domain/validators.test.ts src/components/ObjectTree.test.tsx src/components/InspectorPanel.test.tsx --run`

Expected: PASS.

- [ ] **Step 2: Run build or full test command if focused tests pass**

Run: `npm test -- --run`

Expected: PASS, or document any unrelated existing failure.

- [ ] **Step 3: Update solution notes**

Prepend a `# Solution` section to `docs/designs/mesh-renaming.md` with summary, changed files, verification, and follow-ups.
