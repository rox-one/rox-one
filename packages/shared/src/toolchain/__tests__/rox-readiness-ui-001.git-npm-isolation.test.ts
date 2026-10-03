import { afterEach, describe, expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCommand } from '../exec';
import { installGitNpmPinned } from '../installer';
import { TOOLCHAIN_INSTALL_COMPLETE_MARKER } from '../types';

const COMMIT = 'a'.repeat(40);
const fixtures: string[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

function makeFixture() {
  const base = mkdtempSync(join(tmpdir(), 'rox-ui001-gitnpm-isolation-'));
  fixtures.push(base);
  const hostDir = join(base, 'unrelated-project');
  const workDir = join(base, 'checkout');
  const versionDir = join(hostDir, 'profile', 'toolchain', 'gbrain', 'pinned');
  const globalDir = join(versionDir, 'install', 'global');
  const sourceDir = join(versionDir, 'source');
  const hostPackage = '{"name":"unrelated-host-project","private":true,"workspaces":["apps/*","packages/*"]}\n';
  const hostLock = '{"host-lock-witness":"must remain byte identical"}\n';
  mkdirSync(hostDir);
  writeFileSync(join(hostDir, 'package.json'), hostPackage);
  writeFileSync(join(hostDir, 'bun.lock'), hostLock);
  return { base, hostDir, workDir, versionDir, globalDir, sourceDir, hostPackage, hostLock };
}

function writeCheckout(workDir: string) {
  mkdirSync(join(workDir, '.git'), { recursive: true });
  writeFileSync(join(workDir, '.git', 'HEAD'), `${COMMIT}\n`);
  writeFileSync(join(workDir, 'package.json'), '{"name":"rox-ui001-local-cli","version":"1.0.0"}\n');
  writeFileSync(join(workDir, 'bun.lock'), 'fixture lock\n');
}

async function replayCli(bun: string, cli: string, witness: string, cwd: string, env: NodeJS.ProcessEnv): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(bun, [cli, witness], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    let stderr = '';
    child.stdout.resume();
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`installed CLI exited ${code}: ${stderr}`));
    });
  });
  // Bun's test runner can suppress console output from a nested Bun process.
  // The file is written by the CLI after importing its pinned dependency,
  // so it proves execution even in that capture mode.
  return readFileSync(witness, 'utf8');
}

describe('UI-001 managed git-npm install isolation', () => {
  it('executes the global install in its own manifest with explicit managed directories', async () => {
    const fixture = makeFixture();
    const calls: { args: string[]; cwd?: string; env?: NodeJS.ProcessEnv }[] = [];
    await installGitNpmPinned({
      bun: '/qualified/bun', repo: 'fixture/local', commit: COMMIT,
      versionDir: fixture.versionDir, workDir: fixture.workDir,
      runCmd: async (args, options) => {
        calls.push({ args, ...options });
        if (args.includes('checkout')) writeCheckout(fixture.workDir);
        if (args.includes('--global')) {
          expect(options?.cwd).toBe(fixture.globalDir);
          expect(JSON.parse(readFileSync(join(fixture.globalDir, 'package.json'), 'utf8')).private).toBe(true);
          expect(options?.env?.BUN_INSTALL).toBe(fixture.versionDir);
          expect(options?.env?.BUN_INSTALL_GLOBAL_DIR).toBe(fixture.globalDir);
          expect(options?.env?.BUN_INSTALL_BIN).toBe(join(fixture.versionDir, 'bin'));
          expect(options?.env?.CRAFT_BUN_PATH).toBe('/qualified/bun');
          expect(existsSync(join(fixture.versionDir, TOOLCHAIN_INSTALL_COMPLETE_MARKER))).toBe(false);
        }
      },
    });
    expect(calls.filter((call) => call.args[0] === '/qualified/bun').map((call) => call.args)).toEqual([
      ['/qualified/bun', 'install', '--frozen-lockfile'],
      ['/qualified/bun', 'install', '--global', fixture.sourceDir],
    ]);
    expect(calls[4]?.cwd).toBe(fixture.workDir);
    expect(readFileSync(join(fixture.hostDir, 'package.json'), 'utf8')).toBe(fixture.hostPackage);
    expect(readFileSync(join(fixture.hostDir, 'bun.lock'), 'utf8')).toBe(fixture.hostLock);
    expect(existsSync(fixture.workDir)).toBe(false);
    expect(JSON.parse(readFileSync(join(fixture.versionDir, TOOLCHAIN_INSTALL_COMPLETE_MARKER), 'utf8'))).toEqual({
      format: 'git-npm-local-source-v1', repo: 'fixture/local', commit: COMMIT,
    });
  });

  it('real Bun installs a local pinned CLI without changing its ancestor package or lock', async () => {
    const fixture = makeFixture();
    const bun = process.execPath;
    const cacheDir = join(fixture.base, 'bun-cache');
    const transitiveDir = join(fixture.base, 'local-pinned-dependency');
    const cliSource = '#!/usr/bin/env bun\nimport { marker } from "rox-ui001-pinned-dependency";\n'
      + 'import { writeFileSync } from "node:fs"; writeFileSync(process.argv[2], marker); console.log(marker);\n';
    mkdirSync(transitiveDir);
    writeFileSync(join(transitiveDir, 'package.json'), JSON.stringify({
      name: 'rox-ui001-pinned-dependency', version: '1.0.0', type: 'module', exports: './index.js',
    }));
    writeFileSync(join(transitiveDir, 'index.js'), 'export const marker = "pinned-local-runtime";\n');
    const calls: { args: string[]; cwd?: string }[] = [];
    const isolatedEnv = { ...process.env, BUN_INSTALL_CACHE_DIR: cacheDir };
    await installGitNpmPinned({
      bun, repo: 'fixture/local', commit: COMMIT,
      versionDir: fixture.versionDir, workDir: fixture.workDir,
      runCmd: async (args, options) => {
        calls.push({ args, cwd: options?.cwd });
        if (args[0] === 'git') {
          if (args.includes('checkout')) {
            writeCheckout(fixture.workDir);
            rmSync(join(fixture.workDir, 'bun.lock'));
            writeFileSync(join(fixture.workDir, 'package.json'), JSON.stringify({
              name: 'rox-ui001-local-cli', version: '1.0.0', type: 'module',
              bin: { 'rox-ui001-local-cli': './cli.js' },
              dependencies: { 'rox-ui001-pinned-dependency': `file:${transitiveDir}` },
            }));
            writeFileSync(join(fixture.workDir, 'cli.js'), cliSource);
            // The fixture lock is produced by the same real Bun, using only a local dependency.
            await runCommand([bun, 'install', '--lockfile-only'], {
              cwd: fixture.workDir, env: isolatedEnv,
            });
          }
          return;
        }
        if (args.includes('--global')) {
          // A later local resolution must not replace the materialized frozen runtime dependency.
          writeFileSync(join(transitiveDir, 'index.js'), 'export const marker = "unfrozen-later-change";\n');
        }
        // Model the Electron host cwd when production supplies no cwd; never use the real repository.
        await runCommand(args, {
          cwd: options?.cwd ?? fixture.hostDir,
          env: { ...options?.env, BUN_INSTALL_CACHE_DIR: cacheDir },
        });
      },
    });
    expect(readFileSync(join(fixture.hostDir, 'package.json'), 'utf8')).toBe(fixture.hostPackage);
    expect(readFileSync(join(fixture.hostDir, 'bun.lock'), 'utf8')).toBe(fixture.hostLock);
    expect(existsSync(join(fixture.hostDir, 'node_modules'))).toBe(false);
    expect(calls.find((call) => call.args.includes('--global'))?.cwd).toBe(fixture.globalDir);
    expect(existsSync(fixture.workDir)).toBe(false);
    expect(readFileSync(join(fixture.sourceDir, '.git', 'HEAD'), 'utf8').trim()).toBe(COMMIT);
    // Remove the other fixture source too: the installed runtime must use its materialized dependencies.
    rmSync(transitiveDir, { recursive: true, force: true });
    const installedCli = join(fixture.globalDir, 'node_modules', 'rox-ui001-local-cli', 'cli.js');
    expect(existsSync(installedCli)).toBe(true);
    expect(readFileSync(join(fixture.sourceDir, 'cli.js'), 'utf8')).toBe(cliSource);
    expect(readFileSync(installedCli, 'utf8')).toBe(cliSource);
    expect(existsSync(join(fixture.versionDir, 'bin', 'rox-ui001-local-cli'))).toBe(true);
    expect(await replayCli(bun, installedCli, join(fixture.base, 'first-replay.txt'),
      fixture.globalDir, isolatedEnv)).toBe('pinned-local-runtime');
    expect(await replayCli(bun, join(fixture.versionDir, 'bin', 'rox-ui001-local-cli'),
      join(fixture.base, 'fresh-launcher-replay.txt'), fixture.hostDir, isolatedEnv)).toBe('pinned-local-runtime');
  }, 30_000);

  it('retains the managed manifest and cleans the checkout when global installation fails', async () => {
    const fixture = makeFixture();
    mkdirSync(fixture.globalDir, { recursive: true });
    const existingManifest = '{"private":true,"dependencies":{"already-installed":"1.0.0"}}\n';
    writeFileSync(join(fixture.globalDir, 'package.json'), existingManifest);
    writeFileSync(join(fixture.versionDir, TOOLCHAIN_INSTALL_COMPLETE_MARKER), 'old completed receipt\n');
    await expect(installGitNpmPinned({
      bun: '/qualified/bun', repo: 'fixture/local', commit: COMMIT,
      versionDir: fixture.versionDir, workDir: fixture.workDir,
      runCmd: async (args, options) => {
        if (args.includes('checkout')) writeCheckout(fixture.workDir);
        if (args.includes('--global')) {
          expect(options?.cwd).toBe(fixture.globalDir);
          throw new Error('fixture global install failed');
        }
      },
    })).rejects.toThrow('fixture global install failed');
    expect(readFileSync(join(fixture.globalDir, 'package.json'), 'utf8')).toBe(existingManifest);
    expect(existsSync(fixture.workDir)).toBe(false);
    expect(existsSync(join(fixture.versionDir, TOOLCHAIN_INSTALL_COMPLETE_MARKER))).toBe(false);
    expect(readFileSync(join(fixture.hostDir, 'package.json'), 'utf8')).toBe(fixture.hostPackage);
    expect(readFileSync(join(fixture.hostDir, 'bun.lock'), 'utf8')).toBe(fixture.hostLock);
  });
});
