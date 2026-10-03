/** Canonical native Windows release entrypoint. No global process killing, Bash, or WSL. */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { copyCloudRunner, copyInterceptor, copyPiAgentServer, copyRipgrep, copySDK, downloadBun, downloadUv,
  buildMcpServers, verifySDKCopy, type BuildConfig } from './common';

const require = createRequire(import.meta.url);
const { ensureWindowsOemPayload } = require('../../apps/electron/build/windows-release-preflight.cjs');

export function readPinnedSdkVersion(rootDir: string): string {
  const version = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8')).dependencies['@anthropic-ai/claude-agent-sdk'];
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('SDK cross-fetch requires an exact pinned semver');
  return version;
}

async function ensureSdkBinary(config: BuildConfig): Promise<void> {
  const name = 'claude-agent-sdk-win32-x64';
  const destination = join(config.rootDir, 'node_modules/@anthropic-ai', name);
  if (existsSync(join(destination, 'claude.exe'))) return;
  const version = readPinnedSdkVersion(config.rootDir);
  const work = mkdtempSync(join(tmpdir(), 'rox-sdk-fetch-'));
  try {
    const pack = Bun.spawnSync(['npm', 'pack', `@anthropic-ai/${name}@${version}`, '--ignore-scripts', '--json'], { cwd: work, stdout: 'pipe', stderr: 'pipe' });
    if (pack.exitCode !== 0) throw new Error(`SDK cross-fetch failed: ${pack.stderr.toString()}`);
    const filename = JSON.parse(pack.stdout.toString())[0].filename;
    if (!/^[\w.-]+\.tgz$/.test(filename)) throw new Error('Invalid npm pack filename');
    execFileSync('tar.exe', ['-xzf', join(work, filename), '-C', work], { stdio: 'inherit' });
    const source = join(work, 'package');
    const metadata = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
    if (metadata.version !== version || !existsSync(join(source, 'claude.exe'))) throw new Error('SDK fetched package does not match pin/target');
    mkdirSync(destination, { recursive: true });
    cpSync(source, destination, { recursive: true });
  } finally { rmSync(work, { recursive: true, force: true }); }
}

export async function prepareWindowsRuntime(config: BuildConfig): Promise<void> {
  await downloadBun(config);
  await downloadUv(config);
  await ensureSdkBinary(config);
  copySDK(config);
  verifySDKCopy(config);
  copyRipgrep(config);
  copyInterceptor(config);
}

export function runBun(rootDir: string, args: string[]): void {
  // Bun on Windows otherwise inherits the original OS environment, losing
  // process.env mutations such as the explicit development-build selection.
  execFileSync(process.execPath, args, { cwd: rootDir, env: { ...process.env }, stdio: 'inherit', windowsHide: true });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const value = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
  const rootDir = resolve(import.meta.dir, '../..');
  const electronDir = resolve(value('--project-dir') || join(rootDir, 'apps/electron'));
  const config: BuildConfig = { rootDir, electronDir, platform: 'win32', arch: 'x64', upload: false, uploadLatest: false, uploadScript: false };
  if (process.platform !== 'win32') throw new Error('This release entrypoint requires native Windows');
  if (args.includes('--main-only')) {
    // A compile/syntax check only, not a release or a vendor-payload bypass.
    const out = value('--outdir');
    if (!out) throw new Error('--main-only requires --outdir for bounded, isolated validation');
    runBun(rootDir, ['run', 'scripts/electron-build-main.ts', '--main-only', '--no-env', '--outdir', resolve(out)]);
    return;
  }
  if (args.includes('--development-without-oem')) {
    process.env.ROX_WINDOWS_DEV_WITHOUT_OEM = '1';
    process.env.CRAFT_DEV_RUNTIME = '1';
  }
  const oem = ensureWindowsOemPayload(electronDir, { stage: !args.includes('--check-only') });
  console.log(`Windows release payload: ${oem.mode}`);
  if (args.includes('--check-only')) return;
  if (!args.includes('--prepare-only') && !args.includes('--skip-install')) runBun(rootDir, ['install', '--frozen-lockfile']);
  await prepareWindowsRuntime(config);
  if (args.includes('--prepare-only')) return;
  buildMcpServers(config);
  copyPiAgentServer(config);
  copyCloudRunner(config);
  runBun(rootDir, ['run', 'electron:build']);
  runBun(electronDir, ['run', 'electron-builder', '--config', 'electron-builder.yml', '--win', '--x64', '--publish', 'never']);
  const artifact = join(electronDir, 'release', oem.mode === 'optional-development' ? 'Rox-development-x64.exe' : 'Rox-x64.exe');
  if (!existsSync(artifact) || statSync(artifact).size === 0) throw new Error(`Installer not produced: ${artifact}`);
  console.log(`Windows installer: ${artifact}`);
}

if (import.meta.main) await main();
