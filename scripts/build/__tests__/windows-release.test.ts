import { describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { readPinnedSdkVersion, runBun } from '../windows-release';
const require = createRequire(import.meta.url);
const { ensureWindowsOemPayload, validateWindowsOemPayload } = require('../../../apps/electron/build/windows-release-preflight.cjs');

describe('Windows production payload and entrypoints', () => {
  function fixture(action: (root: string) => void) {
    const root = mkdtempSync(join(tmpdir(), 'rox-release-gate-'));
    try { action(root); } finally { rmSync(root, { recursive: true, force: true }); }
  }
  function pin(root: string) {
    mkdirSync(join(root, 'resources/oem-kernel'), { recursive: true });
    writeFileSync(join(root, 'resources/oem-kernel-pin.json'), JSON.stringify({ version: 'fixture-only', sha256: { 'win32-x64': '0'.repeat(64) } }));
  }
  function structuralPayload(dir: string) {
    // Non-executable PE HEADER fixture, never a vendor binary or shipped payload.
    mkdirSync(dir, { recursive: true });
    const header = Buffer.alloc(256); header.write('MZ'); header.writeUInt32LE(128, 60);
    header.writeUInt32LE(0x4550, 128); header.writeUInt16LE(0x8664, 132);
    writeFileSync(join(dir, 'knowledge-engine.exe'), header);
    for (const asset of ['stage', 'appearance']) {
      mkdirSync(join(dir, asset)); writeFileSync(join(dir, asset, 'fixture.txt'), 'fixture');
    }
  }
  it('rejects README-only staging and does not change it on failure', () => fixture(root => {
    pin(root); writeFileSync(join(root, 'resources/oem-kernel/README.md'), 'keeper');
    expect(() => ensureWindowsOemPayload(root, { env: {} })).toThrow('README-only');
    expect(readFileSync(join(root, 'resources/oem-kernel/README.md'), 'utf8')).toBe('keeper');
  }));
  it('rejects wrong-platform binaries and missing runtime assets', () => fixture(root => {
    structuralPayload(root);
    rmSync(join(root, 'appearance'), { recursive: true });
    expect(() => validateWindowsOemPayload(root)).toThrow('appearance/');
    writeFileSync(join(root, 'knowledge-engine.exe'), 'ELF or a README is not PE');
    expect(() => validateWindowsOemPayload(root)).toThrow('Not a Windows PE');
  }));
  it('rejects stale wrong-platform aliases that would shadow a valid Windows exe', () => fixture(root => {
    structuralPayload(root);
    writeFileSync(join(root, 'knowledge-engine'), 'stale ELF binary');
    expect(() => validateWindowsOemPayload(root)).toThrow('Not a Windows PE');
  }));
  it('validates external payloads before staging and preserves tracked keepers', () => fixture(root => {
    pin(root);
    const source = join(root, 'vendor/win32-x64'); structuralPayload(source);
    const dest = join(root, 'resources/oem-kernel');
    writeFileSync(join(dest, 'README.md'), 'keeper'); writeFileSync(join(dest, 'stale.txt'), 'old');
    const result = ensureWindowsOemPayload(root, { env: { OEM_KERNEL_PAYLOAD_DIR: join(root, 'vendor') }, stage: true });
    expect(result.mode).toBe('required-production');
    expect(existsSync(join(dest, 'stale.txt'))).toBe(false);
    expect(readFileSync(join(dest, 'README.md'), 'utf8')).toBe('keeper');
  }));
  it('requires deliberate dual development opt-in', () => fixture(root => {
    expect(() => ensureWindowsOemPayload(root, { env: { ROX_WINDOWS_DEV_WITHOUT_OEM: '1' } })).toThrow('CRAFT_DEV_RUNTIME');
    expect(ensureWindowsOemPayload(root, { env: { ROX_WINDOWS_DEV_WITHOUT_OEM: '1', CRAFT_DEV_RUNTIME: '1' } }).mode).toBe('optional-development');
  }));
  it('blocks publishing OEM-optional artifacts before invoking any staging subprocess', async () => {
    const beforePack = require('../../../apps/electron/build/beforePack.cjs');
    const previous = { dev: process.env.ROX_WINDOWS_DEV_WITHOUT_OEM, runtime: process.env.CRAFT_DEV_RUNTIME };
    try {
      process.env.ROX_WINDOWS_DEV_WITHOUT_OEM = '1'; process.env.CRAFT_DEV_RUNTIME = '1';
      const context = { electronPlatformName: 'win32', arch: 1, packager: { projectDir: '.',
        config: { extraMetadata: {} }, platformSpecificBuildOptions: {}, info: { options: { publish: 'always' } } } };
      await expect(beforePack(context)).rejects.toThrow('--publish never');
      expect(context.packager.platformSpecificBuildOptions).toEqual({ artifactName: 'Rox-development-${arch}.${ext}', signAndEditExecutable: false });
      expect(context.packager.config.extraMetadata).toEqual({ roxWindowsBuild: 'optional-development' });
    } finally {
      if (previous.dev === undefined) delete process.env.ROX_WINDOWS_DEV_WITHOUT_OEM; else process.env.ROX_WINDOWS_DEV_WITHOUT_OEM = previous.dev;
      if (previous.runtime === undefined) delete process.env.CRAFT_DEV_RUNTIME; else process.env.CRAFT_DEV_RUNTIME = previous.runtime;
    }
  });
  it('combines Windows exclusions with the normalized allowlist and protects pinned payload bytes', () => {
    const { configureWindowsFileFilters, restoreWindowsFileFilters } = require('../../../apps/electron/build/beforePack.cjs');
    const { getMainFileMatchers } = require('app-builder-lib/out/fileMatcher');
    const config = { files: [{ filter: ['dist/**/*', 'package.json', 'vendor/bun/**/*'] }], directories: { buildResources: 'resources' } };
    const platformSpecificBuildOptions = { files: ['!vendor/bun/**/*', '!**/resources/bin/win32-x64/**'] };
    const originalFiles = config.files;
    const originalPlatformFiles = platformSpecificBuildOptions.files;
    const packager = { config, platformSpecificBuildOptions, shouldSignFile: () => true };
    configureWindowsFileFilters(packager);
    const root = join(import.meta.dir, '../../../apps/electron');
    const matchers = getMainFileMatchers(root, join(root, 'fixture-out'), x => x, platformSpecificBuildOptions,
      { info: { config, projectDir: root, buildResourcesDir: 'resources', isPrepackedAppAsar: false, debugLogger: { isEnabled: false } } }, join(root, 'release'), false);
    expect(matchers).toHaveLength(1);
    const filter = matchers[0].createFilter();
    for (const excluded of ['src/main/index.ts', 'build/windows-dependencies/jq.exe', 'scripts/build-win.ps1', 'vendor/bun/bun.exe', 'dist/resources/bin/win32-x64/uv.exe']) {
      expect(filter(join(root, excluded), { isDirectory: () => false })).toBe(false);
    }
    expect(filter(join(root, 'dist/main.cjs'), { isDirectory: () => false })).toBe(true);
    expect(packager.shouldSignFile('C:\\app\\resources\\windows-dependencies\\jq.exe')).toBe(false);
    expect(packager.shouldSignFile('C:\\app\\Rox.exe')).toBe(true);
    restoreWindowsFileFilters(packager);
    expect(config.files).toBe(originalFiles);
    expect(platformSpecificBuildOptions.files).toBe(originalPlatformFiles);
  });
  it('reads SDK version from a Unicode/apostrophe path as data, not JS source', () => fixture(root => {
    const unicode = join(root, "用户 Ж O'Connor"); mkdirSync(unicode);
    writeFileSync(join(unicode, 'package.json'), JSON.stringify({ dependencies: { '@anthropic-ai/claude-agent-sdk': '0.3.258' } }));
    expect(readPinnedSdkVersion(unicode)).toBe('0.3.258');
    writeFileSync(join(unicode, 'package.json'), JSON.stringify({ dependencies: { '@anthropic-ai/claude-agent-sdk': '^0.3.258' } }));
    expect(() => readPinnedSdkVersion(unicode)).toThrow('exact pinned');
  }));
  it('passes development selection through a real Windows child-process boundary', () => fixture(root => {
    const previous = { dev: process.env.ROX_WINDOWS_DEV_WITHOUT_OEM, runtime: process.env.CRAFT_DEV_RUNTIME };
    const output = join(root, 'child-env.json');
    try {
      process.env.ROX_WINDOWS_DEV_WITHOUT_OEM = '1'; process.env.CRAFT_DEV_RUNTIME = '1';
      runBun(root, ['-e', `await Bun.write(process.argv.at(-1), JSON.stringify({ dev: process.env.ROX_WINDOWS_DEV_WITHOUT_OEM, runtime: process.env.CRAFT_DEV_RUNTIME }));`, output]);
      expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual({ dev: '1', runtime: '1' });
    } finally {
      if (previous.dev === undefined) delete process.env.ROX_WINDOWS_DEV_WITHOUT_OEM; else process.env.ROX_WINDOWS_DEV_WITHOUT_OEM = previous.dev;
      if (previous.runtime === undefined) delete process.env.CRAFT_DEV_RUNTIME; else process.env.CRAFT_DEV_RUNTIME = previous.runtime;
    }
  }));
  it('routes both Windows main entrypoints through the canonical native exclusions', () => {
    const root = join(import.meta.dir, '../../..');
    const ps = readFileSync(join(root, 'apps/electron/scripts/build-win.ps1'), 'utf8');
    expect(ps).toContain('windows-release.ts'); expect(ps).not.toContain('node -p');
    expect(ps).not.toContain('bun-v1.3.9'); expect(ps).not.toContain('Stop-Process');
    const release = readFileSync(join(root, 'scripts/build/windows-release.ts'), 'utf8');
    expect(release).toContain('await downloadBun(config)'); expect(release).toContain('await downloadUv(config)');
    expect(release).toContain('scripts/electron-build-main.ts');
    const main = readFileSync(join(root, 'scripts/electron-build-main.ts'), 'utf8');
    for (const external of ['onnxruntime-node', '@xenova/transformers', 'sharp']) expect(main).toContain(`--external:${external}`);
  });
  it('keeps the launcher registry GUID aligned with electron-builder app identity', () => {
    const root = join(import.meta.dir, '../../..');
    const { load } = require('js-yaml');
    const { UUID } = require('builder-util-runtime');
    const config = load(readFileSync(join(root, 'apps/electron/electron-builder.yml'), 'utf8'));
    const guid = config.nsis.guid ?? UUID.v5(config.appId, UUID.parse('50e065bc-3134-11e6-9bab-38c9862bdaf3'));
    expect(config.nsis.guid).toBe('61dc82ee-e3b9-557b-98c4-20b9178a0f78');
    expect(readFileSync(join(root, 'scripts/install-app.ps1'), 'utf8')).toContain(`$guid = '${guid}'`);
  });
});
