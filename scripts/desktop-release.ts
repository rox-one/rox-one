/** Native runner desktop packaging; shared by GitHub Actions and CircleCI. */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { copySDK, copyRipgrep, verifySDKCopy, downloadBun, downloadUv, type BuildConfig } from './build/common';

const platform = process.platform;
const arch = process.arch;
if (!['darwin', 'win32'].includes(platform) || !['arm64', 'x64'].includes(arch)) throw new Error(`Unsupported runner ${platform}-${arch}`);
const rootDir = join(import.meta.dir, '..');
const electronDir = join(rootDir, 'apps/electron');
const config = { platform, arch, rootDir, electronDir, upload: false, uploadLatest: false, uploadScript: false } as BuildConfig;
async function run(args: string[], cwd = rootDir, env: Record<string, string> = {}) {
  const proc = Bun.spawn(args, { cwd, env: { ...process.env, ...env }, stdout: 'inherit', stderr: 'inherit' });
  if (await proc.exited !== 0) throw new Error(`Failed: ${args.join(' ')}`);
}
if (!process.argv.includes('--verify-only')) {
  // Build with the canonical CJS shims, subprocesses and renderer on every OS.
  await run(['bun', 'run', 'electron:build']);
  copySDK(config);
  verifySDKCopy(config);
  copyRipgrep(config);
  const staging = join(electronDir, 'release-native');
  mkdirSync(join(staging, '@tursodatabase'), { recursive: true });
  for (const pkg of ['database', 'database-common', `database-${platform}-${arch}${platform === "win32" ? "-msvc" : ""}`]) {
    const source = join(rootDir, 'node_modules/@tursodatabase', pkg);
    if (!existsSync(source)) throw new Error(`Native SQLite package missing: ${source}`);
    cpSync(source, join(staging, '@tursodatabase', pkg), { recursive: true, dereference: true });
  }
  await downloadBun(config);
  await downloadUv(config);
  await run(['bun', 'run', 'scripts/build/stage-servers.ts', platform, arch]);
  // Never implicitly publish to the upstream Craft update host.
  await run(['bun', 'x', '--no-install', 'electron-builder', platform === 'darwin' ? '--mac' : '--win', `--${arch}`, '--publish', 'never'], electronDir, { CSC_IDENTITY_AUTO_DISCOVERY: process.env.CSC_LINK ? 'true' : 'false' });
}
const releaseDir = join(electronDir, 'release');
const resources = platform === 'darwin'
  ? join(releaseDir, arch === 'arm64' ? 'mac-arm64' : 'mac', 'Rox.app/Contents/Resources')
  : join(releaseDir, 'win-unpacked/resources');
const app = join(resources, 'app');
for (const file of ['dist/main.cjs', 'dist/bootstrap-preload.cjs', 'dist/renderer/index.html', 'resources/pi-agent-server/index.js', 'node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs', `node_modules/@anthropic-ai/claude-agent-sdk-binary/claude${platform === 'win32' ? '.exe' : ''}`, `node_modules/@tursodatabase/database-${platform}-${arch}${platform === "win32" ? "-msvc" : ""}/package.json`]) {
  if (!existsSync(join(app, file))) throw new Error(`Packaged resource missing: ${file}`);
}
await run(['node', '--check', join(app, 'dist/main.cjs')]);
await run(['node', '-e', `const {Database}=require(${JSON.stringify(join(app, 'node_modules/@tursodatabase/database/dist/compat.js'))});const d=new Database(':memory:');console.log(d.prepare('select 1 as ok').get());d.close()`]);
const binaryRoot = platform === 'darwin' ? app : resources;
await run([join(binaryRoot, 'vendor/bun', platform === 'win32' ? 'bun.exe' : 'bun'), '--version']);
await run([join(app, `resources/bin/${platform}-${arch}`, platform === 'win32' ? 'uv.exe' : 'uv'), '--version']);
await run([join(app, 'node_modules/@anthropic-ai/claude-agent-sdk-binary', platform === 'win32' ? 'claude.exe' : 'claude'), '--version']);
const extensions = platform === 'darwin' ? ['dmg', 'zip'] : ['exe'];
const artifacts = extensions.map(ext => `Rox-${arch}.${ext}`).map(name => {
  const file = join(releaseDir, name);
  if (!existsSync(file) || statSync(file).size < 10_000_000) throw new Error(`Missing/invalid artifact: ${name}`);
  return { name, size: statSync(file).size, sha256: createHash('sha256').update(readFileSync(file)).digest('hex') };
});
const version = (await Bun.file(join(electronDir, 'package.json')).json()).version;
const commit = (await new Response(Bun.spawn(['git', 'rev-parse', 'HEAD'], {cwd:rootDir}).stdout).text()).trim();
await Bun.write(join(releaseDir, `manifest-${platform}-${arch}.json`), JSON.stringify({version, commit, platform, arch, signed: Boolean(process.env.CSC_LINK), artifacts}, null, 2)+'\n');
console.log('Verified packaged desktop resources, native SQLite and executable versions', artifacts);
