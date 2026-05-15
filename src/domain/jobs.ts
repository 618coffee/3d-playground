import type { OperationCommand } from './actions';

export type BackendJobKind = 'geometryCut' | 'meshing' | 'solverRun' | 'resultSummary';
export type BackendJobStatus = 'queued' | 'running' | 'failed' | 'completed' | 'cancelled';

export type BackendJobRequest = {
  kind: BackendJobKind;
  sourceCommand?: OperationCommand;
  title: string;
  description: string;
  createdFrom: 'agent' | 'ui';
};

export type BackendJob = BackendJobRequest & {
  id: string;
  status: BackendJobStatus;
  createdAt: string;
  updatedAt: string;
  progress: number;
  message: string;
  outputs: BackendJobOutput[];
};

export type BackendJobOutput =
  | { type: 'mesh'; meshId: string; label: string }
  | { type: 'scalarField'; fieldId: string; label: string; unit?: string }
  | { type: 'image'; url: string; label: string }
  | { type: 'summary'; text: string };

export function createQueuedBackendJob(request: BackendJobRequest, now = new Date()): BackendJob {
  const timestamp = now.toISOString();
  return {
    ...request,
    id: `job-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    status: 'queued',
    createdAt: timestamp,
    updatedAt: timestamp,
    progress: 0,
    message: '等待本地后端执行。',
    outputs: [],
  };
}

export function isBackendOwnedCommand(command: OperationCommand): boolean {
  return command.type === 'clipMesh' && command.params.mode === 'bakeGeometry';
}
