import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InspectorPanel, PropertiesPanel } from './InspectorPanel';
import type { ActionResult, MeshEntity, OperationCommand } from '../domain/actions';
import { createInitialScene } from '../domain/scene';

const mesh: MeshEntity = {
  id: 'fan-1',
  name: 'turbofan fan',
  sourceFormat: 'procedural',
  visible: true,
  locked: false,
  selected: true,
  color: '#4fb3ff',
  opacity: 1,
  bounds: [-10, 10, -10, 10, -10, 10],
  stats: { points: 100, cells: 60, triangles: 60 },
  transform: { position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
};

const clipCommand: OperationCommand = {
  id: 'clip-1',
  type: 'clipMesh',
  target: { source: 'allVisible' },
  params: {
    plane: { origin: [0, 0, 0], normal: [0, 1, 0] },
    keepSide: 'positive',
    mode: 'applyVisualClip',
    cap: true,
  },
  source: 'agent',
};

const cloneCommand: OperationCommand = {
  id: 'clone-1',
  type: 'cloneMesh',
  target: { source: 'selection' },
  params: { count: 3, offset: [20, 0, 0], unit: 'mm', shareGeometry: true, namePattern: '{name}-copy-{n}' },
  source: 'agent',
};

const uiClipCommand: OperationCommand = {
  ...clipCommand,
  id: 'clip-ui-1',
  source: 'ui',
};

describe('InspectorPanel', () => {
  it('labels the right panel as an operation workspace with manual and AI assistant tabs', () => {
    render(
      <InspectorPanel
        scene={createInitialScene()}
        selectedMeshes={[]}
        historyEntries={[]}
        pendingCommand={null}
        onConfirmPending={vi.fn()}
        onCancelPending={vi.fn()}
        onExecute={vi.fn()}
        onHidePanel={vi.fn()}
      />,
    );

    expect(screen.getByText('操作台')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '隐藏操作台' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /手动/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /AI 助手/ })).toBeInTheDocument();
  });

  it('keeps the AI chat composer visible when no object is selected', () => {
    render(
      <InspectorPanel
        scene={createInitialScene()}
        selectedMeshes={[]}
        historyEntries={[]}
        pendingCommand={null}
        onConfirmPending={vi.fn()}
        onCancelPending={vi.fn()}
        onExecute={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('AI 指令输入')).toBeInTheDocument();
    expect(screen.getByText('未选择对象')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /属性/ })).not.toBeInTheDocument();
  });

  it('renders manual controls with per-axis rotation, segmented clone and clip controls, steppers, and right aligned actions', () => {
    const scene = createInitialScene([mesh]);
    const execute = vi.fn();
    render(
      <InspectorPanel
        scene={scene}
        selectedMesh={mesh}
        selectedMeshes={[mesh]}
        historyEntries={[]}
        pendingCommand={null}
        onConfirmPending={vi.fn()}
        onCancelPending={vi.fn()}
        onExecute={execute}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /手动/ }));

    const moveSection = screen.getByRole('region', { name: '移动' });
    expect(screen.getByRole('button', { name: '折叠移动' })).not.toHaveTextContent('mm');
    expect(moveSection.querySelectorAll('.number-field-suffix')).toHaveLength(3);
    expect(within(moveSection).getAllByText('mm')).toHaveLength(3);

    const rotateSection = screen.getByRole('region', { name: '旋转' });
    expect(within(rotateSection).getByRole('spinbutton', { name: 'X 轴' })).toBeInTheDocument();
    expect(within(rotateSection).getByRole('spinbutton', { name: 'Y 轴' })).toBeInTheDocument();
    expect(within(rotateSection).getByRole('spinbutton', { name: 'Z 轴' })).toHaveValue(0);
    expect(within(rotateSection).getByRole('button', { name: '增加 X 轴角度' })).toBeInTheDocument();
    expect(within(rotateSection).getByRole('button', { name: '减少 Z 轴角度' })).toBeInTheDocument();
    expect(within(rotateSection).getByRole('group', { name: '旋转操作' })).toContainElement(within(rotateSection).getByRole('button', { name: '应用旋转' }));

    fireEvent.change(within(rotateSection).getByRole('spinbutton', { name: 'X 轴' }), { target: { value: '10' } });
    fireEvent.change(within(rotateSection).getByRole('spinbutton', { name: 'Y 轴' }), { target: { value: '20' } });
    fireEvent.change(within(rotateSection).getByRole('spinbutton', { name: 'Z 轴' }), { target: { value: '30' } });
    fireEvent.click(within(rotateSection).getByRole('button', { name: '应用旋转' }));

    expect(execute).toHaveBeenNthCalledWith(1, expect.objectContaining({ type: 'rotateMesh', params: expect.objectContaining({ axis: 'x', angleDeg: 10 }) }));
    expect(execute).toHaveBeenNthCalledWith(2, expect.objectContaining({ type: 'rotateMesh', params: expect.objectContaining({ axis: 'y', angleDeg: 20 }) }));
    expect(execute).toHaveBeenNthCalledWith(3, expect.objectContaining({ type: 'rotateMesh', params: expect.objectContaining({ axis: 'z', angleDeg: 30 }) }));

    const cloneSection = screen.getByRole('region', { name: '复制' });
    expect(within(cloneSection).getByRole('spinbutton', { name: '数量' })).toHaveValue(0);
    expect(within(cloneSection).getByRole('spinbutton', { name: '间隔' })).toHaveValue(0);
    expect(within(cloneSection).queryByRole('combobox', { name: '方向' })).not.toBeInTheDocument();
    expect(within(cloneSection).getByRole('button', { name: 'X' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(cloneSection).getByRole('button', { name: 'Y' })).toBeInTheDocument();
    expect(within(cloneSection).getByRole('button', { name: 'Z' })).toBeInTheDocument();
    expect(within(cloneSection).getByRole('button', { name: '增加数量' })).toBeInTheDocument();
    expect(within(cloneSection).getByRole('button', { name: '减少间隔' })).toBeInTheDocument();
    const cloneButton = within(cloneSection).getByRole('button', { name: '复制对象' });
    expect(within(cloneSection).getByRole('group', { name: '复制操作' })).toContainElement(cloneButton);

    const clipSection = screen.getByRole('region', { name: '切割' });
    expect(within(clipSection).queryByRole('combobox', { name: '平面' })).not.toBeInTheDocument();
    expect(within(clipSection).queryByRole('combobox', { name: '保留' })).not.toBeInTheDocument();
    expect(within(clipSection).getByRole('group', { name: '平面' })).toContainElement(within(clipSection).getByRole('button', { name: 'X' }));
    expect(within(clipSection).getByRole('button', { name: '正侧' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(clipSection).getByRole('button', { name: '负侧' })).toBeInTheDocument();
    const clipActions = within(clipSection).getByRole('group', { name: '切割操作' });
    expect(clipActions).toContainElement(within(clipSection).getByRole('button', { name: '预览切割' }));
    expect(within(clipSection).queryByRole('button', { name: '应用切割' })).not.toBeInTheDocument();
    expect(within(clipSection).queryByRole('button', { name: '清除切割' })).not.toBeInTheDocument();
    expect(within(clipSection).getByRole('button', { name: '增加坐标' })).toBeInTheDocument();
  });

  it('allows clearing numeric defaults before typing a new value', () => {
    const scene = createInitialScene([mesh]);
    render(
      <InspectorPanel
        scene={scene}
        selectedMesh={mesh}
        selectedMeshes={[mesh]}
        historyEntries={[]}
        pendingCommand={null}
        onConfirmPending={vi.fn()}
        onCancelPending={vi.fn()}
        onExecute={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /手动/ }));

    const cloneSection = screen.getByRole('region', { name: '复制' });
    const countInput = within(cloneSection).getByRole('spinbutton', { name: '数量' });
    fireEvent.change(countInput, { target: { value: '' } });

    expect(countInput).toHaveValue(null);

    fireEvent.change(countInput, { target: { value: '1' } });

    expect(countInput).toHaveValue(1);
  });

  it('emits a move command with x, y, and z offsets from the manual tab', () => {
    const scene = createInitialScene([mesh]);
    const execute = vi.fn();
    render(
      <InspectorPanel
        scene={scene}
        selectedMesh={mesh}
        selectedMeshes={[mesh]}
        historyEntries={[]}
        pendingCommand={null}
        onConfirmPending={vi.fn()}
        onCancelPending={vi.fn()}
        onExecute={execute}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /手动/ }));

    const moveSection = screen.getByRole('region', { name: '移动' });
    fireEvent.change(within(moveSection).getByRole('spinbutton', { name: 'X 轴' }), { target: { value: '10' } });
    fireEvent.change(within(moveSection).getByRole('spinbutton', { name: 'Y 轴' }), { target: { value: '-5' } });
    fireEvent.change(within(moveSection).getByRole('spinbutton', { name: 'Z 轴' }), { target: { value: '2' } });
    fireEvent.click(within(moveSection).getByRole('button', { name: '应用移动' }));

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      type: 'moveMesh',
      target: { source: 'selection' },
      params: { offset: [10, -5, 2], unit: 'mm' },
      source: 'ui',
    }));
  });

  it('collapses and expands manual operation sections independently', () => {
    const scene = createInitialScene([mesh]);
    render(
      <InspectorPanel
        scene={scene}
        selectedMesh={mesh}
        selectedMeshes={[mesh]}
        historyEntries={[]}
        pendingCommand={null}
        onConfirmPending={vi.fn()}
        onCancelPending={vi.fn()}
        onExecute={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /手动/ }));

    const moveSection = screen.getByRole('region', { name: '移动' });
    const rotateSection = screen.getByRole('region', { name: '旋转' });
    const cloneSection = screen.getByRole('region', { name: '复制' });
    const clipSection = screen.getByRole('region', { name: '切割' });

    expect(screen.getByRole('button', { name: '折叠移动' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: '折叠旋转' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: '折叠复制' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: '折叠旋转' })).not.toHaveTextContent('selected');
    expect(screen.getByRole('button', { name: '折叠切割' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(moveSection).getByRole('spinbutton', { name: 'X 轴' })).toBeInTheDocument();
    expect(moveSection.querySelector('.tool-section-body-frame')).toHaveAttribute('aria-hidden', 'false');

    fireEvent.click(screen.getByRole('button', { name: '折叠移动' }));

    expect(screen.getByRole('button', { name: '展开移动' })).toHaveAttribute('aria-expanded', 'false');
    expect(moveSection).toHaveClass('is-collapsed');
    expect(moveSection.querySelector('.tool-section-body-frame')).toHaveAttribute('aria-hidden', 'true');
    expect(within(moveSection).queryByRole('spinbutton', { name: 'X 轴' })).not.toBeInTheDocument();
    expect(within(rotateSection).getByRole('spinbutton', { name: 'X 轴' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '展开移动' }));

    expect(screen.getByRole('button', { name: '折叠移动' })).toHaveAttribute('aria-expanded', 'true');
    expect(moveSection.querySelector('.tool-section-body-frame')).toHaveAttribute('aria-hidden', 'false');
    expect(within(moveSection).getByRole('spinbutton', { name: 'X 轴' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '折叠复制' }));
    fireEvent.click(screen.getByRole('button', { name: '折叠切割' }));

    expect(within(cloneSection).queryByRole('spinbutton', { name: '数量' })).not.toBeInTheDocument();
    expect(within(clipSection).queryByRole('spinbutton', { name: '坐标' })).not.toBeInTheDocument();
    expect(within(moveSection).getByRole('spinbutton', { name: 'X 轴' })).toBeInTheDocument();
  });

  it('disables clone by default and enables manual clip clearing after preview', () => {
    const scene = createInitialScene([mesh]);
    const execute = vi.fn((command: OperationCommand): ActionResult => ({
      actionId: command.id,
      status: command.type === 'clipMesh' && command.params.mode === 'preview' ? 'preview' : 'applied',
      message: 'ok',
      affectedMeshIds: ['fan-1'],
      requiresConfirmation: false,
      warnings: [],
    }));
    render(
      <InspectorPanel
        scene={scene}
        selectedMesh={mesh}
        selectedMeshes={[mesh]}
        historyEntries={[]}
        pendingCommand={null}
        onConfirmPending={vi.fn()}
        onCancelPending={vi.fn()}
        onExecute={execute}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /手动/ }));

    const cloneSection = screen.getByRole('region', { name: '复制' });
    const cloneButton = within(cloneSection).getByRole('button', { name: '复制对象' });
    expect(within(cloneSection).getByRole('spinbutton', { name: '数量' })).toHaveValue(0);
    expect(within(cloneSection).getByRole('spinbutton', { name: '间隔' })).toHaveValue(0);
    expect(cloneButton).toHaveClass('primary-button');
    expect(cloneButton).toBeDisabled();

    fireEvent.change(within(cloneSection).getByRole('spinbutton', { name: '数量' }), { target: { value: '1' } });
    expect(cloneButton).toBeDisabled();

    fireEvent.change(within(cloneSection).getByRole('spinbutton', { name: '间隔' }), { target: { value: '5' } });
    expect(cloneButton).toBeEnabled();

    const clipSection = screen.getByRole('region', { name: '切割' });
    expect(within(clipSection).getByRole('button', { name: '预览切割' })).toBeInTheDocument();
    expect(within(clipSection).queryByRole('button', { name: '清除切割' })).not.toBeInTheDocument();
    expect(within(clipSection).queryByRole('button', { name: '应用切割' })).not.toBeInTheDocument();

    fireEvent.click(within(clipSection).getByRole('button', { name: '预览切割' }));

    const clearClipButton = within(clipSection).getByRole('button', { name: '清除切割' });
    const applyClipButton = within(clipSection).getByRole('button', { name: '应用切割' });
    expect(clearClipButton).toBeEnabled();
    expect(clearClipButton).toHaveClass('danger-button');
    expect(applyClipButton).toHaveClass('primary-button');
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ type: 'clipMesh', params: expect.objectContaining({ mode: 'preview' }) }));

    fireEvent.click(applyClipButton);

    expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'clipMesh', params: expect.objectContaining({ mode: 'applyVisualClip' }) }));
    expect(within(clipSection).queryByRole('button', { name: '清除切割' })).not.toBeInTheDocument();
    expect(within(clipSection).queryByRole('button', { name: '应用切割' })).not.toBeInTheDocument();

    fireEvent.click(within(clipSection).getByRole('button', { name: '预览切割' }));

    fireEvent.click(within(clipSection).getByRole('button', { name: '清除切割' }));

    expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'clipMesh', params: expect.objectContaining({ mode: 'clearVisualClip' }) }));
  });

  it('does not duplicate agent draft confirmation above the chat', () => {
    const props = {
      scene: createInitialScene(),
      selectedMeshes: [],
      historyEntries: [],
      onConfirmPending: vi.fn(),
      onCancelPending: vi.fn(),
      onExecute: vi.fn(),
    };

    render(<InspectorPanel {...props} pendingCommand={clipCommand} />);

    expect(screen.queryByText('待确认切割')).not.toBeInTheDocument();
    expect(screen.queryByText(/预览已经显示在视窗中/)).not.toBeInTheDocument();
  });

  it('uses contextual confirmation labels for non-agent pending operations', () => {
    const props = {
      scene: createInitialScene(),
      selectedMeshes: [],
      historyEntries: [],
      onConfirmPending: vi.fn(),
      onCancelPending: vi.fn(),
      onExecute: vi.fn(),
    };

    const { rerender } = render(<InspectorPanel {...props} pendingCommand={uiClipCommand} />);

    expect(screen.getByRole('button', { name: /确认应用/ })).toBeInTheDocument();

    rerender(<InspectorPanel {...props} pendingCommand={{ ...cloneCommand, source: 'ui' }} />);

    expect(screen.getByRole('button', { name: /确认复制/ })).toBeInTheDocument();
  });
});

describe('PropertiesPanel', () => {
  it('renames the selected mesh from the title field', () => {
    const rename = vi.fn();
    render(<PropertiesPanel mesh={mesh} selectedMeshes={[mesh]} onRename={rename} />);

    expect(screen.queryByRole('textbox', { name: '对象名称' })).not.toBeInTheDocument();
    fireEvent.doubleClick(screen.getByText('turbofan fan'));

    const input = screen.getByRole('textbox', { name: '对象名称' });
    fireEvent.change(input, { target: { value: 'Renamed fan' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(rename).toHaveBeenCalledWith('fan-1', 'Renamed fan');
  });
});