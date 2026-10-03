import { describe, expect, it } from 'bun:test';
import * as path from 'node:path';

import { getGitLock } from '../git-locks';
import { MANIFEST_DATA, TOOL_PLATFORM_MATRIX } from '../manifest-data';
import { currentPlatform, loadManifest, TOOLCHAIN_MANIFEST, toolchainPaths } from '../manifest';
import { OPENCLAW_NPM_PIN, getNpmLock } from '../npm-locks';
import { getPipRequirements } from '../pip-locks';
import type { ToolName } from '../types';

const HEX_64 = /^[0-9a-f]{64}$/;

describe('manifest validation', () => {
  it('Rox CLI uses an exact upstream version with an integrity-locked dependency graph', () => {
    const omp = MANIFEST_DATA.omp!;
    expect(omp.displayName).toBe('Rox CLI');
    const lock = JSON.parse(getNpmLock('omp', omp.version)!);
    expect(lock.packages[''].version).toBe(omp.version);
    expect(lock.packages[''].name).toBe('@oh-my-pi/pi-coding-agent');
    for (const [packagePath, record] of Object.entries(lock.packages)) {
      if (!packagePath) continue;
      const pkg = record as { resolved: string; integrity: string };
      expect(pkg.resolved).toStartWith('https://registry.npmjs.org/');
      expect(pkg.integrity).toStartWith('sha512-');
    }
    for (const [platform, artifact] of Object.entries(omp.artifacts)) {
      expect(artifact!.url).toEndWith(`pi-coding-agent-${omp.version}.tgz`);
      expect(artifact!.binPaths).toEqual(platform === 'win32-x64'
        ? ['bin/rox.cmd', 'bin/omp.cmd'] : ['bin/rox', 'bin/omp']);
    }
  });

  it('каждый артефакт имеет непустые url/sha256/size/binPaths', () => {
    expect(TOOLCHAIN_MANIFEST.length).toBeGreaterThan(0);
    for (const entry of TOOLCHAIN_MANIFEST) {
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.displayName.length).toBeGreaterThan(0);
      for (const [platform, artifact] of Object.entries(entry.artifacts)) {
        expect(platform).toMatch(/^(darwin-arm64|darwin-x64|linux-x64|win32-x64)$/);
        expect(artifact).toBeDefined();
        if (!artifact) continue;
        // uv-python артефакты ставятся вендорным `uv python install` — прямой
        // загрузки нет, url/sha256/size не применяются (контракт manifest-data).
        if (artifact.archive === 'uv-python' || artifact.archive === 'local') {
          expect(artifact.binPaths.length).toBeGreaterThan(0);
          continue;
        }
        expect(artifact.url.length).toBeGreaterThan(0);
        expect(artifact.url).toMatch(/^https:\/\//);
        expect(artifact.sha256).toMatch(HEX_64);
        expect(artifact.size).toBeGreaterThan(0);
        expect(artifact.binPaths.length).toBeGreaterThan(0);
        for (const binPath of artifact.binPaths) {
          expect(binPath.length).toBeGreaterThan(0);
          expect(binPath.startsWith('/')).toBe(false);
        }
      }
    }
  });

  it('git публикуется только под win32-x64 согласно матрице', () => {
    expect(TOOL_PLATFORM_MATRIX.git).toEqual(['win32-x64']);
  });

  it('каждый ToolName из TOOL_PLATFORM_MATRIX имеет запись в MANIFEST_DATA; npm/git-npm/pip — pinned lock', () => {
    // Регрессия (MAJOR): gbrain был в ToolName union, TOOL_PLATFORM_MATRIX и
    // git-locks.ts, но ЗАПИСИ В MANIFEST_DATA не было — buildManifest молча его
    // не собирал, и инструмент был недостижим ни в ensureAll, ни в status/update.
    // Документированные «особые» записи ТОЖЕ обязаны присутствовать в манифесте:
    // git (на darwin/linux — системный бинарник, артефакт только под win32-x64)
    // и python (artifacts-заглушки uv-managed, ставится `uv python install`).
    // Матрица типизирована Record<ToolName, ...> — её ключи исчерпывают union.
    const matrixNames = Object.keys(TOOL_PLATFORM_MATRIX) as ToolName[];
    expect(matrixNames.length).toBeGreaterThan(0);

    const missingInManifest = matrixNames.filter((name) => !MANIFEST_DATA[name]);
    expect(missingInManifest).toEqual([]);

    // kind npm: установка fail-closed по npm-locks.ts — lock обязан существовать.
    const npmWithoutLock = matrixNames.filter((name) => {
      const data = MANIFEST_DATA[name];
      return data && (data.kind ?? 'binary') === 'npm' && getNpmLock(name, data.version) === null;
    });
    expect(npmWithoutLock).toEqual([]);

    // kind git-npm: установка fail-closed по git-locks.ts — lock обязан существовать.
    const gitNpmWithoutLock = matrixNames.filter((name) => {
      const data = MANIFEST_DATA[name];
      return data && data.kind === 'git-npm' && getGitLock(name, data.version) === undefined;
    });
    expect(gitNpmWithoutLock).toEqual([]);

    // kind pip: установка fail-closed по pip-locks.ts — requirements lock обязан существовать.
    const pipWithoutLock = matrixNames.filter((name) => {
      const data = MANIFEST_DATA[name];
      return data && data.kind === 'pip' && getPipRequirements(name, data.version) === null;
    });
    expect(pipWithoutLock).toEqual([]);
  });

  it('OpenClaw is an opt-in exact npm pin with a complete integrity-locked dependency graph', () => {
    const openclaw = MANIFEST_DATA.openclaw;
    expect(openclaw).toMatchObject({
      version: '2026.7.1-2',
      kind: 'npm',
      tier: 'opt-in',
      dependsOn: ['node'],
    });
    expect(OPENCLAW_NPM_PIN).toEqual({
      packageName: 'openclaw',
      version: '2026.7.1-2',
      tarballUrl: 'https://registry.npmjs.org/openclaw/-/openclaw-2026.7.1-2.tgz',
      tarballSha256: '5bb525f36f471a41239615d321c441778c7e1c007018ed6d84b795be77803276',
      tarballIntegrity: 'sha512-ycF3yPcbjN6bUPeaUx6Mh6vze1hQWoD3CT/wWcmD7a8xaHHHRUaAlaq+lFxMHf1ssEgODVAwjlzYqp2twkYZ7g==',
      requiredNodeRange: '>=22.22.3 <23 || >=24.15.0 <25 || >=25.9.0',
      entrypoint: 'openclaw.mjs',
    });
    expect(MANIFEST_DATA.node?.version).toBe('22.23.2');
    expect(TOOL_PLATFORM_MATRIX.openclaw).toEqual([
      'darwin-arm64',
      'darwin-x64',
      'linux-x64',
      'win32-x64',
    ]);

    for (const artifact of Object.values(openclaw?.artifacts ?? {})) {
      expect(artifact?.url).toBe(OPENCLAW_NPM_PIN.tarballUrl);
      expect(artifact?.sha256).toBe(OPENCLAW_NPM_PIN.tarballSha256);
      expect(artifact?.size).toBe(19728152);
    }

    const lock = getNpmLock('openclaw', '2026.7.1-2');
    expect(lock).not.toBeNull();
    const parsed = JSON.parse(lock ?? '{}');
    expect(parsed.lockfileVersion).toBe(3);
    expect(parsed.packages?.['']?.name).toBe('openclaw');
    expect(parsed.packages?.['']?.version).toBe('2026.7.1-2');
    expect(Object.entries(parsed.packages ?? {}).every(([packagePath, pkg]) => {
      if (packagePath === '') return true;
      const record = pkg as { resolved?: unknown; integrity?: unknown; link?: unknown };
      return record.link === true || (
        typeof record.resolved === 'string' &&
        record.resolved.startsWith('https://registry.npmjs.org/') &&
        typeof record.integrity === 'string'
      );
    })).toBe(true);
  });

  it('gbrain виден ensureAll как default-on git-npm инструмент (регрессия MAJOR)', () => {
    // ensureAll перебирает TOOLCHAIN_MANIFEST (собран из MANIFEST_DATA + матрицы):
    // tier default-on без disabled-пометки => gbrain ОБЯЗАН попадать в план установки.
    const gbrain = TOOLCHAIN_MANIFEST.find((e) => e.name === 'gbrain');
    expect(gbrain).toBeDefined();
    expect(gbrain?.kind).toBe('git-npm');
    expect(gbrain?.tier).toBe('default-on');
    expect(gbrain?.version).toBe('15b9863d1363');
    expect(gbrain?.dependsOn).toEqual(['bun', 'git']);
    // Платформенная матрица покрывает текущую платформу — иначе ensureAll пропустил бы его.
    expect(gbrain?.platforms).toContain(currentPlatform());
  });

  it('loadManifest возвращает собранный манифест (jq присутствует)', () => {
    const manifest = loadManifest();
    expect(manifest).toBe(TOOLCHAIN_MANIFEST);
    const jq = manifest.find((e) => e.name === 'jq');
    expect(jq).toBeDefined();
    expect(MANIFEST_DATA.jq?.version).toBe(jq?.version);
  });

  it('toolchainPaths собирает пути от config-dir', () => {
    const paths = toolchainPaths('/tmp/craft-test');
    expect(paths.toolchainDir).toBe(path.join('/tmp/craft-test', 'toolchain'));
    expect(paths.downloadsDir).toBe(path.join('/tmp/craft-test', 'downloads'));
    expect(paths.stateFile).toBe(path.join('/tmp/craft-test', 'toolchain', 'state.json'));
  });

  it('Windows uv zip exposes root-level uv and uvx, and Node exposes npm', () => {
    expect(MANIFEST_DATA.uv?.artifacts['win32-x64']?.binPaths).toEqual(['uv.exe', 'uvx.exe']);
    expect(MANIFEST_DATA.node?.artifacts['win32-x64']?.binPaths).toContain('node-v22.23.2-win-x64/npm.cmd');
  });

  it('pins the verified Windows FFmpeg release without treating media as critical runtime', () => {
    expect(MANIFEST_DATA.ffmpeg?.critical).not.toBe(true);
    expect(MANIFEST_DATA.ffmpeg?.artifacts['win32-x64']).toEqual({
      url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-09-30-13-08/ffmpeg-n9.0.2-17-g2a571b6068-win64-lgpl-9.0.zip',
      sha256: '6b264b9e6019103f601d98c292bd332fd87acf1c5e941ddff4fb71760fe63432',
      size: 171535354,
      archive: 'zip',
      binPaths: ['ffmpeg-n9.0.2-17-g2a571b6068-win64-lgpl-9.0/bin/ffmpeg.exe'],
    });
    expect(MANIFEST_DATA.ffmpeg?.artifacts['linux-x64']?.sha256)
      .toBe('97d4b95d33da6f0d3102e252eaa7a4778a673ebf2434a0bf15f409a37e3afeb1');
    expect(MANIFEST_DATA.ffmpeg?.artifacts['darwin-arm64']?.sha256)
      .toBe('5267ef149ee0d208057a1b316aac079b661b0476574dee5da7d225769773c603');
    expect(MANIFEST_DATA.ffmpeg?.artifacts['darwin-x64']?.sha256)
      .toBe('79d14663d8b078dbbc38de18d63a30f8a5bfc860af5dfee7f8cf3e387cf1c02c');
  });

  it('currentPlatform возвращает валидную платформу манифеста', () => {
    expect(['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64']).toContain(currentPlatform());
  });
});
