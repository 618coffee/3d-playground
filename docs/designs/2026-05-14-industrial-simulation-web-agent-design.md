# AI 辅助工业三维网格工作台架构与 UI 设计

## Solution

## Summary

Implemented a runnable browser MVP for the AI-assisted industrial 3D mesh workbench. The app uses React, TypeScript, Vite, and vtk.js; it auto-loads a procedural turbofan-style sample model, supports STL/OBJ/PLY/VTP imports, provides object tree / viewer / inspector / operations / AI / history panels, and routes manual plus natural-language actions through the same typed operation executor.

## Changed Files

- `package.json`, `package-lock.json`, `vite.config.ts`, `tsconfig*.json`, `index.html`: project scaffold, scripts, build/test configuration, dependencies.
- `src/domain/*`: typed scene/action model, history store, operation executor, and tests.
- `src/agent/*`: rule-based natural-language parser and tests.
- `src/viewer/*`: vtk.js runtime wrapper and procedural turbofan-style sample model.
- `src/components/*`, `src/App.tsx`, `src/styles.css`: complete industrial workbench UI and browser interaction flow.
- `README.md`: run instructions, demo commands, architecture notes, public model resource research.
- `.gitignore`: ignores dependencies, build outputs, and generated TypeScript artifacts.

## Verification

- `npm test`: passed, 11 tests across 3 files.
- `npm run build`: passed, production bundle built successfully.
- `npm run dev -- --host 127.0.0.1`: Vite dev server started at `http://127.0.0.1:5173/`.
- Browser smoke test: opened the page, confirmed the procedural turbofan model auto-loads and renders in vtk.js, parsed and executed “把当前对象绕 Z 轴旋转 30 度”, and saw the operation recorded in the timeline.
- Imported STL smoke test: injected a tiny STL file through the browser import control, executed the AI rotate command, then clicked undo; the imported mesh remained visible and the timeline reported “已撤销 rotateMesh”.

## Follow-Ups

- Third-party aircraft engine models were researched, but the default sample remains procedural to avoid license and large-file distribution risk.
- True baked geometry cutting, VTU/scalar field support, and export workflows remain enhancement work.

## Current Implementation Delta

The original design below is preserved as historical context. The current implementation has moved beyond the initial pure-frontend MVP in several ways:

- A local `backend/agent-api` service now owns mock/LLM calls, provider credentials, response normalization, and server-side validation.
- The default frontend AI path calls `/api/agent/respond` through the Vite proxy; it no longer relies on direct in-component rule parsing for the normal demo path.
- `AgentResponse` now includes message, clarification, action draft, action plan, scene answer, macro draft, and backend job draft shapes.
- `OperationCommand` now includes scale, visibility, lock, display mode, import, and clear/apply visual clip behavior in addition to the original select/rotate/clone/clip/reset commands.
- There are two procedural sample workspaces: turbofan cutaway and robotic inspection cell.
- Future true geometry or simulation work is represented as `backendJobDraft` and `BackendJob` protocol types, but no real worker is implemented yet.

For the current technical implementation, see `docs/designs/agent-runtime-implementation.md`.

---

## Original Design

## Status

Designed. Not implemented yet.

## Context

这个项目用于展示工业仿真软件方向的实操能力。当前明确需求有三点：

1. 使用开源 VTK 渲染体系进行三维几何网格渲染。
2. 构建 AI agent，用自然语言实现对三维几何/网格的旋转、切割、复制等基本操作。
3. 可以在浏览器中展示。

第二点的业务边界目前仍在确认中，所以本设计先把自然语言能力抽象成可替换的 Agent Adapter 和受控 Action Schema。这样 MVP 可以先用规则解析展示完整链路，后续拿到更明确需求后再替换成真实 LLM tool calling 或后端 agent 编排。

当前仓库为空，适合从零搭建一个浏览器内的“AI 辅助工业三维网格工作台”。首屏应直接是可用工作台，而不是营销页或介绍页。

## Findings

- 浏览器端最合适的 VTK 路线是 `vtk.js`。它保留了 VTK 的核心渲染管线概念，能直接运行在 WebGL 上，适合几何网格、科学可视化和浏览器交互演示。
- 前端推荐 `React + Vite + TypeScript`。React 负责工作台 UI，vtk.js 实例由 viewer 服务层托管，避免 React 重渲染影响 WebGL 上下文。
- MVP 不需要后端。浏览器可以直接加载本地 STL/OBJ/PLY/VTP 文件并渲染。后端适合放在增强版，用于大文件管理、复杂几何切割、格式转换、项目持久化、LLM agent 编排。
- AI agent 不应该直接调用 VTK 对象，也不应该执行任意代码。自然语言应先变成白名单 JSON action，再由 Viewer Executor 校验和执行。
- “切割”需要分两层表达：视觉裁剪用于快速预览，不改变底层网格；真实几何切割会生成新 mesh，复杂度更高，适合增强版或后端 VTK 服务。
- 工业仿真 UI 应克制、密集、稳定，像轻量 CAD/CAE 工具，而不是大面积 hero、装饰卡片或营销页面。

## Design Goals

### Product Goals

- 用户打开浏览器后能直接进入三维工作台。
- 用户可以导入几何/网格文件，并在 VTK viewer 中查看、旋转、缩放、选择对象。
- 用户可以通过传统 UI 控件或自然语言命令触发同一套几何操作。
- 系统能展示 AI 对自然语言的解析结果，包括目标对象、操作类型、参数、风险和确认状态。
- 操作需要可预览、可确认、可撤销、可追踪，体现工程软件的可靠性。

### Technical Goals

- 渲染层、场景状态、操作执行、AI 解析、UI 面板彼此解耦。
- 所有三维操作统一经过 `OperationExecutor`，便于测试、审计和接入 agent。
- MVP 尽量纯前端运行，降低演示部署成本。
- 为后续真实仿真数据预留 VTU、标量场、截面、结果后处理能力。

### Non-Goals For MVP

- 不实现完整 CAE 求解器。
- 不做复杂布尔运算或工业级网格修复。
- 不依赖必须联网的云模型才能运行。
- 不做多人协同和账号系统。

## Proposed Approach

推荐先做一个纯前端 MVP：`React + Vite + TypeScript + vtk.js`。系统核心是一个浏览器内 3D 工作台，支持本地网格导入、VTK 渲染、对象选择、基础变换、非破坏性裁剪、复制、操作历史和 AI 命令面板。

AI 相关能力采用两阶段策略：

1. MVP 阶段使用规则解析和固定句式解析，例如“把当前对象绕 Z 轴旋转 30 度”“复制选中对象 3 个，间隔 20mm”“沿 X=0 平面裁剪”。这样不依赖云模型，也能稳定展示自然语言控制能力。
2. 增强阶段新增 LLM Adapter。LLM 只负责生成结构化 action JSON，仍由本地 schema validator 和 Viewer Executor 执行。

这样既能快速交付可演示作品，又不会把系统绑定在某个具体模型或服务商上。

## System Architecture

```text
Browser App
  ├─ Workbench UI
  │   ├─ TopBar
  │   ├─ ObjectTreePanel
  │   ├─ ViewerCanvas
  │   ├─ InspectorPanel
  │   ├─ OperationPanel
  │   ├─ AgentPanel
  │   └─ HistoryTimeline
  │
  ├─ Domain Services
  │   ├─ SceneManager
  │   ├─ MeshLoader
  │   ├─ SelectionService
  │   ├─ OperationExecutor
  │   ├─ HistoryStore
  │   └─ ProjectStore
  │
  ├─ VTK Runtime
  │   ├─ GenericRenderWindow
  │   ├─ Renderer
  │   ├─ RenderWindow
  │   ├─ Interactor
  │   ├─ Camera
  │   ├─ Actors / Mappers
  │   └─ Widgets / Planes
  │
  └─ Agent Runtime
      ├─ AgentAdapter
      ├─ RuleParser
      ├─ LlmToolCallingAdapter
      ├─ ActionSchemaValidator
      ├─ ConfirmationManager
      └─ ActionExplainer
```

### Layer Responsibilities

#### Workbench UI

负责浏览器里的可见体验：布局、面板、按钮、输入框、操作预览、错误提示、历史时间线。UI 不直接接触 vtk.js actor、mapper、renderer，只调用 domain services。

#### Domain Services

承接业务语义，是系统可测试性的核心。

- `SceneManager`：维护所有三维对象、选中状态、可见性、材质、bounds、transform 和 VTK 运行时引用。
- `MeshLoader`：根据文件扩展名选择 reader，把 STL/OBJ/PLY/VTP 等输入转换为统一 `MeshEntity`。
- `SelectionService`：处理对象树选择、viewport picking、选中高亮和操作目标解析。
- `OperationExecutor`：所有手动操作和 AI 操作的唯一执行入口，负责参数校验、执行、渲染刷新、历史记录、撤销/重做。
- `HistoryStore`：记录每个 action 的原始自然语言、结构化命令、执行状态、耗时、前后状态。
- `ProjectStore`：保存和恢复浏览器项目状态，MVP 可先使用 localStorage 或导出 JSON。

#### VTK Runtime

封装 vtk.js 运行时对象。它提供稳定接口给 `SceneManager` 和 `OperationExecutor`，避免 VTK 细节散落在 React 组件里。

#### Agent Runtime

把自然语言解析成结构化操作。它只输出 action，不直接操作 VTK，不执行任意脚本。

## Data Model

### Mesh Entity

```ts
type MeshEntity = {
  id: string;
  name: string;
  sourceFormat: 'stl' | 'obj' | 'ply' | 'vtp' | 'vtu' | 'vtk';
  visible: boolean;
  locked: boolean;
  selected: boolean;
  color: string;
  opacity: number;
  bounds: [number, number, number, number, number, number];
  stats: {
    points: number;
    cells: number;
    triangles?: number;
  };
  transform: {
    position: [number, number, number];
    rotationDeg: [number, number, number];
    scale: [number, number, number];
  };
  vtkRef: {
    actorId: string;
    mapperId: string;
    datasetId: string;
  };
};
```

### Operation Command

```ts
type OperationCommand =
  | {
      id: string;
      type: 'selectMesh';
      target: MeshTarget;
      params: { mode: 'replace' | 'add' | 'remove' };
      source: 'ui' | 'agent';
      rawText?: string;
    }
  | {
      id: string;
      type: 'rotateMesh';
      target: MeshTarget;
      params: {
        axis: 'x' | 'y' | 'z' | [number, number, number];
        angleDeg: number;
        pivot: 'boundsCenter' | 'origin' | [number, number, number];
        space: 'world' | 'local';
      };
      source: 'ui' | 'agent';
      rawText?: string;
    }
  | {
      id: string;
      type: 'clipMesh';
      target: MeshTarget;
      params: {
        plane: {
          origin: [number, number, number];
          normal: [number, number, number];
        };
        keepSide: 'positive' | 'negative';
        mode: 'preview' | 'applyVisualClip' | 'bakeGeometry';
        cap: boolean;
      };
      source: 'ui' | 'agent';
      rawText?: string;
    }
  | {
      id: string;
      type: 'cloneMesh';
      target: MeshTarget;
      params: {
        count: number;
        offset: [number, number, number];
        unit: 'mm' | 'cm' | 'm' | 'model';
        shareGeometry: boolean;
        namePattern: string;
      };
      source: 'ui' | 'agent';
      rawText?: string;
    }
  | {
      id: string;
      type: 'setCamera' | 'resetView';
      target: { scope: 'viewer' };
      params: Record<string, unknown>;
      source: 'ui' | 'agent';
      rawText?: string;
    };

type MeshTarget =
  | { meshId: string }
  | { meshIds: string[] }
  | { source: 'selection' }
  | { source: 'allVisible' }
  | { name: string; match: 'exact' | 'fuzzy' };
```

### Action Result

```ts
type ActionResult = {
  actionId: string;
  status: 'preview' | 'applied' | 'rejected' | 'failed';
  message: string;
  affectedMeshIds: string[];
  requiresConfirmation: boolean;
  warnings: string[];
  beforeStateId?: string;
  afterStateId?: string;
};
```

## VTK Rendering Design

### Rendering Pipeline

```text
File / URL / Sample Asset
  -> vtkSTLReader / vtkOBJReader / vtkPLYReader / vtkXMLPolyDataReader
  -> vtkPolyData or vtkDataSet
  -> vtkMapper.setInputData(data)
  -> vtkActor.setMapper(mapper)
  -> renderer.addActor(actor)
  -> renderer.resetCamera()
  -> renderWindow.render()
```

### Runtime Objects

- `GenericRenderWindow`：MVP 推荐使用，减少手动绑定 canvas、renderer、renderWindow 的样板代码。
- `Renderer`：管理 actor、背景、camera、灯光和可见对象。
- `RenderWindow`：管理底层 WebGL render view。
- `Interactor`：处理鼠标、触控、键盘交互，默认使用 trackball camera。
- `Camera`：提供正视图、俯视图、侧视图、等轴视图、fit selection 等能力。
- `Actor`：承载 transform、材质、透明度、可见性。旋转、平移、复制优先作用于 actor。
- `Mapper`：把 dataset 映射为 GPU 可绘制几何。视觉裁剪通过 mapper clipping plane 完成。
- `Widget / Plane`：切割平面、坐标轴、方向立方体、变换 gizmo 和测量辅助。

### Supported Formats

MVP 支持优先级：

1. `STL`：工业几何外形最常见，适合演示。
2. `OBJ`：通用几何格式，便于找示例模型。
3. `PLY`：适合扫描网格和点云颜色属性。
4. `VTP`：VTK XML PolyData，和 vtk.js 管线贴合。

增强版支持：

- `VTU`：非结构网格，贴近真实仿真数据。
- legacy `VTK`：科研/工业遗留格式，可通过后端转换提高稳定性。

### Geometry Operations

#### Rotate

MVP 使用 actor transform，不修改底层 mesh 数据。优点是快、无损、适合撤销和实时预览。增强版可增加“应用变换到网格数据”选项，用 filter 生成新的 polydata。

#### Clip / Cut

MVP 把切割实现为非破坏性视觉裁剪：

- UI 或 AI 生成 `clipMesh` action。
- `OperationExecutor` 解析目标 mesh 和 plane。
- VTK runtime 创建 `vtkPlane`。
- mapper 设置 clipping plane。
- viewport 显示半透明预览和切割平面 widget。
- 用户确认后保留裁剪状态；撤销时移除 clipping plane。

增强版再实现真实几何切割：

- 使用 polydata clip/filter 生成新 dataset。
- 可选择是否 cap 截面。
- 对复杂非流形网格、大模型或布尔切割转后端 VTK 服务处理。

#### Clone

MVP 复制 actor 和 mapper 引用，共享底层 dataset，并给 clone 设置 offset、名称、颜色或透明度差异。这样速度快，内存占用低。增强版支持深拷贝 dataset，让 clone 能独立切割和导出。

#### Selection

MVP 做 actor 级选择。对象树选择和 viewport picking 共享 `SelectionService`。增强版支持 cell/face/point 选择，用于更精细的局部编辑。

## AI Agent Design

### Agent Pipeline

```text
Natural Language Input
  -> AgentAdapter.parse(text, sceneState)
  -> ParsedAction + Confidence
  -> ActionSchemaValidator
  -> ConfirmationManager
  -> OperationExecutor.preview or execute
  -> ActionResult
  -> HistoryStore + UI Feedback
```

### MVP Rule Parser Examples

支持固定句式和轻量模糊匹配：

- “选择泵壳” -> `selectMesh`
- “把当前对象绕 Z 轴旋转 30 度” -> `rotateMesh`
- “复制选中对象 3 个，沿 X 方向间隔 20mm” -> `cloneMesh`
- “沿 X=0 平面裁剪泵壳” -> `clipMesh`
- “切到俯视图” -> `setCamera`
- “重置视角” -> `resetView`

### LLM Adapter Contract

后续接入真实 LLM 时，模型只输出 JSON，不直接运行代码。示例：

```json
{
  "id": "act_001",
  "type": "rotateMesh",
  "target": { "source": "selection" },
  "params": {
    "axis": "z",
    "angleDeg": 30,
    "pivot": "boundsCenter",
    "space": "world"
  },
  "source": "agent",
  "rawText": "把当前对象绕 Z 轴旋转 30 度"
}
```

### Ambiguity Handling

- 目标不明确：如果已有选中对象，默认使用选中对象并提示；没有选中对象时给出候选列表。
- 单位不明确：默认使用场景单位，并在解析结果里显示；场景单位未知时追问。
- 切割平面不完整：进入澄清状态，询问 X/Y/Z 平面、当前视角平面或三点定义。
- 危险操作：切割、删除、批量复制、真实几何修改必须先 preview，再 confirm。
- 低置信度：不执行，只展示“我理解为...”并要求确认。

### Security And Audit

- 只允许白名单 action type。
- 所有 action 使用 schema validation。
- 禁止自然语言拼接函数名执行。
- 禁止 agent 输出任意 JavaScript、Python、VTK 脚本并执行。
- 每次 action 都记录 raw text、parsed action、执行状态、目标对象、前后状态、错误信息和耗时。
- 操作历史可用于撤销、重做、演示回放和调试。

## UI Design

### Design Principle

产品应像“AI 辅助的轻量工业三维仿真工作台”。界面强调工程工具感：信息密度高、布局稳定、状态明确、控件专业。不要做营销式首页，不使用大面积装饰图、浮夸渐变或卡片堆叠。

### Layout

```text
┌──────────────────────────────────────────────────────────────┐
│ Top Bar: project / import / save / undo / redo / view / status │
├───────────────┬────────────────────────────┬─────────────────┤
│ Object Tree    │ 3D Viewport                │ Inspector Panel │
│ - meshes       │ - vtk.js canvas            │ Tabs:           │
│ - clips        │ - viewport toolbar         │ - Properties    │
│ - clones       │ - direction cube           │ - Operations    │
│ - visibility   │ - transform/cut widgets    │ - AI Agent      │
├───────────────┴────────────────────────────┴─────────────────┤
│ History Timeline: imports / AI commands / actions / errors     │
└──────────────────────────────────────────────────────────────┘
```

### Top Bar

高度约 44 到 52px，承载全局命令：

- 项目名和保存状态。
- 导入、保存、导出。
- 撤销、重做。
- 适配视图、截图。
- 单位选择。
- 当前渲染状态：文件数量、对象数量、FPS、点/面数。

常用命令使用图标按钮并提供 tooltip。导入、保存、导出可以保留图标加短文本，因为它们是高层命令。

### Left Object Tree

宽度 260 到 320px，可折叠。对象树展示：

- 网格对象。
- 复制体。
- 切割平面。
- 辅助标注。
- 可见性、锁定、颜色 swatch、对象类型图标。
- 搜索和按类型过滤。

对象行交互：

- 点击选择并同步 viewport 高亮。
- 眼睛图标切换可见性。
- 锁图标防止误操作。
- context menu 提供重命名、隐藏、复制、删除、聚焦、导出选中对象。

### Center 3D Viewport

视窗是主工作区，占据最大面积。它包含：

- vtk.js canvas。
- 左上角 viewport toolbar：选择、移动/旋转、切割、复制、测量、显示模式。
- 右上角方向立方体。
- 左下角坐标轴。
- 右下角渲染状态小标签。
- 选中对象的高亮轮廓。
- 切割操作中的 plane widget。
- AI 预览时的半透明 ghost 或高亮区域。

显示模式使用 segmented control：`实体`、`线框`、`点云`、`实体+边线`。选择模式使用 segmented control：`对象`、`面`、`边`、`点`。MVP 只启用对象模式，其他模式可以展示为禁用或增强版入口。

### Right Inspector Panel

宽度 340 到 420px，使用 tabs：

#### Properties Tab

显示选中对象信息：

- 名称、格式、可见性、锁定。
- 颜色、透明度、边线显示。
- bounds、点数、面数、三角面数量。
- transform：position、rotation、scale。
- source file 和导入时间。

数值字段需要可编辑、可复制、可重置。旋转角度、透明度可以使用 slider + input；精确工程参数必须保留 input。

#### Operations Tab

提供传统操作控件：

- Rotate：轴、角度、pivot、应用/预览。
- Clone：数量、offset、命名规则、共享几何或独立几何。
- Clip：平面方向、origin、normal、保留方向、preview、confirm。
- Camera：正视图、侧视图、俯视图、等轴视图、fit selected。

这些控件和 AI action 使用同一套 `OperationExecutor`，保证行为一致。

#### AI Agent Tab

结构：

- 自然语言输入框。
- 示例命令快捷 chips：旋转当前对象、复制选中对象、沿 X 平面裁剪、重置视图。
- 解析结果卡片：目标对象、操作序列、参数、置信度、风险。
- 按钮：预览、确认执行、取消、编辑参数。
- 澄清问题区：当目标或单位不明确时显示候选项。

AI 面板必须强调可解释性，不静默执行危险操作。用户可以看到“AI 理解了什么”，再决定是否执行。

### Bottom History Timeline

高度 180 到 240px，可折叠。记录：

- 文件导入。
- 手动操作。
- AI 命令。
- preview/confirm/apply 状态。
- 错误。
- 导出。
- 撤销/重做。

每条记录展示时间、来源、目标对象、主要参数、状态和耗时。点击可展开 JSON action、错误详情或回滚选项。

### Empty, Loading, And Error States

#### Empty State

中间视窗显示短行动入口：

- 拖入 STL/OBJ/PLY/VTP 文件。
- 点击导入。
- 加载示例模型。

左侧对象树显示“当前场景为空”。右侧 AI 面板可以输入命令，但执行按钮在没有目标对象时禁用，并提示先导入或选择对象。

#### Loading State

大文件导入时显示：

- 文件名、大小、格式。
- 解析进度。
- 当前阶段：读取、解析、构建 mapper、渲染。
- 大文件性能提示。

#### Error State

错误需要可恢复：

- 文件格式不支持：提示支持格式。
- 解析失败：提示具体 reader 或文件问题。
- WebGL 不可用：提示浏览器/GPU 限制。
- AI 命令失败：区分无法理解、目标缺失、参数越界、执行失败。

## Key User Flows

### Flow 1: Import And Inspect

1. 用户拖入 STL 文件。
2. `MeshLoader` 解析文件。
3. `SceneManager` 创建 mesh entity。
4. VTK runtime 创建 mapper 和 actor。
5. viewport fit to view。
6. 左侧对象树出现对象。
7. 右侧属性面板展示 bounds、点数、面数。

### Flow 2: Manual Rotate

1. 用户选择对象。
2. 打开 Operations tab。
3. 输入轴和角度。
4. 点击预览。
5. `OperationExecutor` 执行 transform preview。
6. 用户确认。
7. 系统写入 history，支持撤销。

### Flow 3: Agent Rotate

1. 用户在 AI tab 输入“把当前对象绕 Z 轴旋转 30 度”。
2. `AgentAdapter` 读取 scene state。
3. 规则 parser 或 LLM adapter 生成 `rotateMesh` action。
4. validator 校验 action。
5. UI 展示解析结果。
6. 用户点击执行。
7. `OperationExecutor` 应用 actor transform。
8. history 记录 raw text 和 parsed action。

### Flow 4: Agent Clip With Confirmation

1. 用户输入“沿中心切开泵壳，只保留右半边”。
2. Agent 解析目标为泵壳，origin 为 bounds center，但 normal 可能需要确认。
3. UI 提示用户选择 X/Y/Z 或当前视角平面。
4. 用户选择 X 平面。
5. 系统进入 clip preview，显示 plane widget。
6. 用户确认。
7. `OperationExecutor` 应用视觉裁剪并写入 history。

### Flow 5: Clone And Export

1. 用户选择对象。
2. 输入“复制 3 个，沿 X 方向每个间隔 20mm”。
3. Agent 生成 `cloneMesh` action。
4. UI 展示 count、offset、unit 和 name pattern。
5. 用户确认。
6. 系统创建 clone actors。
7. 用户导出项目状态或选中对象。

## Browser And Deployment Design

MVP 以静态前端应用方式部署即可：

- 本地开发：Vite dev server。
- 演示部署：静态站点或任意能托管 SPA 的服务。
- 文件读取：浏览器 File API。
- 示例数据：放在 public assets 中。
- 项目保存：导出 JSON 或浏览器本地存储。

增强版可增加后端：

- 上传和管理大文件。
- 格式转换，比如 legacy VTK 转 VTP/VTU。
- 复杂几何操作。
- LLM agent 编排。
- 项目持久化和分享链接。

## Testing And Verification Strategy

### Unit Tests

- `OperationExecutor`：命令校验、目标解析、执行结果、错误分支。
- `AgentAdapter`：自然语言样例解析为 action JSON。
- `HistoryStore`：撤销、重做、状态快照。
- `MeshLoader`：扩展名识别、reader 分发、错误处理。

### Integration Tests

- 导入示例 STL 后，scene 中出现一个 mesh entity。
- 选择对象后，属性面板同步更新。
- 执行 rotate action 后，actor transform 改变。
- 执行 clone action 后，scene 对象数量增加。
- 执行 clip preview 后，目标 mapper 出现 clipping plane。

### Browser Smoke Tests

- 页面能打开。
- vtk.js canvas 非空。
- 加载示例模型后截图不是空白。
- AI 示例命令能生成解析结果并执行。
- 撤销/重做按钮状态正确。

## Implementation Roadmap

### Phase 1: Project Foundation

- 初始化 React + Vite + TypeScript。
- 配置 vtk.js、测试框架、lint、基础布局。
- 加入示例模型和静态资源目录。

### Phase 2: VTK Viewer MVP

- 实现 `ViewerCanvas` 和 VTK runtime。
- 支持 STL/OBJ/PLY/VTP 导入。
- 实现场景对象树、属性面板、基础相机控制。

### Phase 3: Operation Layer

- 定义 `OperationCommand` schema。
- 实现 `OperationExecutor`。
- 支持选择、旋转、复制、视觉裁剪、重置视图。
- 实现 history、undo、redo。

### Phase 4: AI Agent MVP

- 实现 `AgentAdapter` 和 `RuleParser`。
- 支持固定自然语言命令。
- 展示解析结果、置信度、确认流程。
- 将 AI action 接入 `OperationExecutor`。

### Phase 5: UI Polish And Demo Readiness

- 完成工作台视觉细节。
- 加入示例模型和示例命令。
- 补齐 loading、empty、error 状态。
- 做浏览器 smoke test 和演示脚本。

### Phase 6: Advanced Simulation Features

- 支持 VTU 和标量场着色。
- 支持 scalar bar、color map、截面和数据探针。
- 在现有本地 LLM baseline 上扩展更深的 tool/function calling 编排。
- 引入后端处理复杂切割和大文件。

## Acceptance Criteria

MVP 完成后应满足：

- 浏览器打开后直接进入三维工作台。
- 用户可以导入至少一种本地三维网格文件，推荐 STL 起步。
- VTK viewer 能稳定显示模型，并支持相机旋转、缩放、平移和 fit view。
- 对象树能列出 mesh，对象可选择、隐藏、改色或查看属性。
- 用户可以通过 UI 执行旋转、复制、视觉裁剪。
- 用户可以输入至少 5 类自然语言命令并生成结构化 action。
- AI 面板能展示解析结果，并对切割等高风险操作要求确认。
- 操作历史能记录手动和 AI 操作，并支持撤销/重做基础操作。
- 页面在桌面浏览器中展示稳定，canvas 不为空，关键 UI 不重叠。

## Risks And Open Questions

### Requirement Risks

- 第二点仍模糊：需要确认 AI agent 是必须接真实大模型，还是规则解析演示也可以作为第一阶段。
- “切割”需要确认语义：是视觉剖切、真实几何裁剪、布尔切割，还是生成截面曲线。
- “工业仿真”需要确认是否必须支持 VTU、标量场、时间步、边界条件等真实仿真数据。

### Technical Risks

- 大 STL/OBJ 文件可能造成浏览器解析卡顿和内存压力。
- vtk.js 支持的 filter 能力和桌面 VTK 不完全一致，复杂几何处理可能需要后端或 WASM。
- WebGL 在不同浏览器和 GPU 上表现不同，需要做能力检测和降级提示。
- AI 解析若直接接 LLM，输出稳定性需要 schema validation、重试和澄清机制保障。

### Product Questions To Confirm

- 是否需要真实云端 LLM，或 MVP 使用规则 parser 即可。
- 示例模型用什么工业对象最合适：泵、阀体、叶轮、支架、管路或装配体。
- 是否需要支持保存项目文件，还是只需要浏览器演示。
- 是否需要移动端适配，还是桌面浏览器优先。
- 是否要求导出处理后的 mesh，还是只导出操作历史和截图。

## Subagent Work Breakdown Used For This Design

本设计按三个独立方向拆分调研：

- VTK 渲染架构：确认 vtk.js、渲染管线、格式支持、几何操作边界。
- AI Agent 操作设计：确认自然语言到 action schema 的安全执行链路。
- 工业仿真 UI 设计：确认工作台信息架构、关键流程、控件和视觉风格。

后续进入实现阶段时，可以继续按模块分派 subagent：

- Viewer subagent：实现 vtk.js runtime、mesh loader、示例模型加载。
- Operation subagent：实现 operation schema、executor、history、undo/redo。
- Agent subagent：实现 rule parser、解析预览、确认流程。
- UI subagent：实现工作台布局、对象树、属性面板、AI 面板和历史 timeline。
- QA subagent：补测试、浏览器 smoke test、演示脚本。
