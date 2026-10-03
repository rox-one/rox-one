import { describe, expect, it } from 'bun:test';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { MANIFEST_DATA } from '../../../packages/shared/src/toolchain/manifest-data';
import { stageWindowsDependencies, verifyDependencyPayload, windowsDependencyManifest } from '../../stage-windows-dependencies';
import { BUN_VERSION, UV_VERSION } from '../common';

describe('Windows offline installer payload', () => {
  it('uses native Windows artifact pins without installing from the build host', () => {
    const manifest = windowsDependencyManifest();
    expect(manifest.tools.map((t) => t.name)).toEqual(['gh', 'git', 'node', 'jq', 'yq']);
    for (const tool of manifest.tools) {
      expect(tool.sha256).toBe(MANIFEST_DATA[tool.name]!.artifacts['win32-x64']!.sha256);
      expect(tool.version).toBe(MANIFEST_DATA[tool.name]!.version);
      expect(tool.binPaths[0]).toMatch(/\.exe$/);
    }
    expect(BUN_VERSION).toBe(`bun-v${MANIFEST_DATA.bun!.version}`);
    expect(UV_VERSION).toBe(MANIFEST_DATA.uv!.version);
    expect(manifest.optionalGitBash.archive).toBe('7z-sfx');
    expect(manifest.optionalGitBash.binPaths).toContain('usr/bin/msys-2.0.dll');
    expect(manifest.optionalGitBash.sha256).toBe('ab00566336b5472120f9a52d34f2e79c5406535792acb0548001ffd0bd090e5d');
    expect(manifest.optionalGitBash.size).toBe(58919776);
  });

  it('verifies both size and digest', () => {
    const bytes = Buffer.from('fixture');
    const artifact = { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    expect(() => verifyDependencyPayload(bytes, artifact)).not.toThrow();
    expect(() => verifyDependencyPayload(Buffer.from('corrupt'), artifact)).toThrow('mismatch');
    expect(() => verifyDependencyPayload(bytes, { ...artifact, size: bytes.length + 1 })).toThrow('mismatch');
  });

  it('fails packaging on a corrupted release download before publishing a manifest', async () => {
    const out = mkdtempSync(join(tmpdir(), 'rox-payload-test-'));
    try {
      const fakeFetch = (async () => new Response('corrupt')) as typeof fetch;
      await expect(stageWindowsDependencies(out, fakeFetch)).rejects.toThrow('mismatch');
      expect(existsSync(join(out, 'manifest.json'))).toBe(false);
    } finally { rmSync(out, { recursive: true, force: true }); }
  });

  it('keeps bootstrap resources Windows-only and WSL opt-in', () => {
    const config = readFileSync(join(import.meta.dir, '../../../apps/electron/electron-builder.yml'), 'utf8');
    const windows = config.split('\nwin:')[1]!.split('\nnsis:')[0]!;
    const mac = config.split('\nmac:')[1]!.split('\ndmg:')[0]!;
    expect(windows).toContain('from: build/windows-dependencies');
    expect(windows).toContain('from: build/windows');
    expect(mac).not.toContain('from: build/windows');
    expect(config).toContain('beforePack: build/beforePack.cjs');
    expect(config).toContain('oneClick: false');
    expect(config).toContain('runAfterFinish: false');
    const installer = readFileSync(join(import.meta.dir, '../../../apps/electron/build/windows/installer.nsh'), 'utf8');
    expect(installer).toContain('StrCpy $RoxLinuxSupport ${BST_UNCHECKED}');
    expect(installer).toContain('/DEPENDENCIES=');
    expect(installer).toContain('/GITBASH');
    expect(installer).toContain('-InstallGitBash');
    expect(installer).toContain('Sysnative');
    expect(installer).not.toMatch(/\bReboot\b/);
    const worker = readFileSync(join(import.meta.dir, '../../../apps/electron/build/windows/enable-wsl.ps1'), 'utf8');
    expect(worker).toContain('/NoRestart');
    expect(worker).toContain('--no-distribution');
  });
});
