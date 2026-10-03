import { describe, expect, it, vi } from 'vitest';
import { runArchive, runUnarchive } from './archive.js';
import type { AppContext } from '../app/context.js';

function createContext() {
  return {
    config: { jsonOutput: true },
    telegram: {
      start: vi.fn(async () => undefined),
      archiveChats: vi.fn(async () => undefined),
      unarchiveChats: vi.fn(async () => undefined),
    },
  } as unknown as AppContext;
}

describe('archive commands', () => {
  it('normalizes numeric peers and ignores json flag for archive', async () => {
    const ctx = createContext();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await runArchive(ctx, ['444617363', '--json']);

    expect(ctx.telegram.archiveChats).toHaveBeenCalledWith([444617363]);
    expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toEqual({
      ok: true,
      action: 'archive',
      count: 1,
    });

    log.mockRestore();
  });

  it('normalizes numeric peers and ignores json flag for unarchive', async () => {
    const ctx = createContext();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await runUnarchive(ctx, ['444617363', '--json']);

    expect(ctx.telegram.unarchiveChats).toHaveBeenCalledWith([444617363]);
    expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toEqual({
      ok: true,
      action: 'unarchive',
      count: 1,
    });

    log.mockRestore();
  });
});
