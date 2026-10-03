import { afterEach, describe, expect, it } from 'bun:test';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getGitLock } from '../git-locks';
import { createManager, type GitNpmInstallContext } from '../manager';
import { createResolver } from '../resolver';
import { toolchainPaths } from '../manifest';
import { TOOLCHAIN_INSTALL_COMPLETE_MARKER, type ToolEntry } from '../types';
import { captureTestCommand } from '../../../../../scripts/test-all';

const entry: ToolEntry = {
  name: 'gbrain', version: '15b9863d1363', kind: 'git-npm', tier: 'default-on',
  displayName: 'gbrain', artifacts: {},
};
const lock = getGitLock(entry.name, entry.version)!;
const fixtures: string[] = [];
const launcherName = process.platform === 'win32' ? 'gbrain.exe' : 'gbrain';

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

function makeFixture() {
  const base = mkdtempSync(join(tmpdir(), 'rox-ui001-gitnpm-recovery-'));
  fixtures.push(base);
  const paths = toolchainPaths(join(base, 'profile'));
  const versionDir = join(paths.toolchainDir, entry.name, entry.version);
  const bunBin = join(base, 'bunbin');
  mkdirSync(bunBin);
  writeFileSync(join(bunBin, process.platform === 'win32' ? 'bun.exe' : 'bun'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return { base, paths, versionDir, bunBin };
}

function writeState(fixture: ReturnType<typeof makeFixture>, installedPath = fixture.versionDir) {
  mkdirSync(fixture.paths.toolchainDir, { recursive: true });
  // Keep generic launcher readiness satisfied so pin/marker corruption itself
  // is what makes these same-version fixtures unavailable.
  symlinkSync(installedPath, join(fixture.paths.toolchainDir, entry.name, 'current'),
    process.platform === 'win32' ? 'junction' : 'dir');
  writeFileSync(fixture.paths.stateFile, JSON.stringify({ tools: {
    gbrain: { installedVersion: entry.version, installedPath },
  } }));
}

function usableInstall(versionDir: string) {
  const source = join(versionDir, 'source');
  mkdirSync(join(source, '.git'), { recursive: true });
  mkdirSync(join(versionDir, 'bin'), { recursive: true });
  mkdirSync(join(versionDir, 'install', 'global'), { recursive: true });
  writeFileSync(join(source, '.git', 'HEAD'), `${lock.commit}\n`);
  writeFileSync(join(source, 'bun.lock'), 'retained upstream frozen lock\n');
  writeFileSync(join(source, 'package.json'), '{"name":"gbrain","bin":{"gbrain":"cli.js"}}\n');
  writeFileSync(join(source, 'cli.js'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  writeFileSync(join(versionDir, 'bin', launcherName), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  writeFileSync(join(versionDir, 'install', 'global', 'package.json'), '{"private":true}\n');
  writeFileSync(join(versionDir, TOOLCHAIN_INSTALL_COMPLETE_MARKER), JSON.stringify({
    format: 'git-npm-local-source-v1', repo: lock.repo, commit: lock.commit,
  }));
}

function makeManager(fixture: ReturnType<typeof makeFixture>, install: (ctx: GitNpmInstallContext) => Promise<void>) {
  return createManager(fixture.paths, { manifest: [entry], pathEnv: fixture.bunBin, gitNpmInstallImpl: install });
}

describe('UI-001 git-npm same-version recovery', () => {
  it.skipIf(process.platform === 'win32')('repairs a current selector pointing at a different runtime before advertising the pinned version ready', async () => {
    const fixture = makeFixture();
    usableInstall(fixture.versionDir);
    const previous = join(fixture.paths.toolchainDir, entry.name, 'previous-runtime');
    usableInstall(previous);
    writeFileSync(join(previous, 'bin', launcherName), '#!/bin/sh\nprintf "old-current-runtime\\n"\n', { mode: 0o755 });
    writeState(fixture);
    const current = join(fixture.paths.toolchainDir, entry.name, 'current');
    rmSync(current);
    symlinkSync(previous, current, 'dir');
    const resolver = createResolver(fixture.paths, { manifest: [entry], pathEnv: '', windowsBootstrap: null });
    const oldLauncher = (await resolver.findExecutable('gbrain'))!;
    expect(realpathSync(oldLauncher)).toBe(realpathSync(join(previous, 'bin', launcherName)));
    const oldResult = await captureTestCommand([oldLauncher]);
    expect(oldResult.exitCode).toBe(0);
    expect(oldResult.stdout).toBe('old-current-runtime\n');
    let installs = 0;
    const installer = async ({ versionDir }: GitNpmInstallContext) => {
      installs++;
      usableInstall(versionDir);
      writeFileSync(join(versionDir, 'bin', launcherName), '#!/bin/sh\nprintf "new-pinned-runtime\\n"\n', { mode: 0o755 });
    };
    const manager = makeManager(fixture, installer);
    expect((await manager.status())[0]?.phase).toBe('missing');
    expect((await manager.ensureAll({ background: false }))[0]?.phase).toBe('ready');
    expect(installs).toBe(1);
    const selected = (await resolver.findExecutable('gbrain'))!;
    expect(realpathSync(selected)).toBe(realpathSync(join(fixture.versionDir, 'bin', launcherName)));
    const result = await captureTestCommand([selected]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('new-pinned-runtime\n');
    const reloaded = makeManager(fixture, installer);
    expect((await reloaded.status())[0]?.phase).toBe('ready');
    await reloaded.ensureAll({ background: false });
    expect(installs).toBe(1);
  });

  it('accepts a completed Windows current copy only with the same retained source pin and completion marker', async () => {
    const fixture = makeFixture();
    usableInstall(fixture.versionDir);
    renameSync(join(fixture.versionDir, 'bin', launcherName), join(fixture.versionDir, 'bin', 'gbrain.cmd'));
    writeState(fixture);
    const current = join(fixture.paths.toolchainDir, entry.name, 'current');
    rmSync(current);
    cpSync(fixture.versionDir, current, { recursive: true, dereference: true });
    const manager = createManager(fixture.paths, { manifest: [entry], platform: 'win32-x64', pathEnv: '', windowsBootstrap: null });
    expect((await manager.status())[0]?.phase).toBe('ready');
    writeFileSync(join(current, TOOLCHAIN_INSTALL_COMPLETE_MARKER), JSON.stringify({
      format: 'git-npm-local-source-v1', repo: lock.repo, commit: 'b'.repeat(40),
    }));
    expect((await manager.status())[0]?.phase).toBe('missing');
    writeFileSync(join(current, TOOLCHAIN_INSTALL_COMPLETE_MARKER), JSON.stringify({
      format: 'git-npm-local-source-v1', repo: lock.repo, commit: lock.commit,
    }));
    writeFileSync(join(current, 'source', '.git', 'HEAD'), `${'b'.repeat(40)}\n`);
    expect((await manager.status())[0]?.phase).toBe('missing');
  });

  it('marks a dangling temporary launcher missing, reinstalls, and stays ready after manager reload', async () => {
    const fixture = makeFixture();
    mkdirSync(join(fixture.versionDir, 'bin'), { recursive: true });
    symlinkSync(join(fixture.base, 'deleted-craft-gitnpm', 'cli.js'), join(fixture.versionDir, 'bin', launcherName));
    writeState(fixture);
    let installs = 0;
    const installer = async ({ versionDir }: GitNpmInstallContext) => { installs++; usableInstall(versionDir); };
    const manager = makeManager(fixture, installer);
    expect((await manager.status())[0]?.phase).toBe('missing');
    expect((await manager.ensureAll({ background: false }))[0]?.phase).toBe('ready');
    expect(installs).toBe(1);
    expect(existsSync(join(fixture.versionDir, 'source', 'cli.js'))).toBe(true);
    expect(readFileSync(join(fixture.versionDir, 'source', '.git', 'HEAD'), 'utf8').trim()).toBe(lock.commit);
    const reloaded = makeManager(fixture, installer);
    expect((await reloaded.status())[0]?.phase).toBe('ready');
    await reloaded.ensureAll({ background: false });
    expect(installs).toBe(1);
  });

  for (const corruption of ['legacy-empty-directory', 'wrong-completion-pin', 'wrong-source-pin', 'missing-lock', 'external-launcher', 'oversized-marker', 'linked-marker', 'linked-source-head', 'linked-lock'] as const) {
    it(`recovers ${corruption} without trusting the retained same-version state`, async () => {
      const fixture = makeFixture();
      usableInstall(fixture.versionDir);
      if (corruption === 'legacy-empty-directory') {
        rmSync(join(fixture.versionDir, 'source'), { recursive: true });
        rmSync(join(fixture.versionDir, TOOLCHAIN_INSTALL_COMPLETE_MARKER));
      } else if (corruption === 'wrong-completion-pin') {
        writeFileSync(join(fixture.versionDir, TOOLCHAIN_INSTALL_COMPLETE_MARKER), JSON.stringify({
          format: 'git-npm-local-source-v1', repo: lock.repo, commit: 'b'.repeat(40),
        }));
      } else if (corruption === 'wrong-source-pin') {
        writeFileSync(join(fixture.versionDir, 'source', '.git', 'HEAD'), `${'b'.repeat(40)}\n`);
      } else if (corruption === 'missing-lock') {
        rmSync(join(fixture.versionDir, 'source', 'bun.lock'));
      } else if (corruption === 'oversized-marker') {
        writeFileSync(join(fixture.versionDir, TOOLCHAIN_INSTALL_COMPLETE_MARKER), ' '.repeat(100_000));
      } else if (corruption === 'linked-marker' || corruption === 'linked-source-head' || corruption === 'linked-lock') {
        const leaf = corruption === 'linked-marker' ? join(fixture.versionDir, TOOLCHAIN_INSTALL_COMPLETE_MARKER)
          : corruption === 'linked-source-head' ? join(fixture.versionDir, 'source', '.git', 'HEAD')
          : join(fixture.versionDir, 'source', 'bun.lock');
        const witness = join(fixture.base, 'outside-identity');
        writeFileSync(witness, readFileSync(leaf));
        rmSync(leaf); symlinkSync(witness, leaf);
      } else {
        const foreign = join(fixture.base, 'foreign-cli');
        writeFileSync(foreign, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
        rmSync(join(fixture.versionDir, 'bin', launcherName));
        symlinkSync(foreign, join(fixture.versionDir, 'bin', launcherName));
      }
      writeState(fixture);
      let installs = 0;
      const manager = makeManager(fixture, async ({ versionDir }) => { installs++; usableInstall(versionDir); });
      expect((await manager.status())[0]?.phase).toBe('missing');
      expect((await manager.ensureAll({ background: false }))[0]?.phase).toBe('ready');
      expect(installs).toBe(1);
    });
  }

  it('refuses to publish a launcher-only partial version before flipping current or writing ready state', async () => {
    const fixture = makeFixture();
    const manager = makeManager(fixture, async ({ versionDir }) => {
      mkdirSync(join(versionDir, 'bin'), { recursive: true });
      writeFileSync(join(versionDir, 'bin', launcherName), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    });
    expect((await manager.ensureAll({ background: false }))[0]?.phase).toBe('error');
    expect(existsSync(join(fixture.paths.toolchainDir, entry.name, 'current'))).toBe(false);
    expect(existsSync(fixture.paths.stateFile)).toBe(false);
    expect((await manager.status())[0]?.phase).toBe('error');
  });

  it('does not report a valid retained version ready when current points at a different version', async () => {
    const fixture = makeFixture();
    const installer = async ({ versionDir }: GitNpmInstallContext) => usableInstall(versionDir);
    const manager = makeManager(fixture, installer);
    expect((await manager.ensureAll({ background: false }))[0]?.phase).toBe('ready');
    const current = join(fixture.paths.toolchainDir, entry.name, 'current');
    const other = join(fixture.paths.toolchainDir, entry.name, 'other-version');
    usableInstall(other); rmSync(current); symlinkSync(other, current, process.platform === 'win32' ? 'junction' : 'dir');
    expect((await makeManager(fixture, installer).status())[0]?.phase).toBe('missing');
  });

  it('serializes concurrent repair and update through the existing per-tool installer', async () => {
    const fixture = makeFixture();
    mkdirSync(fixture.versionDir, { recursive: true });
    writeState(fixture);
    let installs = 0;
    let unblock!: () => void;
    let started!: () => void;
    const installStarted = new Promise<void>((resolve) => { started = resolve; });
    const installBlocked = new Promise<void>((resolve) => { unblock = resolve; });
    const manager = makeManager(fixture, async ({ versionDir }) => {
      installs++; started(); await installBlocked; usableInstall(versionDir);
    });
    expect((await manager.status())[0]?.phase).toBe('missing');
    const repair = manager.ensureAll({ background: false });
    await installStarted;
    const update = manager.update('gbrain');
    expect((await manager.status())[0]?.phase).toBe('installing');
    unblock();
    expect((await repair)[0]?.phase).toBe('ready');
    expect((await update).phase).toBe('ready');
    expect(installs).toBe(1);
  });

  it('keeps a failed partial repair unavailable and retries on the next ensureAll', async () => {
    const fixture = makeFixture();
    mkdirSync(fixture.versionDir, { recursive: true });
    writeState(fixture);
    let installs = 0;
    const manager = makeManager(fixture, async ({ versionDir }) => {
      installs++;
      if (installs === 1) {
        mkdirSync(versionDir, { recursive: true });
        throw new Error('fixture repair failed');
      }
      usableInstall(versionDir);
    });
    expect((await manager.ensureAll({ background: false }))[0]?.phase).toBe('error');
    expect((await manager.status())[0]?.error).toBe('fixture repair failed');
    expect(installs).toBe(1);
    expect((await manager.ensureAll({ background: false }))[0]?.phase).toBe('ready');
    expect(installs).toBe(2);
    if (process.platform !== 'win32') chmodSync(join(fixture.versionDir, 'bin', launcherName), 0o600);
    else rmSync(join(fixture.versionDir, 'bin', launcherName));
    expect((await manager.status())[0]?.phase).toBe('missing');
  });
});
