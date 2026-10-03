import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateNpmWrappers } from '../installer';
import { ACPX_NPM_PIN, getNpmLock } from '../npm-locks';
import { MANIFEST_DATA, TOOL_PLATFORM_MATRIX } from '../manifest-data';
import { ALL_TOOL_NAMES } from '../types';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
describe('managed acpx', () => {
  it('is default-on with verified artifacts, supported Node dependency and production integrity lock', () => {
    const entry = MANIFEST_DATA.acpx!;
    expect(entry).toMatchObject({ version: '0.19.4', kind: 'npm', tier: 'default-on', dependsOn: ['node'] });
    expect(ALL_TOOL_NAMES.includes('acpx')).toBe(true);
    expect(TOOL_PLATFORM_MATRIX.acpx).toHaveLength(4);
    for (const artifact of Object.values(entry.artifacts)) {
      expect(artifact!.url).toBe(ACPX_NPM_PIN.tarballUrl);
      expect(artifact!.sha256).toBe(ACPX_NPM_PIN.tarballSha256);
      expect(artifact!.size).toBe(ACPX_NPM_PIN.tarballSize);
    }
    const lock = JSON.parse(getNpmLock('acpx', entry.version)!);
    expect(lock.packages['']).toMatchObject({ name: 'acpx', version: entry.version });
    expect(Object.keys(lock.packages).length).toBeGreaterThan(1);
    for (const [name, pkg] of Object.entries(lock.packages) as Array<[string, any]>) {
      if (!name) continue;
      expect(pkg.resolved).toStartWith('https://registry.npmjs.org/');
      expect(pkg.integrity).toStartWith('sha512-');
      expect(pkg.dev).not.toBe(true);
    }
    expect(getNpmLock('acpx', 'unreviewed-version')).toBeNull();
  });
  it('generates both platform launchers using Node and executes the declared CLI', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rox-acpx-launcher-')); roots.push(root);
    mkdirSync(join(root, 'package', 'dist'), { recursive: true });
    writeFileSync(join(root, 'package', 'package.json'), JSON.stringify({ name: 'acpx', bin: { acpx: 'dist/cli.js' } }));
    writeFileSync(join(root, 'package', 'dist', 'cli.js'), 'process.stdout.write(process.release.name + "\\n");');
    expect(await generateNpmWrappers(root)).toEqual(['bin/acpx', 'bin/acpx.cmd']);
    expect(readFileSync(join(root, 'bin/acpx'), 'utf8')).toContain('ROX_NODE_PATH');
    expect(readFileSync(join(root, 'bin/acpx.cmd'), 'utf8')).toContain('ROX_NODE_PATH');
    const launcher = join(root, 'bin', process.platform === 'win32' ? 'acpx.cmd' : 'acpx');
    const command = process.platform === 'win32' ? ['cmd.exe', '/d', '/c', launcher] : [launcher];
    const processResult = Bun.spawn(command, { env: { ...process.env, ROX_NODE_PATH: Bun.which('node')! }, stdout: 'pipe', stderr: 'pipe' });
    expect(await processResult.exited).toBe(0);
    expect(await new Response(processResult.stdout).text()).toBe('node\n');
  });
});
