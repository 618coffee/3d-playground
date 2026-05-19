import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ObjectTree } from './ObjectTree';
import type { MeshEntity } from '../domain/actions';

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

describe('ObjectTree', () => {
  it('renames a mesh from inline editing', () => {
    const rename = vi.fn();
    render(<ObjectTree meshes={[mesh]} selection={['fan-1']} onSelect={vi.fn()} onRename={rename} />);

    fireEvent.doubleClick(screen.getByText('turbofan fan'));
    const row = screen.getByRole('option', { selected: true });
    expect(row.querySelector('svg')).toBeInTheDocument();
    expect(row.querySelector('.swatch')).toBeInTheDocument();
    expect(within(row).getByText('60 tris')).toBeInTheDocument();

    const input = screen.getByRole('textbox', { name: '重命名 turbofan fan' });
    fireEvent.change(input, { target: { value: 'Primary fan' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(rename).toHaveBeenCalledWith('fan-1', 'Primary fan');
  });

  it('cancels inline rename for whitespace-only input', () => {
    const rename = vi.fn();
    render(<ObjectTree meshes={[mesh]} selection={['fan-1']} onSelect={vi.fn()} onRename={rename} />);

    fireEvent.doubleClick(screen.getByText('turbofan fan'));
    const input = screen.getByRole('textbox', { name: '重命名 turbofan fan' });
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(rename).not.toHaveBeenCalled();
    expect(screen.getByText('turbofan fan')).toBeInTheDocument();
  });
});
