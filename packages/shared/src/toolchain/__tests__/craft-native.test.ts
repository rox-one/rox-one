import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { MANIFEST_DATA, TOOL_PLATFORM_MATRIX } from '../manifest-data';
import { TOOLCHAIN_MANIFEST, toolchainPaths } from '../manifest';
import { createResolver } from '../resolver';
import { ALL_TOOL_NAMES, isToolName } from '../types';

const isWindows = process.platform === 'win32';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-craft-native-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('craft-native toolchain registration', () => {
  it('is an opt-in ToolName and is not a Windows native', () => {
    expect(isToolName('craft-native')).toBe(true);
    expect(ALL_TOOL_NAMES).toContain('craft-native');
    expect(TOOL_PLATFORM_MATRIX['craft-native']).toEqual([
      'darwin-arm64',
      'darwin-x64',
      'linux-x64',
    ]);
  });

  it('ships as opt-in detect with unix bin layout and no extraResources archive url', () => {
    const entry = TOOLCHAIN_MANIFEST.find((item) => item.name === 'craft-native');
    expect(entry).toBeDefined();
    expect(entry?.tier).toBe('opt-in');
    expect(entry?.kind).toBe('detect');
    expect(entry?.systemBinary).toBe('craft-native');
    expect(entry?.version).toBe('0.1.0');
    expect(entry?.platforms).toEqual(['darwin-arm64', 'darwin-x64', 'linux-x64']);
    expect(entry?.artifacts['win32-x64']).toBeUndefined();
    expect(MANIFEST_DATA['craft-native']?.displayName).toContain('craft-native');
    for (const platform of ['darwin-arm64', 'darwin-x64', 'linux-x64'] as const) {
      expect(entry?.artifacts[platform]?.binPaths).toEqual(['bin/craft-native']);
      expect(entry?.artifacts[platform]?.archive).toBe('local');
    }
  });

  it('is not listed in electron extraResources', () => {
    const yml = fs.readFileSync(
      path.join(import.meta.dir, '../../../../../apps/electron/electron-builder.yml'),
      'utf8',
    );
    expect(yml.includes('craft-native')).toBe(false);
  });
});

describe('seedCraftNativeFromPath', () => {
  it('copies a local binary into toolchain current/bin without deleting the source', async () => {
    if (isWindows) return;
    const paths = toolchainPaths(path.join(tmpDir, 'seed-cfg'));
    const source = path.join(tmpDir, 'built-craft-native');
    fs.writeFileSync(source, '#!/bin/sh\necho seeded\n');
    fs.chmodSync(source, 0o755);

    const { seedCraftNativeFromPath } = await import('../craft-native');
    const seeded = await seedCraftNativeFromPath(paths, source);
    expect(fs.existsSync(source)).toBe(true);
    expect(seeded).toBe(
      path.join(paths.toolchainDir, 'craft-native', 'current', 'bin', 'craft-native'),
    );
    expect(fs.readFileSync(seeded, 'utf8')).toContain('seeded');
    expect(fs.statSync(seeded).mode & 0o111).not.toBe(0);

    const resolver = createResolver(paths, { pathEnv: path.join(tmpDir, 'empty-path') });
    expect(await resolver.findExecutable('craft-native')).toBe(seeded);
  });
});
