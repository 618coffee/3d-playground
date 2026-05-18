# Clipboard Mesh References Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add keyboard copy/paste for selected meshes and chat composer paste mentions that keep hidden mesh ID references.

**Architecture:** `App` owns an app-level mesh clipboard and completes workbench copy/paste directly through the existing `cloneMesh` command executor. `AgentPanel` receives read-only clipboard entries for textarea paste, stores mention bindings for the current draft, and passes those bindings through the agent request. A small parser/type extension lets hidden mention bindings resolve to stable mesh IDs.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, existing operation executor/history/runtime abstractions.

---

## File Structure

- Create `src/domain/meshClipboard.ts`: typed mesh clipboard snapshots, mention labels, and deterministic clone-paste offset helper.
- Create `src/domain/meshClipboard.test.ts`: focused tests for snapshot filtering and non-overlap offset math.
- Modify `src/domain/protocol.ts`: add `AgentMeshReference` and optional `meshReferences` to `AgentRequest` and stored request metadata.
- Modify `src/agent/types.ts`: allow `AgentParser.parse(text, scene, meshReferences?)`.
- Modify `src/agent/adapters.ts`: pass request `meshReferences` into the rule parser.
- Modify `src/agent/ruleParser.ts`: resolve explicit pasted `@Name` mentions through hidden mesh references before name/selection fallback.
- Modify `src/agent/ruleParser.test.ts`: add mention-binding resolution coverage.
- Modify `src/components/AgentPanel.tsx`: paste mesh mentions into the textarea and include hidden bindings in sent requests.
- Modify `src/components/AgentPanel.test.tsx`: cover visible mention insertion and request payload bindings.
- Modify `src/App.tsx`: own clipboard state, handle workbench copy/paste shortcuts, and pass clipboard entries to `AgentPanel`.
- Modify `src/App.test.tsx`: cover workbench shortcut cloning and direct ownership by `App`.
- Modify `docs/designs/clipboard-mesh-references.md`: prepend solution notes after implementation and verification.

---

### Task 1: Mesh Clipboard Helpers

**Files:**
- Create: `src/domain/meshClipboard.ts`
- Test: `src/domain/meshClipboard.test.ts`

- [ ] **Step 1: Write failing helper tests**

Create `src/domain/meshClipboard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { MeshEntity } from './actions';
import { createMeshClipboardEntries, defaultClonePasteOffset, meshMentionText } from './meshClipboard';

const baseMesh: MeshEntity = {
  id: 'fan-stage',
  name: 'Blue titanium fan stage',
  sourceFormat: 'procedural',
  visible: true,
  locked: false,
  selected: true,
  color: '#7bd389',
  opacity: 1,
  bounds: [-60, -20, -35, 35, -35, 35],
  stats: { points: 240, cells: 160, triangles: 160 },
  transform: { position: [-38, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
};

describe('mesh clipboard helpers', () => {
  it('snapshots selected meshes in selection order', () => {
    const second = { ...baseMesh, id: 'compressor-core', name: 'Compressor core', bounds: [-20, 35, -22, 22, -22, 22] };

    const entries = createMeshClipboardEntries([baseMesh, second], ['compressor-core', 'fan-stage']);

    expect(entries.map((entry) => entry.id)).toEqual(['compressor-core', 'fan-stage']);
    expect(entries[0]).toMatchObject({ id: 'compressor-core', name: 'Compressor core' });
  });

  it('computes a positive x offset large enough to avoid overlap', () => {
    const entries = createMeshClipboardEntries([baseMesh], ['fan-stage']);

    expect(defaultClonePasteOffset(entries)).toEqual([60, 0, 0]);
  });

  it('uses a readable mention text without exposing raw ids', () => {
    expect(meshMentionText([{ id: 'fan-stage', name: 'Blue titanium fan stage', bounds: baseMesh.bounds, transform: baseMesh.transform }])).toBe('@Blue titanium fan stage');
  });
});
```

- [ ] **Step 2: Run helper tests to verify RED**

Run: `npm test -- src/domain/meshClipboard.test.ts`

Expected: FAIL because `src/domain/meshClipboard.ts` does not exist.

- [ ] **Step 3: Implement helpers minimally**

Create `src/domain/meshClipboard.ts`:

```ts
import type { MeshEntity, Vec3 } from './actions';

export type MeshClipboardEntry = {
  id: string;
  name: string;
  bounds: MeshEntity['bounds'];
  transform: MeshEntity['transform'];
};

export function createMeshClipboardEntries(meshes: readonly MeshEntity[], selection: readonly string[]): MeshClipboardEntry[] {
  return selection
    .map((id) => meshes.find((mesh) => mesh.id === id))
    .filter((mesh): mesh is MeshEntity => Boolean(mesh))
    .map((mesh) => ({
      id: mesh.id,
      name: mesh.name,
      bounds: [...mesh.bounds],
      transform: {
        position: [...mesh.transform.position],
        rotationDeg: [...mesh.transform.rotationDeg],
        scale: [...mesh.transform.scale],
      },
    }));
}

export function defaultClonePasteOffset(entries: readonly MeshClipboardEntry[]): Vec3 {
  if (entries.length === 0) return [20, 0, 0];
  const minX = Math.min(...entries.map((entry) => entry.bounds[0]));
  const maxX = Math.max(...entries.map((entry) => entry.bounds[1]));
  return [Math.max(20, maxX - minX + 20), 0, 0];
}

export function meshMentionText(entries: readonly Pick<MeshClipboardEntry, 'name'>[]): string {
  return entries.map((entry) => `@${entry.name}`).join(' ');
}
```

- [ ] **Step 4: Run helper tests to verify GREEN**

Run: `npm test -- src/domain/meshClipboard.test.ts`

Expected: PASS.

---

### Task 2: Workbench Keyboard Copy/Paste In App

**Files:**
- Modify: `src/App.tsx`
- Test: `src/App.test.tsx`

- [ ] **Step 1: Write failing App shortcut test**

Add this test to `src/App.test.tsx` inside `describe('App agent draft previews', ...)`:

```ts
  it('copies the selected mesh and pastes an offset clone from the workbench keyboard shortcuts', async () => {
    vi.stubGlobal('fetch', vi.fn());

    render(<App />);

    await waitFor(() => expect(runtimeMock.runtime.addMesh).toHaveBeenCalled());
    runtimeMock.runtime.cloneMesh.mockClear();

    fireEvent.keyDown(window, { key: 'c', code: 'KeyC', metaKey: true });
    fireEvent.keyDown(window, { key: 'v', code: 'KeyV', metaKey: true });

    await waitFor(() => expect(runtimeMock.runtime.cloneMesh).toHaveBeenCalledTimes(1));
    expect(runtimeMock.runtime.cloneMesh).toHaveBeenCalledWith('fan-stage', expect.objectContaining({
      id: expect.stringContaining('fan-stage-clipboard-paste-'),
      name: 'Blue titanium fan stage-copy-1',
      transform: expect.objectContaining({ position: expect.any(Array) }),
    }));
    const clone = runtimeMock.runtime.cloneMesh.mock.calls[0][1];
    expect(clone.transform.position[0]).toBeGreaterThan(0);
    expect(within(screen.getByText('操作时间线').closest('.history-panel') as HTMLElement).getByText('cloneMesh')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run App test to verify RED**

Run: `npm test -- src/App.test.tsx -t "copies the selected mesh"`

Expected: FAIL because no keyboard clipboard handler exists.

- [ ] **Step 3: Implement App clipboard shortcuts**

In `src/App.tsx`:

- Import helper types/functions:

```ts
import { createMeshClipboardEntries, defaultClonePasteOffset, type MeshClipboardEntry } from './domain/meshClipboard';
```

- Add state near other `useState` calls:

```ts
  const [meshClipboard, setMeshClipboard] = useState<MeshClipboardEntry[]>([]);
```

- Add handlers before the render return:

```ts
  const copySelectionToMeshClipboard = useCallback(() => {
    const entries = createMeshClipboardEntries(scene.meshes, scene.selection);
    if (entries.length === 0) return false;
    setMeshClipboard(entries);
    setLastMessage(`已复制 ${entries.length} 个对象引用。`);
    return true;
  }, [scene.meshes, scene.selection]);

  const pasteMeshClipboardAsClones = useCallback(() => {
    const validIds = meshClipboard
      .map((entry) => entry.id)
      .filter((id) => scene.meshes.some((mesh) => mesh.id === id));
    if (validIds.length === 0) return false;
    execute({
      id: `clipboard-paste-${Date.now()}`,
      type: 'cloneMesh',
      target: { meshIds: validIds },
      params: {
        count: 1,
        offset: defaultClonePasteOffset(meshClipboard.filter((entry) => validIds.includes(entry.id))),
        unit: scene.unit,
        shareGeometry: true,
        namePattern: '{name}-copy-{n}',
      },
      source: 'ui',
      rawText: 'keyboard paste clone',
    });
    return true;
  }, [execute, meshClipboard, scene.meshes, scene.unit]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (isTextEditableElement(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === 'c' && copySelectionToMeshClipboard()) event.preventDefault();
      if (key === 'v' && pasteMeshClipboardAsClones()) event.preventDefault();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [copySelectionToMeshClipboard, pasteMeshClipboardAsClones]);
```

- Add this helper near existing bottom helpers:

```ts
function isTextEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select';
}
```

- Thread `meshClipboard={meshClipboard}` through `InspectorPanel` in Task 5 so `AgentPanel` receives read-only clipboard entries without owning workbench paste.

- [ ] **Step 4: Run App test to verify GREEN**

Run: `npm test -- src/App.test.tsx -t "copies the selected mesh"`

Expected: PASS.

---

### Task 3: Agent Request Mesh Reference Types And Parser Resolution

**Files:**
- Modify: `src/domain/protocol.ts`
- Modify: `src/agent/types.ts`
- Modify: `src/agent/adapters.ts`
- Modify: `src/agent/ruleParser.ts`
- Test: `src/agent/ruleParser.test.ts`

- [ ] **Step 1: Write failing parser test**

Add this test to `src/agent/ruleParser.test.ts`:

```ts
  it('resolves pasted @mentions through hidden mesh reference ids', () => {
    const result = parser.parse('把 @Fan 旋转 45 度', scene, [{ label: '@Fan', meshId: 'compressor-core' }]);

    expect(result.kind).toBe('action');
    if (result.kind !== 'action') return;
    expect(result.action.type).toBe('rotateMesh');
    expect(result.action.target).toEqual({ meshId: 'compressor-core' });
  });
```

- [ ] **Step 2: Run parser test to verify RED**

Run: `npm test -- src/agent/ruleParser.test.ts -t "resolves pasted"`

Expected: FAIL because `AgentParser.parse` only accepts two arguments and mention bindings are ignored.

- [ ] **Step 3: Add mesh reference types and parser plumbing**

In `src/domain/protocol.ts`:

```ts
export type AgentMeshReference = {
  label: string;
  meshId: string;
};
```

Then extend `AgentChatMessage.request` and `AgentRequest`:

```ts
  request?: {
    text: string;
    mode: AgentMode;
    modelRouterId: ModelRouterId;
    meshReferences?: AgentMeshReference[];
  };
```

```ts
  meshReferences?: AgentMeshReference[];
```

In `src/agent/types.ts`:

```ts
import type { AgentAdapter, AgentMeshReference, AgentRequest, AgentResponse } from '../domain/protocol';
```

```ts
  parse: (text: string, scene: SceneState, meshReferences?: readonly AgentMeshReference[]) => AgentParseResult;
```

In `src/agent/adapters.ts`:

```ts
const response = parseResultToAgentResponse(parser.parse(request.text, request.scene, request.meshReferences));
```

- [ ] **Step 4: Resolve explicit mentions in rule parser**

In `src/agent/ruleParser.ts`:

- Import `AgentMeshReference`.
- Change `parse(text, scene)` to `parse(text, scene, meshReferences = [])`.
- Pass `meshReferences` into every `resolveTarget(...)` call.
- Change `resolveTarget` signature to:

```ts
function resolveTarget(text: string, scene: SceneState, command: ParserCommand, meshReferences: readonly AgentMeshReference[] = []): MeshTarget | undefined {
```

- Add mention resolution before name extraction fallback:

```ts
  const mentionTarget = targetFromMention(text, meshReferences, scene);
  if (mentionTarget) return mentionTarget;
```

- Add helper near `targetFromName`:

```ts
function targetFromMention(text: string, meshReferences: readonly AgentMeshReference[], scene: SceneState): MeshTarget | undefined {
  const matches = meshReferences.filter((reference) => text.includes(reference.label));
  const existingIds = matches
    .map((reference) => reference.meshId)
    .filter((id) => scene.meshes.some((mesh) => mesh.id === id));
  if (existingIds.length === 0) return undefined;
  return existingIds.length === 1 ? { meshId: existingIds[0] } : { meshIds: [...new Set(existingIds)] };
}
```

- [ ] **Step 5: Run parser test to verify GREEN**

Run: `npm test -- src/agent/ruleParser.test.ts -t "resolves pasted"`

Expected: PASS.

---

### Task 4: AI Composer Paste Mentions And Hidden Bindings

**Files:**
- Modify: `src/components/AgentPanel.tsx`
- Test: `src/components/AgentPanel.test.tsx`

- [ ] **Step 1: Write failing AgentPanel paste/request test**

Add imports if needed:

```ts
import type { MeshClipboardEntry } from '../domain/meshClipboard';
```

Add this test to `src/components/AgentPanel.test.tsx`:

```ts
  it('pastes mesh clipboard entries as visible mentions and sends hidden mesh references', async () => {
    clearAgentChatStorage();
    const requestBodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ kind: 'message', text: 'ok' }), { status: 200 });
    }));
    const meshClipboard: MeshClipboardEntry[] = [
      {
        id: 'fan-stage',
        name: 'Blue titanium fan stage',
        bounds: [-60, -20, -35, 35, -35, 35],
        transform: { position: [-38, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
      },
      {
        id: 'compressor-core',
        name: 'Compressor core',
        bounds: [-20, 35, -22, 22, -22, 22],
        transform: { position: [8, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
      },
    ];

    render(
      <AgentPanel
        scene={createInitialScene()}
        selectedMeshes={[]}
        historyEntries={[]}
        pendingCommand={null}
        onExecute={vi.fn()}
        meshClipboard={meshClipboard}
      />,
    );

    const input = screen.getByLabelText('AI 指令输入');
    fireEvent.paste(input, { clipboardData: { getData: () => '' } });
    expect(input).toHaveValue('@Blue titanium fan stage @Compressor core');

    fireEvent.change(input, { target: { value: '把 @Blue titanium fan stage 旋转 30 度，把 @Compressor core 右移 20mm' } });
    fireEvent.click(screen.getByRole('button', { name: '发送指令' }));

    await waitFor(() => expect(requestBodies).toHaveLength(1));
    expect(requestBodies[0].text).toBe('把 @Blue titanium fan stage 旋转 30 度，把 @Compressor core 右移 20mm');
    expect(requestBodies[0].meshReferences).toEqual([
      { label: '@Blue titanium fan stage', meshId: 'fan-stage' },
      { label: '@Compressor core', meshId: 'compressor-core' },
    ]);
  });
```

Add this normal paste guard test to the same file:

```ts
  it('does not intercept normal textarea paste when no mesh clipboard is available', () => {
    render(
      <AgentPanel
        scene={createInitialScene()}
        selectedMeshes={[]}
        historyEntries={[]}
        pendingCommand={null}
        onExecute={vi.fn()}
      />,
    );

    const input = screen.getByLabelText('AI 指令输入');
    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, 'clipboardData', { value: { getData: () => 'normal text' } });
    const preventDefault = vi.spyOn(pasteEvent, 'preventDefault');

    input.dispatchEvent(pasteEvent);

    expect(preventDefault).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run AgentPanel test to verify RED**

Run: `npm test -- src/components/AgentPanel.test.tsx -t "pastes mesh clipboard|does not intercept normal textarea paste"`

Expected: FAIL because `meshClipboard` prop and paste behavior do not exist.

- [ ] **Step 3: Implement composer paste mention state**

In `src/components/AgentPanel.tsx`:

- Import types/helpers:

```ts
import { meshMentionText, type MeshClipboardEntry } from '../domain/meshClipboard';
import type { ActionRisk, AgentAdapter, AgentChatMessage, AgentChatSession, AgentConversationTurn, AgentMeshReference, AgentMode, AgentPlanStep, AgentResponse, ModelRouterId } from '../domain/protocol';
```

- Extend props:

```ts
  meshClipboard?: MeshClipboardEntry[];
```

- Destructure default:

```ts
export function AgentPanel({ scene, selectedMeshes = [], meshClipboard = [], historyEntries, pendingCommand, onExecute, onConfirmPending, onCancelPending, onPreviewDraft }: AgentPanelProps) {
```

- Add state:

```ts
  const [draftMeshReferences, setDraftMeshReferences] = useState<AgentMeshReference[]>([]);
```

- Add textarea paste handler:

```ts
  const pasteMeshReferencesIntoComposer = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (meshClipboard.length === 0) return;
    event.preventDefault();
    const mentionText = meshMentionText(meshClipboard);
    const target = event.currentTarget;
    const start = target.selectionStart ?? text.length;
    const end = target.selectionEnd ?? text.length;
    const prefix = text.slice(0, start);
    const suffix = text.slice(end);
    const spacerBefore = prefix && !/\s$/.test(prefix) ? ' ' : '';
    const spacerAfter = suffix && !/^\s/.test(suffix) ? ' ' : '';
    setText(`${prefix}${spacerBefore}${mentionText}${spacerAfter}${suffix}`);
    setDraftMeshReferences((current) => mergeMeshReferences(current, meshClipboard));
  };
```

- Add `onPaste={pasteMeshReferencesIntoComposer}` to the textarea.

- Include references when appending and sending request:

```ts
    const meshReferencesForRequest = draftMeshReferences.filter((reference) => prompt.includes(reference.label));
```

Use `meshReferencesForRequest` in `request` metadata and adapter request:

```ts
request: { text: prompt, mode: currentSession.mode, modelRouterId: currentSession.modelRouterId, meshReferences: meshReferencesForRequest },
```

```ts
meshReferences: meshReferencesForRequest,
```

- Clear draft references after send and new/open/delete session paths where `setText('')` or session reset happens:

```ts
setDraftMeshReferences([]);
```

- Add helper near other helpers:

```ts
function mergeMeshReferences(current: readonly AgentMeshReference[], entries: readonly MeshClipboardEntry[]): AgentMeshReference[] {
  const next = [...current];
  entries.forEach((entry) => {
    const reference = { label: `@${entry.name}`, meshId: entry.id };
    if (!next.some((item) => item.label === reference.label && item.meshId === reference.meshId)) next.push(reference);
  });
  return next;
}
```

- [ ] **Step 4: Run AgentPanel test to verify GREEN**

Run: `npm test -- src/components/AgentPanel.test.tsx -t "pastes mesh clipboard|does not intercept normal textarea paste"`

Expected: PASS.

---

### Task 5: Wire Clipboard Prop From App To AgentPanel

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/InspectorPanel.tsx`
- Test: `src/App.test.tsx`

- [ ] **Step 1: Thread the clipboard through InspectorPanel**

In `src/components/InspectorPanel.tsx`, import the clipboard type:

```ts
import type { MeshClipboardEntry } from '../domain/meshClipboard';
```

Add the prop to `InspectorPanelProps`:

```ts
  meshClipboard?: MeshClipboardEntry[];
```

Destructure it in `InspectorPanel`:

```ts
export function InspectorPanel({ scene, selectedMesh, selectedMeshes, meshClipboard = [], historyEntries, pendingCommand, onConfirmPending, onCancelPending, onExecute, onPreviewDraft, onHidePanel }: InspectorPanelProps) {
```

Pass it to `AgentPanel`:

```tsx
<AgentPanel
  scene={scene}
  selectedMeshes={selectedMeshes}
  meshClipboard={meshClipboard}
  historyEntries={historyEntries}
  pendingCommand={pendingCommand}
  onExecute={onExecute}
  onConfirmPending={onConfirmPending}
  onCancelPending={onCancelPending}
  onPreviewDraft={onPreviewDraft}
/>
```

- [ ] **Step 2: Pass App-owned clipboard to InspectorPanel**

In `src/App.tsx`, update the `InspectorPanel` call:

```tsx
<InspectorPanel
  scene={scene}
  selectedMesh={selectedMesh}
  selectedMeshes={selectedMeshes}
  meshClipboard={meshClipboard}
  historyEntries={historyEntries}
  pendingCommand={pendingCommand}
  onConfirmPending={confirmPending}
  onCancelPending={cancelPending}
  onExecute={execute}
  onPreviewDraft={previewDraft}
  onHidePanel={() => togglePanel('right')}
/>
```

- [ ] **Step 3: Run TypeScript compile check for prop wiring**

Run: `npm run lint`

Expected: PASS.

---

### Task 6: Regression Suite And Documentation

**Files:**
- Modify: `docs/designs/clipboard-mesh-references.md`

- [ ] **Step 1: Run targeted tests**

Run:

```bash
npm test -- src/domain/meshClipboard.test.ts src/agent/ruleParser.test.ts src/components/AgentPanel.test.tsx src/App.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run full verification**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 3: Update solution notes**

Prepend a solution section to `docs/designs/clipboard-mesh-references.md` with this exact structure and the observed verification results from Steps 1 and 2:

```md
# Solution

## Summary

Implemented app-level mesh clipboard support for workbench clone paste and AI chat mention paste. Workbench paste is handled by `App` through `cloneMesh`; `AgentPanel` only consumes clipboard entries for visible `@Name` mentions and hidden mesh ID request bindings.

## Changed Files

- `src/domain/meshClipboard.ts`: Added clipboard snapshot, mention text, and clone offset helpers.
- `src/domain/protocol.ts`: Added mesh reference request metadata.
- `src/agent/types.ts`: Allowed parser calls to receive hidden mesh references.
- `src/agent/adapters.ts`: Passed hidden references to the offline parser.
- `src/agent/ruleParser.ts`: Resolved pasted mentions through mesh IDs.
- `src/components/AgentPanel.tsx`: Added chat paste mention behavior and request bindings.
- `src/App.tsx`: Added app-owned keyboard mesh clipboard and workbench paste clone behavior.
- `src/domain/meshClipboard.test.ts`, `src/agent/ruleParser.test.ts`, `src/components/AgentPanel.test.tsx`, `src/App.test.tsx`: Added regression coverage.

## Verification

- `npm test -- src/domain/meshClipboard.test.ts src/agent/ruleParser.test.ts src/components/AgentPanel.test.tsx src/App.test.tsx`: record the observed exit status and pass/fail summary from Step 1.
- `npm run lint`: record the observed exit status from Step 2.

## Follow-Ups

- Rich, chip-like mention rendering remains out of scope for this pass.

---
```

---

## Self-Review

- Spec coverage: Workbench copy, workbench paste clone, non-overlap offset, chat mention paste, hidden mesh IDs, multiple mentions, normal input behavior, and documentation update are covered by Tasks 1-6.
- Placeholder scan: No unresolved implementation markers remain in the plan.
- Type consistency: `MeshClipboardEntry`, `AgentMeshReference`, `meshReferences`, and parser signatures are introduced before later tasks depend on them.