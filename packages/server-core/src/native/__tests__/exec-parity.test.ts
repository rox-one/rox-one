import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NativeSupervisor, resolveNativeBin } from '../supervisor.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../../../');
const bin = resolveNativeBin(repoRoot) ?? (existsSync(process.env.CRAFT_NATIVE_BIN ?? '')
  ? process.env.CRAFT_NATIVE_BIN!
  : null);

function silentLogger() {
  return { info() {}, warn() {}, error() {}, debug() {} };
}

describe.skipIf(!bin)('craft-exec exec:run', () => {
  const dirs: string[] = [];
  let supervisor: NativeSupervisor | null = null;

  afterEach(async () => {
    await supervisor?.stop();
    supervisor = null;
    for (const dir of dirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('echoes through the sidecar', async () => {
    const sockDir = await mkdtemp(join(tmpdir(), 'craft-exec-'));
    dirs.push(sockDir);
    const cwd = await mkdtemp(join(tmpdir(), 'craft-exec-cwd-'));
    dirs.push(cwd);
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
    const result = await client!.invoke<{
      stdout: string;
      exitCode: number | null;
      timedOut: boolean;
    }>('exec:run', { command: 'echo craft-exec-sidecar', cwd, timeoutMs: 5000 });
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('craft-exec-sidecar');
  }, 30_000);

  test('rejects cwd outside workspaceRoot', async () => {
    const sockDir = await mkdtemp(join(tmpdir(), 'craft-exec-jail-'));
    dirs.push(sockDir);
    const workspace = await mkdtemp(join(tmpdir(), 'craft-exec-ws-'));
    const outside = await mkdtemp(join(tmpdir(), 'craft-exec-out-'));
    dirs.push(workspace, outside);
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
    await expect(
      client!.invoke('exec:run', {
        command: 'echo no',
        cwd: outside,
        workspaceRoot: workspace,
        timeoutMs: 5000,
      }),
    ).rejects.toThrow(/workspace/i);
  }, 30_000);
});
