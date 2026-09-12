/**
 * DaytonaProvider — in-memory client conformance, lifecycle, secrets, zombies.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { conformanceSuite } from '../conformance.ts';
import { MemoryDaytonaClient, HttpDaytonaClient, DAYTONA_RUN_LABEL } from '../daytona-client.ts';
import { DaytonaProvider } from '../daytona-provider.ts';
import { coercePublicCloudRunProvider, isPublicCloudRunProvider } from '../public-registry.ts';
import { CloudRunnerError } from '../types.ts';

async function withDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'daytona-run-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('public cloud-run registry', () => {
  test('exposes daytona/local/native and maps retired providers to daytona', () => {
    expect(isPublicCloudRunProvider('daytona')).toBe(true);
    expect(isPublicCloudRunProvider('cloudflare')).toBe(false);
    expect(isPublicCloudRunProvider('modal')).toBe(false);
    expect(isPublicCloudRunProvider('e2b')).toBe(false);
    expect(coercePublicCloudRunProvider('cloudflare')).toBe('daytona');
    expect(coercePublicCloudRunProvider('modal')).toBe('daytona');
    expect(coercePublicCloudRunProvider('e2b')).toBe('daytona');
    expect(coercePublicCloudRunProvider('local')).toBe('local');
  });
});

describe('DaytonaProvider (memory client)', () => {
  test('satisfies CloudRunProvider conformance', async () => {
    await withDir(async (dir) => {
      const results = await conformanceSuite(
        () => new DaytonaProvider({ baseDir: dir, client: new MemoryDaytonaClient({ execDelayMs: 250 }) }),
      );
      const failures = results.filter((r) => !r.ok);
      expect(failures.map((f) => `${f.name}: ${f.error ?? ''}`)).toEqual([]);
    });
  });

  test('walks start/ready/running then done and destroys the sandbox', async () => {
    await withDir(async (dir) => {
      const client = new MemoryDaytonaClient({ execDelayMs: 20 });
      const provider = new DaytonaProvider({ baseDir: dir, client });
      const spec = {
        id: `life-${Date.now().toString(36)}`,
        name: 'lifecycle',
        subtasks: [{ id: 't1', prompt: 'Research topic A' }],
        limits: { maxWallClockSec: 60 },
        ttlSec: 600,
      };
      const handle = await provider.createRun(spec);
      expect(handle.provider).toBe('daytona');
      const seen = new Set<string>();
      for await (const event of provider.subscribeEvents(spec.id)) {
        if (event.type === 'state') seen.add(event.status.state);
      }
      expect(seen.has('start')).toBe(true);
      expect(seen.has('ready')).toBe(true);
      expect(seen.has('running')).toBe(true);
      const status = await provider.getStatus(spec.id);
      expect(status.state).toBe('done');
      const sandboxes = await client.listSandboxes({ key: DAYTONA_RUN_LABEL, value: '1' });
      expect(sandboxes).toEqual([]);
    });
  });

  test('cancel terminates the sandbox and reads cancelled back', async () => {
    await withDir(async (dir) => {
      const client = new MemoryDaytonaClient({ execDelayMs: 2_000 });
      const provider = new DaytonaProvider({ baseDir: dir, client });
      const spec = {
        id: `cancel-${Date.now().toString(36)}`,
        name: 'cancel',
        subtasks: [{ id: 't1', prompt: 'slow' }],
        limits: { maxWallClockSec: 120 },
      };
      await provider.createRun(spec);
      await provider.cancel(spec.id);
      const status = await provider.getStatus(spec.id);
      expect(status.state).toBe('cancelled');
      expect(status.failureReason).toBe('cancelled');
      expect(await client.listSandboxes({ key: DAYTONA_RUN_LABEL, value: '1' })).toEqual([]);
    });
  });

  test('watchdog expires a run past the wall-clock budget', async () => {
    await withDir(async (dir) => {
      const client = new MemoryDaytonaClient({ execDelayMs: 2_000 });
      const provider = new DaytonaProvider({ baseDir: dir, client, pollMs: 20 });
      const spec = {
        id: `ttl-${Date.now().toString(36)}`,
        name: 'expire',
        subtasks: [{ id: 't1', prompt: 'slow' }],
        limits: { maxWallClockSec: 1 },
      };
      await provider.createRun(spec);
      const deadline = Date.now() + 3_000;
      let state = (await provider.getStatus(spec.id)).state;
      while (state !== 'expired' && Date.now() < deadline) {
        await Bun.sleep(40);
        state = (await provider.getStatus(spec.id)).state;
      }
      expect(state).toBe('expired');
      expect(await client.listSandboxes({ key: DAYTONA_RUN_LABEL, value: '1' })).toEqual([]);
    });
  });

  test('sweepZombies deletes leftover labelled sandboxes', async () => {
    await withDir(async (dir) => {
      const client = new MemoryDaytonaClient({ execDelayMs: 0 });
      const leftover = await client.createSandbox({
        name: 'zombie',
        labels: { [DAYTONA_RUN_LABEL]: '1', 'rox.runId': 'gone' },
        autoDeleteIntervalMin: 1,
      });
      leftover.createdAt = Date.now() - 3_600_000;
      const provider = new DaytonaProvider({ baseDir: dir, client, ttlSec: 60 });
      const { deletedSandboxIds } = await provider.sweepZombies();
      expect(deletedSandboxIds).toContain(leftover.id);
    });
  });

  test('durable artifact import never stores the api key on disk', async () => {
    await withDir(async (dir) => {
      const secret = 'daytona-secret-value-XYZ-never-log';
      const client = new MemoryDaytonaClient({ execDelayMs: 10 });
      const provider = new DaytonaProvider({
        baseDir: dir,
        client,
        resolveApiKey: async () => secret,
      });
      const spec = {
        id: `sec-${Date.now().toString(36)}`,
        name: 'secrets',
        subtasks: [{ id: 't1', prompt: 'Research topic A' }],
        limits: { maxWallClockSec: 60 },
      };
      await provider.createRun(spec);
      for await (const _ of provider.subscribeEvents(spec.id)) {
        /* drain */
      }
      const dumped: string[] = [];
      const walk = async (rel: string): Promise<void> => {
        const abs = join(dir, spec.id, rel);
        for (const entry of await readdir(abs, { withFileTypes: true })) {
          const child = rel ? `${rel}/${entry.name}` : entry.name;
          if (entry.isDirectory()) await walk(child);
          else dumped.push(await readFile(join(abs, entry.name), 'utf8'));
        }
      };
      await walk('');
      expect(dumped.join('\n')).not.toContain(secret);
    });
  });
});

describe('HttpDaytonaClient', () => {
  test('strips the api key from thrown errors', async () => {
    const secret = 'super-secret-daytona-token-abcdef';
    const client = new HttpDaytonaClient({
      apiUrl: 'https://app.daytona.io/api',
      resolveApiKey: async () => secret,
      fetchImpl: async () => {
        throw new Error(`upstream rejected ${secret}`);
      },
    });
    try {
      await client.getSandbox('sbx-1');
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(CloudRunnerError);
      expect((error as Error).message).not.toContain(secret);
      expect((error as Error).message).toContain('***REDACTED***');
    }
  });
});

const live = process.env.DAYTONA_LIVE === '1' && Boolean(process.env.DAYTONA_API_KEY);

describe('DaytonaProvider live sandbox', () => {
  test.skipIf(!live)('start then cancel terminates the sandbox with a cleanup receipt', async () => {
    await withDir(async (dir) => {
      const provider = new DaytonaProvider({
        baseDir: dir,
        resolveApiKey: async () => process.env.DAYTONA_API_KEY ?? '',
        ttlSec: 300,
      });
      const spec = {
        id: `live-${Date.now().toString(36)}`,
        name: 'live-cancel',
        subtasks: [{ id: 't1', prompt: 'bounded live cancel' }],
        limits: { maxWallClockSec: 120 },
        ttlSec: 300,
      };
      await provider.createRun(spec);
      await provider.cancel(spec.id);
      const status = await provider.getStatus(spec.id);
      expect(status.state).toBe('cancelled');
      const receipt = await provider.sweepZombies();
      expect(Array.isArray(receipt.deletedSandboxIds)).toBe(true);
    });
  });
});
