import { type MouseEvent, useMemo, useState } from 'react';
import { Box, Eye, EyeOff, Lock, LockOpen, PanelLeftClose, Search } from 'lucide-react';
import type { MeshEntity } from '../domain/actions';

type SelectionMode = 'replace' | 'add' | 'remove';

type ObjectTreeProps = {
  meshes: MeshEntity[];
  selection: string[];
  onSelect: (meshIds: string[], mode?: SelectionMode) => void;
  onToggleVisibility?: (meshId: string, visible: boolean) => void;
  onToggleLock?: (meshId: string, locked: boolean) => void;
  onHidePanel?: () => void;
};

export function ObjectTree({ meshes, selection, onSelect, onToggleVisibility, onToggleLock, onHidePanel }: ObjectTreeProps) {
  const [query, setQuery] = useState('');
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredMeshes = useMemo(() => {
    if (!normalizedQuery) return meshes;
    return meshes.filter((mesh) => buildMeshSearchText(mesh).includes(normalizedQuery));
  }, [meshes, normalizedQuery]);

  const hasMeshes = meshes.length > 0;
  const hasMatches = filteredMeshes.length > 0;
  const countLabel = normalizedQuery ? `${filteredMeshes.length}/${meshes.length} mesh` : `${meshes.length} mesh`;

  const handleSelect = (mesh: MeshEntity, event: MouseEvent<HTMLButtonElement>) => {
    if (event.shiftKey && lastSelectedId) {
      const rangeIds = idsBetween(filteredMeshes, lastSelectedId, mesh.id);
      if (rangeIds.length > 0) {
        onSelect(rangeIds, event.metaKey || event.ctrlKey ? 'add' : 'replace');
        setLastSelectedId(mesh.id);
        return;
      }
    }

    if (event.metaKey || event.ctrlKey) {
      onSelect([mesh.id], selection.includes(mesh.id) ? 'remove' : 'add');
    } else {
      onSelect([mesh.id], 'replace');
    }
    setLastSelectedId(mesh.id);
  };

  return (
    <aside className="left-panel panel-shell">
      <div className="panel-header">
        <div>
          <strong>对象树</strong>
          <span>{countLabel}</span>
        </div>
        {onHidePanel ? (
          <button type="button" className="icon-button panel-icon-button" onClick={onHidePanel} title="隐藏对象树" aria-label="隐藏对象树">
            <PanelLeftClose size={15} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <div className="search-row">
        <Search size={14} aria-hidden="true" />
        <input
          aria-label="搜索对象树"
          placeholder="搜索对象"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="sr-only" aria-live="polite">
        {hasMeshes ? `对象树显示 ${filteredMeshes.length} 个对象，共 ${meshes.length} 个。` : '对象树为空。'}
      </div>
      <div className="object-list" role="listbox" aria-label="对象列表" aria-multiselectable="true">
        {!hasMeshes ? (
          <div className="empty-panel">拖入网格文件，或加载示例涡扇模型。</div>
        ) : !hasMatches ? (
          <div className="empty-panel">没有匹配的对象。</div>
        ) : (
          filteredMeshes.map((mesh) => (
            <div
              key={mesh.id}
              className={`object-row ${selection.includes(mesh.id) ? 'selected' : ''} ${mesh.visible ? '' : 'hidden'} ${
                mesh.locked ? 'locked' : ''
              }`}
              role="option"
              aria-selected={selection.includes(mesh.id)}
            >
              <button type="button" className="object-select-button" onClick={(event) => handleSelect(mesh, event)} aria-label={getSelectLabel(mesh)}>
                <Box size={16} aria-hidden="true" />
                <span className="swatch" style={{ background: mesh.color }} aria-hidden="true" />
                <span className="object-name">{mesh.name}</span>
                <span className="object-meta">{formatMeshStats(mesh)}</span>
              </button>
              <button
                type="button"
                className={`object-control ${mesh.visible ? 'active' : ''}`}
                disabled={!onToggleVisibility}
                aria-label={mesh.visible ? `隐藏 ${mesh.name}` : `显示 ${mesh.name}`}
                aria-pressed={mesh.visible}
                title={onToggleVisibility ? (mesh.visible ? '隐藏对象' : '显示对象') : '显示状态需要接入场景回调'}
                onClick={() => onToggleVisibility?.(mesh.id, !mesh.visible)}
              >
                {mesh.visible ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}
              </button>
              <button
                type="button"
                className={`object-control lock-control ${mesh.locked ? 'active' : ''}`}
                disabled={!onToggleLock}
                aria-label={mesh.locked ? `解锁 ${mesh.name}` : `锁定 ${mesh.name}`}
                aria-pressed={mesh.locked}
                title={onToggleLock ? (mesh.locked ? '解锁对象' : '锁定对象') : '锁定状态需要接入场景回调'}
                onClick={() => onToggleLock?.(mesh.id, !mesh.locked)}
              >
                {mesh.locked ? <Lock size={14} aria-hidden="true" /> : <LockOpen size={14} aria-hidden="true" />}
              </button>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

function idsBetween(meshes: MeshEntity[], fromId: string, toId: string): string[] {
  const fromIndex = meshes.findIndex((mesh) => mesh.id === fromId);
  const toIndex = meshes.findIndex((mesh) => mesh.id === toId);
  if (fromIndex === -1 || toIndex === -1) return [];
  const start = Math.min(fromIndex, toIndex);
  const end = Math.max(fromIndex, toIndex);
  return meshes.slice(start, end + 1).map((mesh) => mesh.id);
}

function buildMeshSearchText(mesh: MeshEntity): string {
  return [
    mesh.name,
    mesh.id,
    mesh.sourceFormat,
    String(mesh.stats.triangles ?? mesh.stats.cells),
    mesh.visible ? 'visible shown 可见 显示' : 'hidden invisible 隐藏',
    mesh.locked ? 'locked 锁定' : 'unlocked 解锁',
  ]
    .join(' ')
    .toLocaleLowerCase();
}

function formatMeshStats(mesh: MeshEntity): string {
  if (mesh.stats.triangles !== undefined) return `${mesh.stats.triangles.toLocaleString()} tris`;
  return `${mesh.stats.cells.toLocaleString()} cells`;
}

function getSelectLabel(mesh: MeshEntity): string {
  const state = [mesh.visible ? '可见' : '隐藏', mesh.locked ? '锁定' : '未锁定'].join('，');
  return `选择 ${mesh.name}，${formatMeshStats(mesh)}，${state}`;
}
