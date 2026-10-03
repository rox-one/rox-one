import { beforeAll, afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { MANIFEST_DATA } from '../../toolchain/manifest-data.ts';
import { currentPlatform } from '../../toolchain/manifest.ts';
const nativeNode = process.env.HOST_BASH_TEST_NODE ?? Bun.which('node') ?? 'node';

(process.platform === 'win32' ? describe.skip : describe)('factory host Bash managed environment (actual registry)', () => {
  let root: string;
  let bundle: string;
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'host-bash-registry with spaces-'));
    const bin = MANIFEST_DATA.pandoc!.artifacts[currentPlatform()!]!.binPaths[0]!;
    const cli = join(root, 'toolchain', 'pandoc', 'current', bin);
    mkdirSync(dirname(cli), { recursive: true });
    writeFileSync(cli, '#!/bin/bash\nprintf managed-pandoc-canary', { mode: 0o700 });
    bundle = join(root, 'fixture.mjs');
    const built = await Bun.build({ entrypoints: [fileURLToPath(new URL('./host-bash-registry.fixture.ts', import.meta.url))],
      target: 'node', format: 'esm', external: ['electron', 'koffi'] });
    expect(built.success, built.logs.map(String).join('\n')).toBe(true);
    await Bun.write(bundle, built.outputs[0]!);
  }, 30000);
  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  async function probe(runtime: string, withoutProvider = false) {
    return await new Promise<{ runtime: { name: string; bun: string | null }; phases: string[]; result: { isError: boolean; content: { text: string }[] }; portCalled: boolean; parentPathUnchanged: boolean }>((resolve, reject) => {
      const env = { ...process.env, ROX_CONFIG_DIR: root, CRAFT_CONFIG_DIR: root, HOME: root,
        HOST_BASH_REGISTRY_FIXTURE: root, PATH: '/usr/bin:/bin',
        AWS_SECRET_ACCESS_KEY: 'registry-private-canary', ROX_SECRET_FIXTURE: 'registry-private-canary',
        ...(process.platform === 'win32' ? { aws_session_token: 'registry-private-canary' } : {}) };
      const child = spawn(runtime, [bundle, ...(withoutProvider ? ['--without-provider'] : [])], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', err = '';
      const timer = setTimeout(() => { child.kill('SIGKILL'); child.stdout.destroy(); child.stderr.destroy(); reject(new Error('registry fixture exceeded deadline')); }, 15000);
      child.stdout.on('data', data => { out += data.toString(); }); child.stderr.on('data', data => { err += data.toString(); });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', code => { clearTimeout(timer); if (code !== 0) reject(new Error(`fixture exit ${code}: ${err}`)); else { try { resolve(JSON.parse(out.trim())); } catch (error) { reject(error); } } });
    });
  }

  for (const [name, runtime] of [['Bun', process.execPath], ['Node', nativeNode]]) {
    it(`${name}: factory → registry prepares managed CLI PATH without credentials or parent mutation`, async () => {
      const result = await probe(runtime!);
      expect(result.runtime.name).toBe('node');
      if (name === 'Node') expect(result.runtime.bun).toBeNull();
      else expect(result.runtime.bun).not.toBeNull();
      expect(result.result.isError).toBe(false);
      expect(result.result.content[0]!.text).toContain('managed-pandoc-canary|credentials:::');
      expect(JSON.stringify(result)).not.toContain('registry-private-canary');
      expect(result.portCalled).toBe(false);
      expect(result.phases[0]).toBe('started');
      expect(result.phases.at(-1)).toBe('completed');
      expect(result.parentPathUnchanged).toBe(true);
    }, 20000);
  }
  it('negative control: the same factory without its provider cannot find the managed CLI', async () => {
    const result = await probe(process.execPath, true);
    expect(result.result.isError).toBe(true);
    expect(result.result.content[0]!.text).toContain('exitCode: 127');
    expect(result.result.content[0]!.text).not.toContain('managed-pandoc-canary');
    expect(result.portCalled).toBe(true);
    expect(result.parentPathUnchanged).toBe(true);
  }, 20000);
});
