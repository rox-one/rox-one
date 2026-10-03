/** Real child-process regressions: no mocked spawn, no live OMP/network. */
import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildOmpLaunchSpec, OmpAgent } from '../omp-agent.ts';
import { chatEvents, createFakeOmp, makeOmpConfig, useFakeOmpEnv, type FakeOmp } from './omp-fake-cli.ts';

let fake: FakeOmp | null = null;
let agent: OmpAgent | null = null;
let restoreEnv: (() => void) | null = null;

function setup(): { agent: OmpAgent; fake: FakeOmp } {
  fake = createFakeOmp();
  restoreEnv = useFakeOmpEnv(fake);
  agent = new OmpAgent(makeOmpConfig(fake));
  return { agent, fake };
}

afterEach(async () => {
  agent?.destroy();
  agent = null;
  restoreEnv?.();
  restoreEnv = null;
  await fake?.cleanup();
  fake = null;
});

describe('OMP launch argv isolation', () => {
  it('one-shot preserves multiline prompts, quotes, shell operators and model IDs', async () => {
    const { agent, fake } = setup();
    const sentinel = join(fake.dir, 'injected.txt');
    const prompt = `Unicode Русский\n" & echo INJECTED > "${sentinel}" & rem "\n%PATH% !literal! ^ | < > \\`;
    const model = 'rox/fast " & echo model-injection & %PATH% !MODEL!';
    const result = await agent.queryLlm({ prompt, systemPrompt: 'system\n"quoted"', model });
    expect(result.text).toContain('fake-omp answer');
    expect(result.model).toBe(model);
    const calls = fake.readArgvLog();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(['--no-session', '--model', model, '-p', `system\n"quoted"\n\n${prompt}`]);
    expect(existsSync(sentinel)).toBe(false);
  });

  it('RPC launches through the managed layout and completes a real NDJSON turn', async () => {
    const { agent, fake } = setup();
    const sentinel = join(fake.dir, 'rpc-injected.txt');
    const context = `context\n" & echo INJECTED > "${sentinel}" & rem "\n%PATH% !literal!`;
    (agent as any).buildCraftContextPrompt = () => context;
    const events = await chatEvents(agent, 'hello\n" & | %PATH%', 15_000);
    expect(events.some((event) => event.type === 'text_complete')).toBe(true);
    expect(events.some((event) => event.type === 'typed_error' || event.type === 'error')).toBe(false);
    expect(events.at(-1)?.type).toBe('complete');
    const argv = fake.readArgvLog()[0]!;
    expect(argv.slice(0, 3)).toEqual(['--mode', 'rpc', '--allow-home']);
    expect(argv[argv.indexOf('--session-dir') + 1]).toBe(join(fake.workspaceRoot, 'sessions', 'session-test', 'omp'));
    expect(argv[argv.indexOf('--append-system-prompt') + 1]).toBe(context);
    expect(fake.readRpcLog().some((frame) => frame.type === 'prompt')).toBe(true);
    expect(existsSync(sentinel)).toBe(false);
    expect(agent.isProcessing()).toBe(false);
  }, 20_000);
});

describe.skipIf(process.platform !== 'win32')('OMP Windows batch launch rejection', () => {
  it('rejects a package bin that escapes its package directory', () => {
    const { fake } = setup();
    writeFileSync(join(fake.dir, 'package', 'package.json'), JSON.stringify({
      name: '@oh-my-pi/pi-coding-agent', bin: { omp: '../fake-omp.js' },
    }));
    expect(() => buildOmpLaunchSpec(fake.binPath, process.env)).toThrow(/cannot be started safely/);
    expect(fake.readArgvLog()).toEqual([]);
  });

  it('rejects a batch Bun override and leaves native and Unix launch arguments untouched', () => {
    const { fake } = setup();
    expect(() => buildOmpLaunchSpec(fake.binPath, { CRAFT_BUN_PATH: 'bun.cmd' })).toThrow(/native Bun/);
    expect(buildOmpLaunchSpec('omp.exe', {}, 'win32')).toEqual({ command: 'omp.exe', argsPrefix: [] });
    expect(buildOmpLaunchSpec('/bin/omp', {}, 'linux')).toEqual({ command: '/bin/omp', argsPrefix: [] });
  });

  it('launches literal argv under native Node, where direct .cmd spawn throws EINVAL', () => {
    const { fake } = setup();
    const sentinel = join(fake.dir, 'node-injected.txt');
    const prompt = `Русский\n" & echo INJECTED > "${sentinel}" & rem "\n%PATH% !literal! ^ | \\`;
    const args = ['--no-session', '--model', 'rox/fast', '-p', prompt];
    const launch = buildOmpLaunchSpec(fake.binPath, process.env);
    const probe = spawnSync('node', ['-e', `
      const { spawn, spawnSync } = require('node:child_process');
      let originalError;
      try { spawn(process.argv[1], [], { shell: false }); }
      catch (error) { originalError = error.code; }
      const launch = JSON.parse(process.argv[2]);
      const args = JSON.parse(process.argv[3]);
      const child = spawnSync(launch.command, [...launch.argsPrefix, ...args], {
        shell: false, input: '', encoding: 'utf8', timeout: 10000,
      });
      const rpcArgs = ['--mode', 'rpc', '--append-system-prompt', args.at(-1)];
      const rpc = spawnSync(launch.command, [...launch.argsPrefix, ...rpcArgs], {
        shell: false, input: JSON.stringify({ id: 'node-rpc', type: 'prompt', message: 'hello' }) + '\\n',
        encoding: 'utf8', timeout: 10000,
      });
      console.log(JSON.stringify({ originalError, status: child.status, stdout: child.stdout,
        stderr: child.stderr, error: child.error?.message,
        rpcStatus: rpc.status, rpcStdout: rpc.stdout, rpcError: rpc.error?.message }));
    `, fake.binPath, JSON.stringify(launch), JSON.stringify(args)], {
      env: process.env, encoding: 'utf8', timeout: 15_000, windowsHide: true,
    });
    expect(probe.error).toBeUndefined();
    expect(probe.status).toBe(0);
    const result = JSON.parse(probe.stdout.trim());
    expect(result.originalError).toBe('EINVAL');
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('fake-omp answer');
    expect(result.rpcStatus).toBe(0);
    expect(result.rpcError).toBeUndefined();
    const frames = result.rpcStdout.trim().split('\n').map((line: string) => JSON.parse(line));
    expect(frames[0].type).toBe('ready');
    expect(frames.at(-1).type).toBe('agent_end');
    expect(fake.readArgvLog()).toEqual([args, ['--mode', 'rpc', '--append-system-prompt', prompt]]);
    expect(existsSync(sentinel)).toBe(false);
  }, 20_000);

  it('resolves a bare omp from the effective PATH without running its batch shim', async () => {
    const { agent, fake } = setup();
    process.env.OMP_CLI_PATH = 'omp';
    const originalPath = process.env.PATH;
    process.env.PATH = join(fake.dir, 'bin');
    try {
      expect(await agent.runMiniCompletion('title')).toContain('fake-omp answer');
      expect(fake.readArgvLog()).toEqual([['--no-session', '-p', 'title']]);
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
    }
  });

  it('fails closed for an arbitrary batch override rather than evaluating it', async () => {
    const { agent, fake } = setup();
    const sentinel = join(fake.dir, 'batch-ran.txt');
    const batch = join(fake.dir, 'unrecognized.cmd');
    writeFileSync(batch, `@echo off\r\necho executed > "${sentinel}"\r\n`);
    process.env.OMP_CLI_PATH = batch;
    await expect(agent.queryLlm({ prompt: 'hi' })).rejects.toThrow(/OMP|launcher|batch/i);
    expect(existsSync(sentinel)).toBe(false);
    const events = await chatEvents(agent, 'hi', 15_000);
    const error = events.find((event) => event.type === 'typed_error');
    expect(error?.type === 'typed_error' && String(error.error.code)).toBe('OMP_NOT_CONFIGURED');
    expect(events.at(-1)?.type).toBe('complete');
    expect(agent.isProcessing()).toBe(false);
  }, 20_000);

  it('reports a missing native runtime as a bounded startup error and honors child env overrides', async () => {
    const { fake } = setup();
    agent!.destroy();
    const runtime = join(fake.dir, 'missing-bun.exe');
    agent = new OmpAgent(makeOmpConfig(fake, { envOverrides: { CRAFT_BUN_PATH: runtime } }));
    await expect(agent.queryLlm({ prompt: 'hi' })).rejects.toThrow();
    const events = await chatEvents(agent, 'hi', 15_000);
    const error = events.find((event) => event.type === 'typed_error');
    expect(error?.type === 'typed_error' && String(error.error.code)).toBe('OMP_NOT_CONFIGURED');
    expect(events.at(-1)?.type).toBe('complete');
    expect(fake.readArgvLog()).toEqual([]);
    expect(agent.isProcessing()).toBe(false);
  }, 20_000);
});
