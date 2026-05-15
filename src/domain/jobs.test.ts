import { describe, expect, it } from 'vitest';
import { createQueuedBackendJob, isBackendOwnedCommand } from './jobs';
import type { OperationCommand } from './actions';

describe('backend job protocol', () => {
  it('creates explicit queued jobs for future backend-owned work', () => {
    const job = createQueuedBackendJob({
      kind: 'solverRun',
      title: 'Run baseline CFD solve',
      description: 'Submit a local solver job when job workers are available.',
      createdFrom: 'agent',
    }, new Date('2026-05-14T12:00:00.000Z'));

    expect(job).toMatchObject({
      kind: 'solverRun',
      status: 'queued',
      progress: 0,
      createdAt: '2026-05-14T12:00:00.000Z',
      updatedAt: '2026-05-14T12:00:00.000Z',
      outputs: [],
    });
    expect(job.id).toMatch(/^job-/);
  });

  it('keeps baked geometry commands out of the immediate viewer executor path', () => {
    const command: OperationCommand = {
      id: 'clip-bake-1',
      type: 'clipMesh',
      target: { source: 'selection' },
      params: {
        plane: { origin: [0, 0, 0], normal: [1, 0, 0] },
        keepSide: 'positive',
        mode: 'bakeGeometry',
        cap: true,
      },
      source: 'agent',
    };

    expect(isBackendOwnedCommand(command)).toBe(true);
    expect(isBackendOwnedCommand({ ...command, params: { ...command.params, mode: 'applyVisualClip' } })).toBe(false);
  });
});
