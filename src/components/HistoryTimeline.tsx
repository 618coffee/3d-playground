import { Clock, PanelBottomClose, RotateCcw } from 'lucide-react';
import type { HistoryEntry } from '../domain/history';

type HistoryTimelineProps = {
  entries: HistoryEntry[];
  lastMessage?: string;
  onHidePanel?: () => void;
};

export function HistoryTimeline({ entries, lastMessage, onHidePanel }: HistoryTimelineProps) {
  return (
    <footer className="history-panel">
      <div className="history-header">
        <strong>操作时间线</strong>
        <div className="history-header-actions">
          <span>{lastMessage ?? '等待操作'}</span>
          {onHidePanel ? (
            <button type="button" className="icon-button panel-icon-button" onClick={onHidePanel} title="隐藏时间线" aria-label="隐藏时间线">
              <PanelBottomClose size={15} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>
      <div className="history-list">
        {entries.length === 0 ? (
          <div className="history-empty"><Clock size={15} /> 导入模型、执行 AI 命令或手动操作后会记录在这里。</div>
        ) : (
          entries.slice().reverse().map((entry) => (
            <div className="history-row" key={`${entry.id}-${entry.timestamp}`}>
              <RotateCcw size={14} />
              <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
              <strong>{entry.command.type}</strong>
              <em>{entry.command.rawText ?? entry.command.source}</em>
            </div>
          ))
        )}
      </div>
    </footer>
  );
}
