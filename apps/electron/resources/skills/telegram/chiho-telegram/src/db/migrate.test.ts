import { describe, expect, it, vi } from 'vitest';
import type { DbPool } from './pool.js';
import { MIGRATIONS } from './schema.js';
import { migrate } from './migrate.js';

function poolWithClient(query: ReturnType<typeof vi.fn>) {
  const client = { query, release: vi.fn() };
  const pool = {
    connect: vi.fn(async () => client),
  } as unknown as DbPool;
  return { client, pool };
}

describe('migrate', () => {
  it('runs every pending migration transaction on one checked-out client', async () => {
    const pending = MIGRATIONS.at(-1)!;
    const query = vi.fn(async (sql: string) => {
      if (sql === 'SELECT id FROM schema_migrations') {
        return { rows: MIGRATIONS.slice(0, -1).map(({ id }) => ({ id })) };
      }
      return { rows: [] };
    });
    const { client, pool } = poolWithClient(query);

    await migrate(pool);

    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      'SELECT pg_advisory_xact_lock(790927655922234167::bigint)',
      expect.stringContaining('CREATE TABLE IF NOT EXISTS schema_migrations'),
      'SELECT id FROM schema_migrations',
      pending.sql,
      'INSERT INTO schema_migrations (id) VALUES ($1)',
      'COMMIT',
    ]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('rolls back a failed migration and always releases the client', async () => {
    const pending = MIGRATIONS.at(-1)!;
    const failure = new Error('migration failed');
    const query = vi.fn(async (sql: string) => {
      if (sql === 'SELECT id FROM schema_migrations') {
        return { rows: MIGRATIONS.slice(0, -1).map(({ id }) => ({ id })) };
      }
      if (sql === pending.sql) throw failure;
      return { rows: [] };
    });
    const { client, pool } = poolWithClient(query);

    await expect(migrate(pool)).rejects.toBe(failure);

    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(query).not.toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });
});
