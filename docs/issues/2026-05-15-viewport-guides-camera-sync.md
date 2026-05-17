# Viewport Guides Camera Sync

## Solution

### Summary

The grid and axes now come from projected vtk world coordinates instead of fixed CSS transforms. The vtk runtime emits viewport guide updates when the active camera changes, during interaction animation, after resize, and after explicit renders. `ViewerPanel` renders those projected points as SVG lines, so the guide layer follows orbit, pan, zoom, and view reset.

The viewport controls were also tightened into compact top-left toolbar groups. Selection, object rotation, and coordinate-grid toggling sit together as utility controls. Display mode and orientation are adjacent compact dropdown-style selectors that match the toolbar button height and visual treatment while keeping the current state readable. The selectors open on hover, focus, or current-button click, and close after an option is chosen.

### Changed Files

- `src/viewer/vtkRuntime.ts`: added viewport guide snapshots, camera/interactor subscriptions, and world-to-display projection helpers.
- `src/components/ViewerPanel.tsx`: renders grid, X/Y/Z world axes, and the mini axis triad from runtime projection snapshots.
- `src/components/ViewerPanel.tsx`: places display-mode and orientation switching inside the viewport toolbar as compact current-state selectors, with coordinate-grid toggling grouped beside selection tools.
- `src/components/ViewerPanel.test.tsx`: added regression coverage for guide geometry updates after runtime camera changes, toolbar placement for orientation switching, display-mode dropdown behavior, and coordinate-grid grouping.
- `src/styles.css`: updated guide styles from fixed CSS transforms to projected SVG lines and labels, and styled the compact toolbar selectors.
- `backend/agent-api/src/validation.js`: normalized common string booleans from LLM responses so clone drafts are not rejected when `shareGeometry` arrives as `"true"` or `"false"`.
- `backend/agent-api/src/validation.test.js`: covered boolean-like string normalization for clone payloads.

### Verification

- `npm test -- src/components/ViewerPanel.test.tsx`: passed, 4 tests.
- `npm test`: passed, 9 files and 47 tests.
- `npm run lint`: passed.
- `npm --prefix backend/agent-api run test`: passed, 3 tests.
- `npm --prefix backend/agent-api run check`: passed.
- Browser verification: grid toggle hides and shows the projected SVG grid; dragging changed the X axis from `x2=352.3/y2=212.04` to `x2=367.78/y2=189.29`; clone draft still showed `X 间距 20 mm` and `3 个复制体`.

### Follow-Ups

- DOM-projected guides do not perform depth occlusion. If users need CAD-style hidden-line behavior, move the grid and axes to vtk actors later.

---

## Status

Fixed and verified.

## Context

The viewport now shows a grid, axis indicator, and clone spacing label, but the grid and axes are CSS overlays. They remain fixed on screen while the user orbits, pans, or zooms the 3D model, which makes them feel detached from the actual scene.

## Findings

- The current guide layer is rendered by React DOM in `ViewerPanel`, not by vtk.js or by a projection from vtk camera state.
- The guide layer has no subscription to camera changes, render events, or viewport size changes.
- This means the guide can show orientation labels, but it cannot communicate world-space position or distance during interaction.

## Reproduction Or Design Goals

- Load the workbench and observe the grid and axis guide.
- Orbit, pan, or zoom the model.
- Expected: world-space guides update with the same camera motion as the model.
- Actual: the guide stays fixed in screen space.

Acceptance criteria:

- X/Y/Z axes and grid points are projected from world coordinates to screen coordinates.
- Guides update after camera changes, resize, and view reset.
- The user can still toggle the grid on and off.
- Clone spacing annotation remains visible for pending clone drafts.

## Proposed Approach

Expose a lightweight camera projection snapshot from the vtk runtime and render the guide layer from projected world-space points in `ViewerPanel`. This keeps the implementation low risk while making the visual guides track the actual 3D camera.

## Risks And Open Questions

- DOM-projected guides are still an overlay, not vtk actors, so hidden-line occlusion is approximate.
- Future work may move this into vtk actors for full depth behavior if needed.
