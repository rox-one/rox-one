import type { DbPool } from './pool.js';
import { MIGRATIONS } from './schema.js';

export async function migrate(pool: DbPool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    try {
      await client.query(
        'SELECT pg_advisory_xact_lock(790927655922234167::bigint)',
      );
      await client.query(
        'CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
      );
      const applied = await client.query<{ id: string }>(
        'SELECT id FROM schema_migrations',
      );
      const appliedSet = new Set(
        applied.rows.map((row: { id: string }) => row.id),
      );

      for (const migration of MIGRATIONS) {
        if (appliedSet.has(migration.id)) continue;
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO schema_migrations (id) VALUES ($1)',
          [migration.id],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    client.release();
  }
}
