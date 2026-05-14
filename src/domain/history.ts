import type { ActionResult, OperationCommand } from './actions';
import { cloneScene, type SceneState } from './scene';

export type HistoryEntry = {
  id: string;
  command: OperationCommand;
  before: SceneState;
  after: SceneState;
  timestamp: string;
};

export type HistoryStore = {
  current: () => SceneState;
  entries: () => HistoryEntry[];
  record: (command: OperationCommand, nextScene: SceneState) => void;
  undo: () => ActionResult;
  redo: () => ActionResult;
  canUndo: () => boolean;
  canRedo: () => boolean;
};

export function createHistoryStore(initialScene: SceneState): HistoryStore {
  let currentScene = cloneScene(initialScene);
  let entries: HistoryEntry[] = [];
  let cursor = -1;

  return {
    current: () => cloneScene(currentScene),
    entries: () => entries.slice(0, cursor + 1).map((entry) => ({ ...entry })),
    record: (command, nextScene) => {
      entries = entries.slice(0, cursor + 1);
      entries.push({
        id: command.id,
        command,
        before: cloneScene(currentScene),
        after: cloneScene(nextScene),
        timestamp: new Date().toISOString(),
      });
      cursor = entries.length - 1;
      currentScene = cloneScene(nextScene);
    },
    undo: () => {
      if (cursor < 0) {
        return emptyResult('undo', '没有可撤销的操作');
      }
      const entry = entries[cursor];
      currentScene = cloneScene(entry.before);
      cursor -= 1;
      return {
        actionId: entry.id,
        status: 'applied',
        message: `已撤销 ${entry.command.type}`,
        affectedMeshIds: currentScene.selection,
        requiresConfirmation: false,
        warnings: [],
      };
    },
    redo: () => {
      if (cursor >= entries.length - 1) {
        return emptyResult('redo', '没有可重做的操作');
      }
      const entry = entries[cursor + 1];
      currentScene = cloneScene(entry.after);
      cursor += 1;
      return {
        actionId: entry.id,
        status: 'applied',
        message: `已重做 ${entry.command.type}`,
        affectedMeshIds: currentScene.selection,
        requiresConfirmation: false,
        warnings: [],
      };
    },
    canUndo: () => cursor >= 0,
    canRedo: () => cursor < entries.length - 1,
  };
}

function emptyResult(actionId: string, message: string): ActionResult {
  return {
    actionId,
    status: 'rejected',
    message,
    affectedMeshIds: [],
    requiresConfirmation: false,
    warnings: [],
  };
}