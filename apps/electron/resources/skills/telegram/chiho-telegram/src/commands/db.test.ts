import { describe, expect, it, vi } from 'vitest';
import { runDb } from './db.js';
import { MIGRATIONS } from '../db/schema.js';
import type { AppContext } from '../app/context.js';

function createMigratedPool() {
  const client = {
    query: vi.fn(async (sql: string) => {
      if (sql === 'SELECT id FROM schema_migrations') {
        return { rows: MIGRATIONS.map((migration) => ({ id: migration.id })) };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return {
    client,
    connect: vi.fn(async () => client),
  };
}

describe('runDb', () => {
  it('prints JSON for migrate in JSON mode', async () => {
    const pool = createMigratedPool();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await runDb(
      {
        config: { jsonOutput: true },
        db: pool,
      } as unknown as AppContext,
      ['migrate'],
    );

    expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toEqual({
      ok: true,
      action: 'migrate',
    });
    expect(pool.connect).toHaveBeenCalledOnce();
    expect(pool.client.query).toHaveBeenCalled();
    expect(pool.client.release).toHaveBeenCalledOnce();

    log.mockRestore();
  });
});
