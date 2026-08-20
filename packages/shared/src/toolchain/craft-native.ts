/**
 * Local seed of craft-native into the toolchain layout.
 *
 * GitHub release artifacts are not published yet. Copy a cargo/env binary
 * into toolchain/craft-native/<version>/bin without extraResources packaging.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { installTool } from './installer';
import type { ToolchainPaths } from './types';

export const CRAFT_NATIVE_VERSION = '0.1.0';

export function craftNativeBinName(platform = process.platform): string {
  return platform === 'win32' ? 'craft-native.exe' : 'craft-native';
}

export function craftNativeToolchainBin(paths: ToolchainPaths, platform = process.platform): string {
  return path.join(
    paths.toolchainDir,
    'craft-native',
    'current',
    'bin',
    craftNativeBinName(platform),
  );
}

/**
 * Copy `source` into toolchain/craft-native/current/bin. Does not delete `source`
 * (installTool removes the staging copy only).
 */
export async function seedCraftNativeFromPath(
  paths: ToolchainPaths,
  source: string,
): Promise<string> {
  if (!fs.existsSync(source)) {
    throw new Error(`craft-native binary not found: ${source}`);
  }
  await fs.promises.mkdir(paths.downloadsDir, { recursive: true });
  const staging = path.join(
    paths.downloadsDir,
    `craft-native-seed-${process.pid}-${Date.now()}`,
  );
  await fs.promises.copyFile(source, staging);
  await installTool(paths, 'craft-native', CRAFT_NATIVE_VERSION, staging, {
    url: 'file://local',
    sha256: 'local',
    size: 1,
    archive: 'raw',
    binPaths: ['bin/craft-native'],
  });
  return craftNativeToolchainBin(paths);
}
