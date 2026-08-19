/**
 * Conformance run against LocalSubprocessProvider.
 *
 * This is the always-on leg of the matrix (PRD G1.4); cloud providers
 * add their own test files gated behind env flags and reuse
 * conformanceSuite unchanged.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { conformanceSuite } from '../conformance.ts';
import { LocalSubprocessProvider } from '../local-provider.ts';

describe('LocalSubprocessProvider crash reconcile (local-only)', () => {
  test('kill of runner pid makes getStatus terminal failed/runner_error', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'cloud-runner-crash-'));
    const provider = new LocalSubprocessProvider({
      baseDir,
      // Provider appends `--dir <runDir>`; exec so runner.pid is sleep itself.
      runnerCommand: ['bash', '-c', 'exec sleep 120'],
    });
    const spec = {
      id: `crash-${Date.now().toString(36)}`,
      name: 'crash-reconcile',
      subtasks: [{ id: 't1', prompt: 'p' }],
    };
    try {
      await provider.createRun(spec);
      const pidRaw = await readFile(join(baseDir, spec.id, 'runner.pid'), 'utf8');
      const pid = Number.parseInt(pidRaw.trim(), 10);
      expect(Number.isFinite(pid)).toBe(true);
      process.kill(pid, 'SIGKILL');
      const status = await provider.getStatus(spec.id);
      expect(status.state).toBe('failed');
      expect(status.failureReason).toBe('runner_error');
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test('cancel kills nested children, not only runner.pid', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'cloud-runner-tree-'));
    const provider = new LocalSubprocessProvider({
      baseDir,
      // $1 is the run dir (provider appends `--dir <runDir>` after bash -c).
      runnerCommand: ['bash', '-c', 'sleep 120 & echo $! > "$1/nested.pid"; wait'],
    });
    const spec = {
      id: `tree-${Date.now().toString(36)}`,
      name: 'process-tree',
      subtasks: [{ id: 't1', prompt: 'p' }],
    };
    let nestedPid: number | null = null;
    try {
      await provider.createRun(spec);
      const nestedPath = join(baseDir, spec.id, 'nested.pid');
      const appearBy = Date.now() + 2_000;
      while (!existsSync(nestedPath) && Date.now() < appearBy) {
        await Bun.sleep(20);
      }
      nestedPid = Number.parseInt(await readFile(nestedPath, 'utf8'), 10);
      expect(Number.isFinite(nestedPid)).toBe(true);
      expect(() => process.kill(nestedPid!, 0)).not.toThrow();
      await provider.cancel(spec.id);
      const goneBy = Date.now() + 2_000;
      let alive = true;
      while (Date.now() < goneBy) {
        try {
          process.kill(nestedPid, 0);
          await Bun.sleep(20);
        } catch {
          alive = false;
          break;
        }
      }
      expect(alive).toBe(false);
      const status = await provider.getStatus(spec.id);
      expect(status.state).toBe('cancelled');
    } finally {
      if (nestedPid !== null) {
        try { process.kill(nestedPid, 'SIGKILL'); } catch { /* already dead */ }
      }
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test('wall-clock budget marks the run failed/budget_exceeded', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'cloud-runner-budget-'));
    const provider = new LocalSubprocessProvider({
      baseDir,
      runnerCommand: ['bash', '-c', 'exec sleep 120'],
    });
    const spec = {
      id: `budget-${Date.now().toString(36)}`,
      name: 'budget',
      subtasks: [{ id: 't1', prompt: 'p' }],
      limits: { maxWallClockSec: 1 },
    };
    try {
      await provider.createRun(spec);
      const deadline = Date.now() + 5_000;
      let status = await provider.getStatus(spec.id);
      while (status.state !== 'failed' && Date.now() < deadline) {
        await Bun.sleep(50);
        status = await provider.getStatus(spec.id);
      }
      expect(status.state).toBe('failed');
      expect(status.failureReason).toBe('budget_exceeded');
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});

describe('LocalSubprocessProvider conformance', () => {
  test('satisfies the CloudRunProvider contract', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'cloud-runner-test-'));
    try {
      const results = await conformanceSuite(() => new LocalSubprocessProvider({ baseDir }));
      const failures = results.filter((r) => !r.ok);
      expect(failures.map((f) => `${f.name}: ${f.error ?? ''}`)).toEqual([]);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  }, 60_000);
});
