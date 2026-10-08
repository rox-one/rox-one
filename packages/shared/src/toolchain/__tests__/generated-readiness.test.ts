import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createManager } from '../manager';
import { createResolver } from '../resolver';
import { toolchainPaths } from '../manifest';
import { getGitLock } from '../git-locks';
import { TOOLCHAIN_INSTALL_COMPLETE_MARKER } from '../types';
import type { ToolEntry } from '../types';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-generated-ready-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

const gbrain: ToolEntry = {
  name: 'gbrain', version: '15b9863d1363', kind: 'git-npm', tier: 'default-on',
  displayName: 'gbrain', artifacts: {},
};
const cli: ToolEntry = {
  name: 'cli-anything', version: '0.4.1', kind: 'pip', tier: 'opt-in',
  displayName: 'CLI-Anything', systemBinary: 'cli-hub', pipModule: 'cli_hub.cli', artifacts: {},
};

function put(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'fixture', { mode: 0o755 });
}

function frozenSource(versionDir: string): void {
  const lock = getGitLock(gbrain.name, gbrain.version)!;
  const source = path.join(versionDir, 'source');
  fs.mkdirSync(path.join(source, '.git'), { recursive: true });
  fs.writeFileSync(path.join(source, '.git', 'HEAD'), `${lock.commit}\n`);
  fs.writeFileSync(path.join(source, 'bun.lock'), 'retained frozen upstream fixture\n');
  fs.writeFileSync(path.join(source, 'package.json'), '{"name":"gbrain","bin":{"gbrain":"cli.js"}}\n');
  put(path.join(source, 'cli.js'));
  fs.writeFileSync(path.join(versionDir, TOOLCHAIN_INSTALL_COMPLETE_MARKER), JSON.stringify({
    format: 'git-npm-local-source-v1', repo: lock.repo, commit: lock.commit,
  }));
}
function seed(entry: ToolEntry) {
  const paths = toolchainPaths(root);
  const version = path.join(paths.toolchainDir, entry.name, entry.version);
  const current = path.join(paths.toolchainDir, entry.name, 'current');
  fs.mkdirSync(version, { recursive: true });
  fs.mkdirSync(current, { recursive: true });
  fs.writeFileSync(paths.stateFile, JSON.stringify({ tools: {
    [entry.name]: { installedVersion: entry.version, installedPath: version },
  } }));
  return { paths, version, current };
}

for (const platform of ['linux-x64', 'win32-x64'] as const) {
  const win = platform === 'win32-x64';
  const osPlatform = win ? 'win32' : 'linux';
  const suffix = win ? '.cmd' : '';
  describe(`generated readiness (${platform})`, () => {
    it('does not accept directory-only git-npm state or an unrelated launcher', async () => {
      const { paths, version, current } = seed(gbrain);
      const manager = createManager(paths, { manifest: [gbrain], platform, pathEnv: '', windowsBootstrap: null });
      const resolver = createResolver(paths, { manifest: [gbrain], platform: osPlatform, pathEnv: '', windowsBootstrap: null });
      expect((await manager.status())[0]?.phase).toBe('missing');
      expect(await resolver.findExecutable('gbrain')).toBeNull();
      for (const dir of [version, current]) put(path.join(dir, 'bin', `unrelated${suffix}`));
      expect((await manager.status())[0]?.phase).toBe('missing');
    });

    it('requires the matching git-npm executable in both version and current', async () => {
      const { paths, version, current } = seed(gbrain);
      const manager = createManager(paths, { manifest: [gbrain], platform, pathEnv: '', windowsBootstrap: null });
      put(path.join(version, 'bin', `gbrain${suffix}`));
      expect((await manager.status())[0]?.phase).toBe('missing');
      put(path.join(current, 'bin', `gbrain${suffix}`));
      // Two matching launchers still do not prove the retained frozen source
      // or that the current pointer selects this actual version.
      expect((await manager.status())[0]?.phase).toBe('missing');
      frozenSource(version);
      fs.rmSync(current, { recursive: true });
      if (win) {
        // The real Windows publication fallback is a complete physical copy.
        fs.cpSync(version, current, { recursive: true, dereference: true });
      } else {
        fs.symlinkSync(version, current, 'dir');
      }
      expect((await manager.status())[0]?.phase).toBe('ready');
      fs.rmSync(path.join(version, 'bin', `gbrain${suffix}`));
      fs.mkdirSync(path.join(version, 'bin', `gbrain${suffix}`));
      expect((await manager.status())[0]?.phase).toBe('missing');
    });

    it('requires a pip console launcher and its package directory, but keeps pip opt-in', async () => {
      const { paths, version, current } = seed(cli);
      for (const dir of [version, current]) fs.mkdirSync(path.join(dir, 'py_packages'));
      const manager = createManager(paths, { manifest: [cli], platform, pathEnv: '', windowsBootstrap: null,
        pipInstallImpl: async () => { throw new Error('opt-in pip must not auto-install'); },
      });
      const resolver = createResolver(paths, { manifest: [cli], platform: osPlatform, pathEnv: '', windowsBootstrap: null });
      expect((await manager.status())[0]?.phase).toBe('missing');
      expect(await resolver.findExecutable('cli-hub')).toBeNull();
      expect((await manager.ensureAll({ background: false }))[0]?.phase).toBe('missing');
      for (const dir of [version, current]) put(path.join(dir, 'bin', `cli-hub${suffix}`));
      expect((await manager.status())[0]?.phase).toBe('ready');
      fs.rmSync(path.join(current, 'py_packages'), { recursive: true });
      expect((await manager.status())[0]?.phase).toBe('missing');
    });

    it('repairs missing git-npm launchers during ensureAll and is then idempotent', async () => {
      const { paths } = seed(gbrain);
      const shim = path.join(root, 'path-bin');
      put(path.join(shim, process.platform === 'win32' ? 'bun.exe' : 'bun'));
      let installs = 0;
      const manager = createManager(paths, { manifest: [gbrain], platform, pathEnv: shim, windowsBootstrap: null,
        gitNpmInstallImpl: async ({ versionDir }) => {
          installs++;
          put(path.join(versionDir, 'bin', `gbrain${suffix}`));
          frozenSource(versionDir);
        },
      });
      expect((await manager.ensureAll({ background: false }))[0]?.phase).toBe('ready');
      expect(installs).toBe(1);
      await manager.ensureAll({ background: false });
      expect(installs).toBe(1);
    });
  });
}

it('Windows does not treat the generated Unix shell wrapper as a native launcher', async () => {
  const { paths, version, current } = seed(cli);
  for (const dir of [version, current]) {
    fs.mkdirSync(path.join(dir, 'py_packages'));
    put(path.join(dir, 'bin', 'cli-hub'));
  }
  const manager = createManager(paths, { manifest: [cli], platform: 'win32-x64', pathEnv: '', windowsBootstrap: null });
  expect((await manager.status())[0]?.phase).toBe('missing');
});

it.skipIf(process.platform === 'win32')('POSIX generated launcher needs executable permission', async () => {
  const { paths, version, current } = seed(gbrain);
  for (const dir of [version, current]) {
    const file = path.join(dir, 'bin', 'gbrain');
    put(file);
    fs.chmodSync(file, 0o644);
  }
  frozenSource(version);
  fs.rmSync(current, { recursive: true });
  fs.symlinkSync(version, current, 'dir');
  const manager = createManager(paths, { manifest: [gbrain], platform: 'linux-x64', pathEnv: '', windowsBootstrap: null });
  expect((await manager.status())[0]?.phase).toBe('missing');
});

it('does not publish ready after a git-npm installer creates only a directory', async () => {
  const paths = toolchainPaths(root);
  const shim = path.join(root, 'path-bin');
  put(path.join(shim, process.platform === 'win32' ? 'bun.exe' : 'bun'));
  const manager = createManager(paths, { manifest: [gbrain], pathEnv: shim, windowsBootstrap: null,
    gitNpmInstallImpl: async ({ versionDir }) => { fs.mkdirSync(versionDir, { recursive: true }); },
  });
  const phases: string[] = [];
  manager.onStatusChange((status) => { phases.push(status.phase); });
  expect((await manager.update('gbrain')).phase).toBe('error');
  expect(phases).not.toContain('ready');
  expect(fs.existsSync(paths.stateFile)).toBe(false);
});

it('explicit pip update repairs a missing console launcher', async () => {
  const { paths, version, current } = seed(cli);
  for (const dir of [version, current]) fs.mkdirSync(path.join(dir, 'py_packages'));
  const shim = path.join(root, 'path-bin');
  for (const name of ['uv', 'python3']) put(path.join(shim, `${name}${process.platform === 'win32' ? '.exe' : ''}`));
  let calls = 0;
  const manager = createManager(paths, { manifest: [cli], pathEnv: shim, windowsBootstrap: null,
    pipInstallImpl: async ({ targetDir }) => { calls++; fs.mkdirSync(path.join(targetDir, 'cli_hub')); },
  });
  expect((await manager.status())[0]?.phase).toBe('missing');
  expect((await manager.update('cli-anything')).phase).toBe('ready');
  expect(calls).toBe(1);
  expect(await createResolver(paths, { manifest: [cli], pathEnv: '', windowsBootstrap: null }).findExecutable('cli-hub')).not.toBeNull();
});
