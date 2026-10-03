/** Network-enabled release payload smoke, entirely in an explicit temporary directory. */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { stageWindowsDependencies } from './stage-windows-dependencies';
import { BUN_VERSION, UV_VERSION, downloadBun, downloadUv, type BuildConfig } from './build/common';
import { readWindowsBootstrap, setWindowsBootstrapRuntime } from '../packages/shared/src/toolchain/windows-bootstrap';
import { createResolver } from '../packages/shared/src/toolchain/resolver';
import { toolchainPaths } from '../packages/shared/src/toolchain/manifest';

const index = process.argv.indexOf('--temp-root');
const tempRoot = index < 0 ? undefined : process.argv[index + 1];
if (process.platform !== 'win32' || !tempRoot || !existsSync(tempRoot)) {
  throw new Error('Usage: bun scripts/validate-windows-dependencies.ts --temp-root <existing-temp-dir> (downloads release payloads; no global installs)');
}
const work = mkdtempSync(join(resolve(tempRoot), 'rox-release-deps-'));
try {
  const resources = join(work, 'resources');
  mkdirSync(resources);
  await stageWindowsDependencies(join(resources, 'windows-dependencies'));
  const localAppData = join(work, 'local data with spaces');
  const dataRoot = join(localAppData, 'Rox', 'bootstrap');
  const ps = join(process.env.SystemRoot!, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const bootstrap = resolve(import.meta.dir, '../apps/electron/build/windows/bootstrap.ps1');
  const argv = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', bootstrap,
    '-ResourcesRoot', resources, '-DataRoot', dataRoot, '-Mode', 'bundled', '-InstallGitBash'];
  execFileSync(ps, argv, { stdio: 'inherit', windowsHide: true });
  const report = JSON.parse(readFileSync(join(dataRoot, 'status.json'), 'utf8').replace(/^\uFEFF/, ''));
  if (report.linuxSupport.phase !== 'not-selected' || report.tools.length !== 5
    || report.tools.some((t: { source: string }) => t.source !== 'bundled')) throw new Error('Incomplete native dependency receipt');
  const stamps = report.tools.map((t: { name: string; pinnedVersion: string }) =>
    join(dataRoot, 'dependencies', t.name, t.pinnedVersion, '.rox-payload.json'));
  const times = stamps.map((p: string) => statSync(p).mtimeMs);
  execFileSync(ps, argv, { stdio: 'inherit', windowsHide: true });
  if (stamps.some((p: string, i: number) => statSync(p).mtimeMs !== times[i])) throw new Error('Second bootstrap rewrote a verified dependency');
  const native = await readWindowsBootstrap({ localAppData, pathEnv: '' });
  if (!native || native.missingTools.length) throw new Error('Runtime did not consume native receipt');
  const resolver = createResolver(toolchainPaths(join(work, 'isolated-config')), { windowsBootstrap: native, pathEnv: '' });
  for (const tool of report.tools) {
    if (await resolver.findExecutable(tool.name) !== tool.executable) throw new Error(`Runtime path mismatch: ${tool.name}`);
  }
  const childEnv: NodeJS.ProcessEnv = { ...process.env, LOCALAPPDATA: localAppData, PATH: await resolver.toolchainPathPrefix() };
  for (const key of Object.keys(childEnv)) if (key !== 'PATH' && key.toUpperCase() === 'PATH') delete childEnv[key];
  if (execFileSync('node.exe', ['-e', 'console.log("native-child-ok")'], { env: childEnv, encoding: 'utf8' }).trim() !== 'native-child-ok') throw new Error('Native child PATH failed');
  execFileSync(join(process.env.SystemRoot!, 'System32', 'cmd.exe'), ['/d', '/c', 'npx.cmd --version'], { env: childEnv });
  // Exercise the real shared MCP pool, including its PATH injection and SDK cmd
  // launcher. Config/cache/HOME stay isolated; npm is offline and installs nothing.
  process.env.ROX_CONFIG_DIR = join(work, 'isolated-config');
  setWindowsBootstrapRuntime(native);
  const { McpClientPool } = await import('../packages/shared/src/mcp/mcp-pool');
  const fixture = join(work, 'native-mcp-fixture.cjs');
  writeFileSync(fixture, `const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', line => {
  const m = JSON.parse(line); if (m.id === undefined) return;
  const result = m.method === 'initialize' ? { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'native-fixture', version: '1' } }
    : m.method === 'tools/list' ? { tools: [{ name: 'inspect', inputSchema: { type: 'object' } }] }
    : { content: [{ type: 'text', text: JSON.stringify({ executable: process.execPath, path: process.env.PATH }) }] };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\\n');
});`);
  const pool = new McpClientPool();
  try {
    const env = { PATH: '', HOME: work, npm_config_cache: join(work, 'npm-cache'),
      npm_config_update_notifier: 'false',
      npm_config_userconfig: join(work, 'no-user.npmrc'), npm_config_globalconfig: join(work, 'no-global.npmrc') };
    await pool.connect('node-smoke', { type: 'stdio', command: 'node', args: [fixture], env });
    await pool.connect('npx-smoke', { type: 'stdio', command: 'npx', args: ['--offline', '--call', `node "${fixture}"`], env });
    for (const slug of ['node-smoke', 'npx-smoke']) {
      const result = await pool.callTool(`mcp__${slug}__inspect`, {});
      if (result.isError) throw new Error(`Native MCP failed: ${slug}`);
      const child = JSON.parse(result.content);
      if (child.executable.toLowerCase() !== (await native.findExecutable('node'))!.toLowerCase()) throw new Error(`MCP used wrong Node: ${slug}`);
    }
  } finally { await pool.disconnectAll(); setWindowsBootstrapRuntime(null); }
  const bash = await native.gitBashPath();
  if (!bash) throw new Error('Native PortableGit Bash unavailable to runtime');
  if (await resolver.findExecutable('bash') !== bash) throw new Error('Resolver did not expose native Bash');
  // No login/profile/credential commands; bash must run its own native helpers.
  const bashEnv = { ...childEnv, HOME: work, BASH_ENV: '', ENV: '',
    PATH: `${dirname(bash)};${join(dirname(bash), '..', 'usr', 'bin')};${childEnv.PATH}` };
  if (execFileSync(bash, ['--noprofile', '--norc', '-c', 'printf native-bash-ok'], { env: bashEnv, encoding: 'utf8' }) !== 'native-bash-ok') throw new Error('Native Bash execution failed');
  // Existing packaged runtime staging must also work on a plain Windows host.
  const config: BuildConfig = { platform: 'win32', arch: 'x64', rootDir: work, electronDir: join(work, "runtime with 'quotes'"),
    upload: false, uploadLatest: false, uploadScript: false };
  await downloadBun(config);
  await downloadUv(config);
  const bun = join(config.electronDir, 'vendor/bun/bun.exe');
  const uv = join(config.electronDir, 'resources/bin/win32-x64/uv.exe');
  if (execFileSync(bun, ['--version'], { encoding: 'utf8' }).trim() !== BUN_VERSION.replace('bun-v', '')) throw new Error('Packaged Bun pin mismatch');
  if (execFileSync(uv, ['--version'], { encoding: 'utf8' }).trim().split(/\s+/)[1] !== UV_VERSION) throw new Error('Packaged uv pin mismatch');
  const uvTime = statSync(uv).mtimeMs;
  await downloadUv(config);
  if (statSync(uv).mtimeMs !== uvTime) throw new Error('Pinned uv was unnecessarily rewritten');
  console.log('PASS: pinned Windows payloads + full PortableGit, runtime receipt/resolver, native node/npx/Bash children + real node/npx MCP pool, second-run idempotence; WSL not invoked');
} finally { rmSync(work, { recursive: true, force: true }); }
