import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('application-owned skill installation, invocation and removal work in a synthetic HOME', () => {
  const home = mkdtempSync(join(tmpdir(), 'rox-managed-skills-'));
  try {
    const result = spawnSync(process.execPath, ['test', join(import.meta.dir, '../../../../server-core/src/handlers/rpc/__tests__/managed-skills-installation.isolated.ts')], {
      cwd: home,
      env: { ...process.env, HOME: home, ROX_CONFIG_DIR: join(home, '.rox'), CRAFT_CONFIG_DIR: undefined },
      encoding: 'utf8', timeout: 25_000,
    });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    expect(result.error, output).toBeUndefined();
    expect(result.status, output).toBe(0);
    expect(output).toContain('12 pass');
    expect(output).toContain('0 fail');
  } finally { rmSync(home, { recursive: true, force: true }); }
}, 30_000);
