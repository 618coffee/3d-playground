import { Clock, RotateCcw } from 'lucide-react';
import type { HistoryEntry } from '../domain/history';

type HistoryTimelineProps = {
  entries: HistoryEntry[];
  lastMessage?: string;
};

export function HistoryTimeline({ entries, lastMessage }: HistoryTimelineProps) {
  return (
    <footer className="history-panel">
      <div className="history-header">
        <strong>操作时间线</strong>
        <span>{lastMessage ?? '等待操作'}</span>
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