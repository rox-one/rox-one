import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { conformanceSuite, NativeRunProvider } from '@craft-agent/cloud-runner';
import { NativeSupervisor, resolveNativeBin } from '../supervisor.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../../../');
const bin = resolveNativeBin(repoRoot) ?? (existsSync(process.env.CRAFT_NATIVE_BIN ?? '')
  ? process.env.CRAFT_NATIVE_BIN!
  : null);

function silentLogger() {
  return { info() {}, warn() {}, error() {}, debug() {} };
}

describe.skipIf(!bin)('NativeRunProvider conformance (craft-rund)', () => {
  const dirs: string[] = [];
  let supervisor: NativeSupervisor | null = null;

  afterEach(async () => {
    await supervisor?.stop();
    supervisor = null;
    for (const dir of dirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  async function startProvider(runnerCommand?: string[]) {
    const sockDir = await mkdtemp(join(tmpdir(), 'craft-native-rund-'));
    dirs.push(sockDir);
    const baseDir = await mkdtemp(join(tmpdir(), 'craft-rund-runs-'));
    dirs.push(baseDir);
    supervisor = new NativeSupervisor({
      enabled: true,
      resolveBin: () => bin,
      logger: silentLogger(),
      connectTimeoutMs: 8_000,
      cwd: repoRoot,
      socketPath: join(sockDir, 'n.sock'),
    });
    await supervisor.start();
    const client = supervisor.getClient();
    expect(client).not.toBeNull();
    return new NativeRunProvider({
      baseDir,
      rpc: client!,
      runnerCommand,
      pollMs: 40,
    });
  }

  test('satisfies the CloudRunProvider contract', async () => {
    const provider = await startProvider();
    const results = await conformanceSuite(() => provider);
    const failures = results.filter((r) => !r.ok);
    expect(failures.map((f) => `${f.name}: ${f.error ?? ''}`)).toEqual([]);
  }, 60_000);

  test('kill of runner pid makes getStatus terminal failed/runner_error', async () => {
    const provider = await startProvider(['bash', '-c', 'exec sleep 120']);
    const spec = {
      id: `crash-${Date.now().toString(36)}`,
      name: 'crash-reconcile',
      subtasks: [{ id: 't1', prompt: 'p' }],
    };
    await provider.createRun(spec);
    const pidRaw = await readFile(join(provider.baseDir, spec.id, 'runner.pid'), 'utf8');
    process.kill(Number.parseInt(pidRaw.trim(), 10), 'SIGKILL');
    const status = await provider.getStatus(spec.id);
    expect(status.state).toBe('failed');
    expect(status.failureReason).toBe('runner_error');
  });
});
