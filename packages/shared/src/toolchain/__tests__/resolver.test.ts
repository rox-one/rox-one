import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { currentPlatform, toolchainPaths } from '../manifest';
import { whichTool } from '../exec';
import { createResolver } from '../resolver';
import type { ToolEntry } from '../types';

const isWindows = process.platform === 'win32';
const binName = (n: string) => (isWindows ? `${n}.exe` : n);

let tmpDir: string;
let pathShimDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-res-'));
  pathShimDir = path.join(tmpDir, 'path-shim');
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function putExecutable(file: string, content = '#!/bin/sh\ntrue\n'): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  if (!isWindows) fs.chmodSync(file, 0o755);
}

const FAKE_MANIFEST: ToolEntry[] = [
  {
    name: 'jq',
    version: '1.0.0',
    displayName: 'jq',
    artifacts: {
      [currentPlatform()]: {
        url: 'file://fixture',
        sha256: 'a'.repeat(64),
        size: 1,
        archive: 'raw',
        binPaths: [`bin/${binName('jq')}`],
      },
    },
  },
];

describe('resolver', () => {
  it('toolchain имеет приоритет над PATH', async () => {
    const paths = toolchainPaths(path.join(tmpDir, 'cfg1'));
    const tcBin = path.join(paths.toolchainDir, 'jq', 'current', 'bin', binName('jq'));
    // эмулируем установленный toolchain ('current' как реальная директория)
    putExecutable(tcBin, '#!/bin/sh\necho toolchain\n');
    putExecutable(path.join(pathShimDir, binName('jq')), '#!/bin/sh\necho system\n');

    const resolver = createResolver(paths, { manifest: FAKE_MANIFEST, pathEnv: pathShimDir });
    expect(await resolver.findExecutable('jq')).toBe(tcBin);
  });

  it('fallback на PATH, когда в toolchain пусто', async () => {
    const paths = toolchainPaths(path.join(tmpDir, 'cfg2'));
    putExecutable(path.join(pathShimDir, binName('jq')));
    const resolver = createResolver(paths, { manifest: FAKE_MANIFEST, pathEnv: pathShimDir });
    expect(await resolver.findExecutable('jq')).toBe(path.join(pathShimDir, binName('jq')));
  });

  it('null, когда нигде нет', async () => {
    const paths = toolchainPaths(path.join(tmpDir, 'cfg3'));
    const resolver = createResolver(paths, {
      manifest: FAKE_MANIFEST,
      pathEnv: path.join(tmpDir, 'empty-path'),
    });
    expect(await resolver.findExecutable('definitely-missing-tool')).toBeNull();
  });

  it('toolchainPathPrefix содержит bin-директории только установленных инструментов', async () => {
    const paths = toolchainPaths(path.join(tmpDir, 'cfg4'));
    putExecutable(path.join(paths.toolchainDir, 'jq', 'current', 'bin', binName('jq')));
    const resolver = createResolver(paths, { manifest: FAKE_MANIFEST, pathEnv: '' });
    const prefix = await resolver.toolchainPathPrefix();
    expect(prefix).toBe(path.join(paths.toolchainDir, 'jq', 'current', 'bin'));

    const emptyResolver = createResolver(toolchainPaths(path.join(tmpDir, 'cfg5')), {
      manifest: FAKE_MANIFEST,
      pathEnv: '',
    });
    expect(await emptyResolver.toolchainPathPrefix()).toBe('');
  });

  it('toolchainDir возвращает корень из paths', () => {
    const paths = toolchainPaths(path.join(tmpDir, 'cfg6'));
    expect(createResolver(paths).toolchainDir()).toBe(paths.toolchainDir);
  });

  describe('win32 (platform DI)', () => {
    const WIN_MANIFEST: ToolEntry[] = [
      {
        name: 'omp',
        version: '17.2.10',
        displayName: 'omp',
        artifacts: {
          'win32-x64': {
            url: 'file://fixture',
            sha256: 'a'.repeat(64),
            size: 1,
            archive: 'tar.gz',
            binPaths: ['bin/omp', 'bin/omp.cmd'],
          },
        },
      },
    ];

    it('toolchain .cmd-resolver находит omp.cmd по базовому имени omp', async () => {
      const paths = toolchainPaths(path.join(tmpDir, 'cfg-win1'));
      const tcBin = path.join(paths.toolchainDir, 'omp', 'current', 'bin', 'omp.cmd');
      putExecutable(tcBin, '@echo off\r\n');
      const resolver = createResolver(paths, {
        manifest: WIN_MANIFEST,
        pathEnv: path.join(tmpDir, 'empty-path'),
        platform: 'win32',
      });
      expect(await resolver.findExecutable('omp')).toBe(tcBin);
    });

    it('PATH-поиск win32 пробует .cmd после .exe', async () => {
      const shim = path.join(tmpDir, 'win-shim');
      putExecutable(path.join(shim, 'npx.cmd'), '@echo off\r\n');
      const resolver = createResolver(toolchainPaths(path.join(tmpDir, 'cfg-win2')), {
        manifest: WIN_MANIFEST,
        pathEnv: shim,
        platform: 'win32',
      });
      expect(await resolver.findExecutable('npx')).toBe(path.join(shim, 'npx.cmd'));
    });

    it('имя с расширением (.exe/.cmd) не дополняется', async () => {
      const shim = path.join(tmpDir, 'win-shim2');
      putExecutable(path.join(shim, 'uv.exe'), '');
      putExecutable(path.join(shim, 'omp.cmd'), '@echo off\r\n');
      const resolver = createResolver(toolchainPaths(path.join(tmpDir, 'cfg-win3')), {
        manifest: WIN_MANIFEST,
        pathEnv: shim,
        platform: 'win32',
      });
      expect(await resolver.findExecutable('uv.exe')).toBe(path.join(shim, 'uv.exe'));
      expect(await resolver.findExecutable('omp.cmd')).toBe(path.join(shim, 'omp.cmd'));
    });

    it('posix-семантика без DI не трогает .cmd', async () => {
      const shim = path.join(tmpDir, 'posix-shim');
      putExecutable(path.join(shim, 'something'));
      const resolver = createResolver(toolchainPaths(path.join(tmpDir, 'cfg-win4')), {
        manifest: WIN_MANIFEST,
        pathEnv: shim,
        platform: 'linux',
      });
      // Platform DI changes PATH separators too; use a relative native-fixture
      // path so a Windows drive colon is not treated as a POSIX separator.
      const relativeShim = path.relative(process.cwd(), shim);
      const posixResolver = createResolver(toolchainPaths(path.join(tmpDir, 'posix-di')), {
        manifest: WIN_MANIFEST, pathEnv: relativeShim, platform: 'linux',
      });
      expect(await posixResolver.findExecutable('something')).toBe(path.join(relativeShim, 'something'));
      expect(await resolver.findExecutable('something.cmd')).toBeNull();
    });

    it('uses semicolon-separated quoted PATH entries and batch launchers', async () => {
      const shim = path.join(tmpDir, 'quoted path');
      putExecutable(path.join(shim, 'custom.bat'), '@echo off\r\n');
      const pathEnv = `${path.join(tmpDir, 'missing')};"${shim}"`;
      const resolver = createResolver(toolchainPaths(path.join(tmpDir, 'quoted')), {
        manifest: [], platform: 'win32', pathEnv,
      });
      expect(await resolver.findExecutable('custom')).toBe(path.join(shim, 'custom.bat'));
      if (isWindows) expect(await whichTool('custom', pathEnv)).toBe(path.join(shim, 'custom.bat'));
    });

    it('does not resolve a directory as an executable', async () => {
      const shim = path.join(tmpDir, 'directory-shim');
      fs.mkdirSync(path.join(shim, 'gh.exe'), { recursive: true });
      const resolver = createResolver(toolchainPaths(path.join(tmpDir, 'directory')), {
        manifest: [], platform: 'win32', pathEnv: shim,
      });
      expect(await resolver.findExecutable('gh')).toBeNull();
    });

    it('prefers the Windows launcher over a Unix wrapper in a managed bin directory', async () => {
      const paths = toolchainPaths(path.join(tmpDir, 'dual-wrapper'));
      const bin = path.join(paths.toolchainDir, 'omp', 'current', 'bin');
      putExecutable(path.join(bin, 'omp'));
      putExecutable(path.join(bin, 'omp.cmd'), '@echo off\r\n');
      const resolver = createResolver(paths, { manifest: WIN_MANIFEST, platform: 'win32', pathEnv: '' });
      expect(await resolver.findExecutable('omp')).toBe(path.join(bin, 'omp.cmd'));
    });

    it('resolves managed python3 through python.exe before a system alias', async () => {
      const paths = toolchainPaths(path.join(tmpDir, 'python-alias'));
      const python = path.join(paths.toolchainDir, 'python', 'current', '.pyinstall', 'python.exe');
      const shim = path.join(tmpDir, 'python-system');
      putExecutable(python);
      putExecutable(path.join(shim, 'python3.exe'));
      const resolver = createResolver(paths, { platform: 'win32', pathEnv: shim });
      expect(await resolver.findExecutable('python3')).toBe(python);
    });

    it('never substitutes npx for a missing managed node', async () => {
      const paths = toolchainPaths(path.join(tmpDir, 'missing-node'));
      putExecutable(path.join(paths.toolchainDir, 'node', 'current', 'node-v22.23.2-win-x64', 'npx.cmd'));
      const resolver = createResolver(paths, { platform: 'win32', pathEnv: '' });
      expect(await resolver.findExecutable('node')).toBeNull();
    });

    it('includes generated pip and git-npm launchers in resolution and PATH', async () => {
      const paths = toolchainPaths(path.join(tmpDir, 'generated'));
      const cli = path.join(paths.toolchainDir, 'cli-anything', 'current', 'bin', 'cli-hub.cmd');
      const gbrain = path.join(paths.toolchainDir, 'gbrain', 'current', 'bin', 'gbrain.exe');
      putExecutable(cli);
      putExecutable(gbrain);
      const resolver = createResolver(paths, { platform: 'win32', pathEnv: '' });
      expect(await resolver.findExecutable('cli-hub')).toBe(cli);
      expect(await resolver.findExecutable('gbrain')).toBe(gbrain);
      const prefix = await resolver.toolchainPathPrefix();
      expect(prefix.split(';')).toContain(path.dirname(cli));
      expect(prefix.split(';')).toContain(path.dirname(gbrain));
    });
  });
});
