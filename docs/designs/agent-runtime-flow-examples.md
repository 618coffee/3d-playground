# Agent Runtime Flow Examples

## Purpose

This document shows representative runtime data for two real workbench prompts. It expands the implementation overview in `docs/designs/agent-runtime-implementation.md` with concrete JSON shapes and execution results.

The examples assume the app has just loaded the default turbofan workspace. The selected mesh is `fan-stage` (`Blue titanium fan stage`), the unit is `mm`, and display mode is `surface`.

The examples are intentionally abridged where the real payload would repeat every mesh in the scene. Field names, command shapes, and state transitions match the current implementation.

## Shared Context Snapshot

Both examples start from the same compact context shape produced by `buildAgentContext(scene, historyEntries)`. The real object includes every mesh; this excerpt shows the selected mesh plus one additional mesh.

```json
{
  "scene": {
    "unit": "mm",
    "displayMode": "surface",
    "selectedMeshIds": ["fan-stage"],
    "meshes": [
      {
        "id": "nacelle-casing",
        "name": "Nacelle translucent casing",
        "visible": true,
        "locked": false,
        "source": "procedural",
        "stats": { "points": 192, "cells": 96, "triangles": 192 },
        "bounds": [-55, 55, -44, 44, -44, 44],
        "transform": {
          "position": [0, 0, 0],
          "rotationDeg": [0, 0, 0],
          "scale": [1, 1, 1]
        },
        "clipping": { "active": false }
      },
      {
        "id": "fan-stage",
        "name": "Blue titanium fan stage",
        "visible": true,
        "locked": false,
        "source": "procedural",
        "stats": { "points": 392, "cells": 224, "triangles": 224 },
        "bounds": [-42, -30, -34, 34, -34, 34],
        "transform": {
          "position": [0, 0, 0],
          "rotationDeg": [0, 0, 0],
          "scale": [1, 1, 1]
        },
        "clipping": { "active": false }
      }
    ]
  },
  "recentHistory": [],
  "supportedActions": [
    "selectMesh",
    "rotateMesh",
    "cloneMesh",
    "setMeshScale",
    "clipMesh",
    "resetView",
    "setMeshVisibility",
    "setMeshLocked",
    "setDisplayMode",
    "importMesh"
  ],
  "safetyRules": [
    "Return only supported OperationCommand drafts; do not execute viewer or system code.",
    "Use mesh ids from the scene context and ask for clarification when the target is ambiguous.",
    "Do not request raw geometry, imported file contents, vtk datasets, or browser runtime objects.",
    "Risky visual clipping and large clone operations require user review before execution.",
    "Baked geometry cutting, meshing, solver runs, and arbitrary code execution are outside the browser-safe action set."
  ]
}
```

`AgentPanel` wraps the compact context into the request sent to the local API. The frontend currently sends both full serializable `scene` metadata and the compact `context`; the backend validates `scene` directly, while `context` is available for adapter and prompt evolution.

```json
{
  "id": "agent-request-example",
  "text": "<user prompt>",
  "scene": {
    "unit": "mm",
    "displayMode": "surface",
    "selection": ["fan-stage"],
    "meshes": ["...full MeshEntity metadata for every current mesh..."]
  },
  "conversation": [
    {
      "id": "user-example",
      "role": "user",
      "text": "<user prompt>",
      "timestamp": "2026-05-15T00:00:00.000Z"
    }
  ],
  "pendingCommand": null,
  "context": "...the compact buildAgentContext output above..."
}
```

## Example 1: Rotate The Current Selection

User prompt:

```text
把当前对象绕 Z 轴旋转 30 度
```

The backend sends the model the user text, validated scene metadata, and schema descriptions. For this prompt, it expects an action draft like this:

```json
{
  "kind": "actionDraft",
  "action": {
    "id": "rotateMesh-example",
    "type": "rotateMesh",
    "target": { "source": "selection" },
    "params": {
      "axis": "z",
      "angleDeg": 30,
      "pivot": "boundsCenter",
      "space": "world"
    },
    "source": "agent",
    "rawText": "把当前对象绕 Z 轴旋转 30 度",
    "confirmed": false
  },
  "explanation": "绕 Z 轴旋转 30 度。",
  "confidence": 0.74,
  "risk": {
    "level": "low",
    "summary": "浏览器内可撤销的查看器操作。",
    "warnings": [],
    "requiresConfirmation": false,
    "reversible": true
  }
}
```

The backend re-validates the returned `AgentResponse` before returning it to the browser.

When the user clicks `确认执行`, `AgentPanel` calls `onExecute(action)`. `OperationExecutor` resolves `{ "source": "selection" }` to `["fan-stage"]`, checks visibility and lock state, then calls `runtime.rotateMesh("fan-stage", "z", 30)`.

Executor result:

```json
{
  "actionId": "rotateMesh-example",
  "status": "applied",
  "message": "已旋转 30 度。",
  "affectedMeshIds": ["fan-stage"],
  "requiresConfirmation": false,
  "warnings": []
}
```

Scene metadata after execution:

```json
{
  "id": "fan-stage",
  "transform": {
    "position": [0, 0, 0],
    "rotationDeg": [0, 0, 30],
    "scale": [1, 1, 1]
  }
}
```

Runtime side effect:

```text
VtkRuntime.rotateMesh("fan-stage", "z", 30)
  -> actor.rotateZ(30)
  -> render()
```

`HistoryStore` updates the current scene snapshot for rotation commands, and the timeline shows `已旋转 30 度。`.

## Example 2: Cut The Current Object In Half

User prompt:

```text
沿 X=0 平面切开当前对象，只保留右半边
```

This is a viewer-safe visual clipping request, not a true geometry boolean operation. The requested plane is `X=0`, so the plane origin is `[0, 0, 0]` and the normal is `[1, 0, 0]`. `右半边` maps to `keepSide: "positive"` for the X axis.

For this prompt, the LLM provider should return a viewer-safe clip draft:

```json
{
  "kind": "actionDraft",
  "action": {
    "id": "clipMesh-example",
    "type": "clipMesh",
    "target": { "source": "selection" },
    "params": {
      "plane": { "origin": [0, 0, 0], "normal": [1, 0, 0] },
      "keepSide": "positive",
      "mode": "preview",
      "cap": true
    },
    "source": "agent",
    "rawText": "沿 X=0 平面切开当前对象，只保留右半边",
    "confirmed": false
  },
  "explanation": "创建视觉切割预览。",
  "confidence": 0.74,
  "risk": {
    "level": "medium",
    "summary": "执行前需要审阅。",
    "warnings": ["视觉切割需要用户检查预览后确认。"],
    "requiresConfirmation": true,
    "reversible": true
  }
}
```

The system prompt asks the model to use `mode: "applyVisualClip"` for simple plane-cut drafts. If the model instead returns a clarification or `geometryCut` job draft for this reversible request, backend validation can normalize it into a viewer-safe `clipMesh` action draft.

When the draft appears, `AgentPanel` calls `onPreviewDraft(action)`. For clip commands, `App.previewDraft()` immediately routes the command into `OperationExecutor` so the viewport can show the clipping plane before the user confirms.

Preview executor result:

```json
{
  "actionId": "clipMesh-example",
  "status": "preview",
  "message": "已生成切割预览，确认后再应用。",
  "affectedMeshIds": ["fan-stage"],
  "requiresConfirmation": true,
  "warnings": ["切割会改变可见几何范围，请先检查预览。"]
}
```

Preview runtime side effect:

```text
VtkRuntime.previewClip("fan-stage", {
  plane: { origin: [0, 0, 0], normal: [1, 0, 0] },
  keepSide: "positive",
  cap: true
})
  -> mapper.removeAllClippingPlanes()
  -> mapper.addClippingPlane(vtkPlane(origin=[0,0,0], normal=[1,0,0]))
  -> render()
```

At preview time, `HistoryStore` is not updated. `pendingCommand` is set so the AI panel can show `确认应用` / discard behavior.

When the user confirms, `App.confirmPending()` calls `execute({ ...pendingCommand, confirmed: true })`. For LLM-style `mode: "applyVisualClip"`, confirmation applies the visual clip to `SceneState` and records history.

The applied LLM-style command looks like this:

```json
{
  "id": "clipMesh-example",
  "type": "clipMesh",
  "target": { "source": "selection" },
  "params": {
    "plane": { "origin": [0, 0, 0], "normal": [1, 0, 0] },
    "keepSide": "positive",
    "mode": "applyVisualClip",
    "cap": true
  },
  "source": "agent",
  "rawText": "沿 X=0 平面切开当前对象，只保留右半边",
  "confirmed": true
}
```

Applied executor result:

```json
{
  "actionId": "clipMesh-example",
  "status": "applied",
  "message": "已应用视觉切割。",
  "affectedMeshIds": ["fan-stage"],
  "requiresConfirmation": false,
  "warnings": []
}
```

Scene metadata after confirmed visual clipping:

```json
{
  "id": "fan-stage",
  "clipping": {
    "plane": { "origin": [0, 0, 0], "normal": [1, 0, 0] },
    "keepSide": "positive",
    "cap": true
  }
}
```

The underlying procedural geometry is unchanged. The visible half-object effect comes from vtk mapper clipping planes, and undo restores the previous scene snapshot and rebuilds runtime actors without that clipping state.
