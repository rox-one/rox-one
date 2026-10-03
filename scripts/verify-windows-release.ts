/** Read-only artifact verification. Never launches Rox, the installer, WSL, or a user database. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { verifyDependencyPayload } from './stage-windows-dependencies';
import { BUN_VERSION, UV_VERSION } from './build/common';

const unpacked = process.argv[2];
const installer = process.argv[3];
if (process.platform !== 'win32' || !unpacked || !installer) throw new Error('Usage: bun scripts/verify-windows-release.ts <win-unpacked-dir> <installer-path>');
const resources = join(resolve(unpacked), 'resources');
const app = join(resources, 'app');
const metadata = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'));
if (metadata.roxWindowsBuild !== 'optional-development') throw new Error('Expected explicit optional-development metadata');
for (const path of ['dist/main.cjs', 'dist/bootstrap-preload.cjs', 'dist/renderer/index.html',
  'resources/pi-agent-server/index.js', 'resources/cloud-runner/stub-runner.js',
  'node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs', 'node_modules/@anthropic-ai/claude-agent-sdk-binary/claude.exe',
  'node_modules/@tursodatabase/database-common/package.json',
  'node_modules/@tursodatabase/database-win32-x64-msvc/turso.win32-x64-msvc.node']) {
  if (!existsSync(join(app, path))) throw new Error(`Packaged runtime file missing: ${path}`);
}
for (const path of ['src', 'scripts', 'build', 'vendor/bun', 'dist/resources/bin/win32-x64']) {
  if (existsSync(join(app, path))) throw new Error(`Unexpected source/duplicate runtime directory: ${path}`);
}
for (const script of ['bootstrap.ps1', 'dependency-functions.ps1', 'linux-support.ps1', 'enable-wsl.ps1']) {
  if (!existsSync(join(resources, 'windows-bootstrap', script))) throw new Error(`Bootstrap script missing: ${script}`);
}
execFileSync('node', ['--check', join(app, 'dist/main.cjs')], { stdio: 'inherit', windowsHide: true });
if (execFileSync(join(resources, 'vendor/bun/bun.exe'), ['--version'], { encoding: 'utf8' }).trim() !== BUN_VERSION.replace('bun-v', '')) throw new Error('Packaged Bun version mismatch');
if (execFileSync(join(app, 'resources/bin/win32-x64/uv.exe'), ['--version'], { encoding: 'utf8' }).trim().split(/\s+/)[1] !== UV_VERSION) throw new Error('Packaged uv version mismatch');
const payloads = join(resources, 'windows-dependencies');
const manifest = JSON.parse(readFileSync(join(payloads, 'manifest.json'), 'utf8'));
for (const tool of [...manifest.tools, manifest.optionalGitBash]) verifyDependencyPayload(readFileSync(join(payloads, tool.payload)), tool);
execFileSync('node', ['--input-type=module', '-e', `
import { pathToFileURL } from 'node:url';
const { connect } = await import(pathToFileURL(process.argv[1]).href);
const db = await connect(':memory:');
const row = await db.prepare('select 42 as answer').get();
if (row.answer !== 42) throw new Error('Packaged WorkGraph NAPI query failed');
await db.close();
`, join(app, 'node_modules/@tursodatabase/database/dist/promise.js')], { cwd: resolve(unpacked), stdio: 'inherit', windowsHide: true });
const artifact = resolve(installer);
if (statSync(artifact).size === 0) throw new Error('Installer is empty');
const hash = createHash('sha256');
for await (const chunk of createReadStream(artifact)) hash.update(chunk);
console.log(JSON.stringify({ result: 'PASS', artifact, bytes: statSync(artifact).size, sha256: hash.digest('hex'),
  build: metadata.roxWindowsBuild, payloads: manifest.tools.length + 1,
  checks: ['main-syntax', 'runtime-files', 'no-source-or-duplicate-runtime-tree', 'bun-uv-pins', 'all-payload-hashes', 'in-memory-workgraph-napi'],
  installerExecuted: false }, null, 2));
