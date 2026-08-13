/**
 * Conformance run against LocalSubprocessProvider.
 *
 * This is the always-on leg of the matrix (PRD G1.4); cloud providers
 * add their own test files gated behind env flags and reuse
 * conformanceSuite unchanged.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
