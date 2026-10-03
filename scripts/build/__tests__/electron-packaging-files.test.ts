import { afterEach, describe, expect, it } from 'bun:test';
import { lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
const { getConfig } = require(join(repo, 'node_modules/app-builder-lib/out/util/config/config.js'));
const { getMainFileMatchers, getFileMatchers } = require(join(repo, 'node_modules/app-builder-lib/out/fileMatcher.js'));
const { expandMacro } = require(join(repo, 'node_modules/app-builder-lib/out/util/macroExpander.js'));
const fixtures: string[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

const binaryTargets = ['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64'];

async function packagingFilter(target: string, arch: string) {
  const app = mkdtempSync(join(tmpdir(), 'rox-packaging-files-'));
  fixtures.push(app);
  const files = [
    'package.json', 'dist/main.cjs', 'dist/renderer/index.html',
    'resources/pi-agent-server/index.js', 'resources/cloud-runner/index.js',
    'resources/scripts/pdf-tool.py', 'vendor/bun/bun', 'vendor/bun/bun.exe',
    ...binaryTargets.flatMap((binary) => [`resources/bin/${binary}/uv`, `dist/resources/bin/${binary}/uv`]),
    'src/main/index.ts', 'scripts/afterPack.cjs', '.env',
    'release/old/mac-arm64/Rox.app/Contents/Frameworks/Mantle.framework/Versions/A/Resources/Info.plist',
  ];
  for (const file of files) {
    mkdirSync(dirname(join(app, file)), { recursive: true });
    writeFileSync(join(app, file), file === 'package.json' ? '{}' : 'test fixture');
  }
  const framework = join(app, 'release/old/mac-arm64/Rox.app/Contents/Frameworks/Mantle.framework');
  symlinkSync('A', join(framework, 'Versions/Current'));
  symlinkSync('Versions/Current/Resources', join(framework, 'Resources'));
  const output = join(app, 'release/new-candidate');
  const config = await getConfig(app, join(repo, 'apps/electron/electron-builder.yml'), { directories: { output } });
  const info = {
    config, projectDir: app, buildResourcesDir: 'resources', isPrepackedAppAsar: false,
    debugLogger: { isEnabled: false },
  };
  const macroExpander = (value: string) => expandMacro(value, arch,
    { productName: 'Rox', sanitizedProductName: 'Rox' }, { os: target });
  const matchers = getMainFileMatchers(app, join(output, 'Resources/app'),
    macroExpander, config[target],
    { info, config }, output, false);
  const extraResources = getFileMatchers(config, 'extraResources', join(output, 'Resources'), {
    macroExpander, customBuildOptions: config[target], globalOutDir: output, defaultSrc: app,
  });
  return {
    includes: (file: string) => matchers.some((matcher: { createFilter(): (path: string, stat: unknown) => boolean }) =>
      matcher.createFilter()(join(app, file), lstatSync(join(app, file)))),
    extraResources, app, output,
  };
}

describe('electron-builder target application file selection', () => {
  for (const [target, arch, binary] of [
    ['mac', 'arm64', 'darwin-arm64'], ['mac', 'x64', 'darwin-x64'],
    ['win', 'x64', 'win32-x64'], ['linux', 'x64', 'linux-x64'],
  ]) {
  it(`${target}/${arch}: excludes source, scripts, private config and old packaged framework symlinks`, async () => {
    const filter = await packagingFilter(target!, arch!);
    for (const file of ['src/main/index.ts', 'scripts/afterPack.cjs', '.env',
      'release/old/mac-arm64/Rox.app/Contents/Frameworks/Mantle.framework/Resources']) {
      expect(filter.includes(file)).toBe(false);
    }
  });

  it(`${target}/${arch}: includes built application and target runtime resources only`, async () => {
    const filter = await packagingFilter(target!, arch!);
    for (const file of ['package.json', 'dist/main.cjs', 'dist/renderer/index.html',
      'resources/pi-agent-server/index.js', 'resources/cloud-runner/index.js',
      'resources/scripts/pdf-tool.py']) {
      expect(filter.includes(file)).toBe(true);
    }
    for (const candidate of binaryTargets) {
      for (const prefix of ['resources', 'dist/resources']) {
        expect(filter.includes(`${prefix}/bin/${candidate}/uv`)).toBe(target !== 'win' && candidate === binary);
      }
    }
    expect(filter.includes('vendor/bun/bun')).toBe(target !== 'win');
  });
  }

  it('preserves Windows executable extraResources source and destination', async () => {
    const { extraResources, app, output } = await packagingFilter('win', 'x64');
    const bun = extraResources.find((matcher: { from: string }) => matcher.from === join(app, 'vendor/bun/bun.exe'));
    expect(bun?.to).toBe(join(output, 'Resources/vendor/bun/bun.exe'));
    const uv = extraResources.find((matcher: { from: string }) => matcher.from === join(app, 'resources/bin/win32-x64'));
    expect(uv?.to).toBe(join(output, 'Resources/app/resources/bin/win32-x64'));
  });
});
