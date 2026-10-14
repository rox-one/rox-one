/**
 * Every agent turn rebuilds its desired source set and reconciles it into the
 * pool. A source that cannot connect must not make each turn pay its full
 * handshake (30s, twice) — the failure is remembered per config and the
 * reconciliation only reports it as unavailable until the backoff elapses.
 */
import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import { McpClientPool, CONNECT_RETRY_BASE_MS } from '../mcp-pool.ts';
import type { PoolClient } from '../client.ts';

/** Stands in for an unreachable endpoint that is rebuilt fresh on every turn. */
const qdrantConfig = () => ({
  type: 'http' as const,
  url: 'http://127.0.0.1:6333/mcp',
  headers: { 'X-Api-Key': 'test-key', Authorization: 'Bearer test' },
});

/** Fails like an unreachable endpoint until `fail` is cleared. */
class ScriptedPool extends McpClientPool {
  attempts = 0;
  fail = true;

  protected override createClient(): PoolClient {
    this.attempts++;
    return {
      listTools: async () => {
        if (this.fail) throw new Error('stub: endpoint unreachable');
        return [];
      },
      callTool: async () => ({ content: '' }),
      close: async () => {},
      isConnected: () => !this.fail,
    };
  }
}

afterEach(() => {
  setSystemTime();
});

describe('McpClientPool connect backoff', () => {
  test('an unchanged failing source is not re-handshaked on the next reconciliation', async () => {
    const pool = new ScriptedPool();
    try {
      expect(await pool.sync({ qdrant: qdrantConfig() })).toEqual(['qdrant']);
      expect(pool.attempts).toBe(1);

      // Next turn: the same source is reconciled again as a freshly rebuilt
      // config — content, not object identity, decides.
      expect(await pool.sync({ qdrant: qdrantConfig() })).toEqual(['qdrant']);
      expect(pool.attempts).toBe(1);
      expect(await pool.sync({ qdrant: qdrantConfig() })).toEqual(['qdrant']);
      expect(pool.attempts).toBe(1);

      // …and it is still reported unavailable without another handshake.
      await expect(pool.ensureConnected('qdrant', qdrantConfig())).rejects.toThrow(/unavailable/);
      expect(pool.attempts).toBe(1);
    } finally {
      await pool.disconnectAll();
    }
  });

  test('a changed config is attempted immediately', async () => {
    const pool = new ScriptedPool();
    try {
      await expect(pool.ensureConnected('qdrant', qdrantConfig())).rejects.toThrow(/failed/);
      expect(pool.attempts).toBe(1);

      const rotated = { ...qdrantConfig(), headers: { 'X-Api-Key': 'rotated', Authorization: 'Bearer test' } };
      await expect(pool.ensureConnected('qdrant', rotated)).rejects.toThrow(/failed/);
      expect(pool.attempts).toBe(2);
    } finally {
      await pool.disconnectAll();
    }
  });

  test('disconnect clears the remembered failure', async () => {
    const pool = new ScriptedPool();
    try {
      await expect(pool.ensureConnected('qdrant', qdrantConfig())).rejects.toThrow();
      expect(pool.attempts).toBe(1);

      await pool.disconnect('qdrant');
      await expect(pool.ensureConnected('qdrant', qdrantConfig())).rejects.toThrow(/failed/);
      expect(pool.attempts).toBe(2);
    } finally {
      await pool.disconnectAll();
    }
  });

  test('the failure expires so the source can self-heal', async () => {
    const pool = new ScriptedPool();
    try {
      await expect(pool.ensureConnected('qdrant', qdrantConfig())).rejects.toThrow();
      expect(pool.attempts).toBe(1);

      setSystemTime(new Date(Date.now() + CONNECT_RETRY_BASE_MS + 1_000));
      await expect(pool.ensureConnected('qdrant', qdrantConfig())).rejects.toThrow(/failed/);
      expect(pool.attempts).toBe(2);
    } finally {
      await pool.disconnectAll();
    }
  });

  test('a recovered source clears the memo and later reconciliations are no-ops', async () => {
    const pool = new ScriptedPool();
    try {
      await expect(pool.ensureConnected('qdrant', qdrantConfig())).rejects.toThrow();
      pool.fail = false;
      await pool.connect('qdrant', qdrantConfig());
      expect(pool.isConnected('qdrant')).toBe(true);

      const attempts = pool.attempts;
      await pool.ensureConnected('qdrant', qdrantConfig());
      expect(pool.attempts).toBe(attempts);
    } finally {
      await pool.disconnectAll();
    }
  });
});
