import { describe, it, expect } from 'bun:test';
import { applyFilesystemIsolation, buildDarwinSandboxProfile } from './filesystem-isolation.ts';
import { mkdtempSync, mkdirSync, symlinkSync, readFileSync, existsSync, rmSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

describe('buildDarwinSandboxProfile', () => {
  it('includes session subpath write allow', () => {
    const profile = buildDarwinSandboxProfile('/tmp/craft-session');
    expect(profile).toContain('(allow file-write* (subpath "/tmp/craft-session"))');
    expect(profile).not.toContain('(deny network*)');
  });

  it('includes deny network when requested', () => {
    const profile = buildDarwinSandboxProfile('/tmp/craft-session', { includeNetworkDeny: true });
    expect(profile).toContain('(deny network*)');
  });

  it('allows writes through the session alias while denying its sibling in the actual Darwin sandbox', () => {
    if (process.platform !== 'darwin') return;
    const root = mkdtempSync(join(tmpdir(), 'filesystem-alias-'));
    try {
      const session = join(root, 'session');
      const alias = join(root, 'session-alias');
      const sibling = join(root, 'session-other');
      mkdirSync(session);
      mkdirSync(sibling);
      symlinkSync(session, alias);
      expect(buildDarwinSandboxProfile(alias)).toContain(`(subpath "${realpathSync(session)}")`);
      const output = join(alias, 'output.txt');
      const denied = join(sibling, 'forbidden.txt');
      const plan = applyFilesystemIsolation('/bin/sh', ['-c', 'printf ok > "$1"; if printf forbidden > "$2"; then exit 9; fi', 'fixture', output, denied], alias);
      expect(plan.status).toBe('enforced');
      const child = spawnSync(plan.command, plan.args, { encoding: 'utf8', timeout: 5000 });
      expect(child.status).toBe(0);
      expect(readFileSync(output, 'utf8')).toBe('ok');
      expect(existsSync(denied)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
