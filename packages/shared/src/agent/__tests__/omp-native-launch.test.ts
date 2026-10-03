import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { OmpAgent } from '../omp-agent.ts';
import { AbortReason } from '../backend/types.ts';
import { withOmpRequiredModes } from '../omp-history.ts';
import { getCredentialManager } from '../../credentials/manager.ts';
import { createPocketFixture } from '../../auth/__tests__/pocket-test-fixture.ts';
import { LOCAL_ROX_CALLER, setRoxAccountAuthority } from '../../auth/rox-account-authority.ts';
import * as runtime from '../../toolchain-runtime.ts';
import { LOCALE_REGISTRY, setupI18n } from '../../i18n/index.ts';
import { chatEvents, makeOmpConfig } from './omp-fake-cli.ts';
import { cleanupNativeLaunchFixture, createNativeLaunchFixture, hasNativeSource } from './omp-native-launch-fixture.ts';

let fixture: ReturnType<typeof createNativeLaunchFixture> | undefined;
let agent: OmpAgent | undefined;
const mocks: Array<{ mockRestore(): void }> = [];
afterEach(async () => {
  const child = (agent as any)?.subprocess as import('node:child_process').ChildProcess | null;
  const closed = child?.pid && child.exitCode === null && !child.signalCode
    ? new Promise<void>(resolve => child.once('close', () => resolve())) : Promise.resolve();
  agent?.destroy();
  await closed;
  for (const mock of mocks.splice(0).reverse()) mock.mockRestore();
  fixture?.restore();
  if (fixture) await cleanupNativeLaunchFixture(fixture.fake);
  fixture = undefined; agent = undefined;
});

async function setup() {
  fixture = createNativeLaunchFixture();
  mocks.push(spyOn(getCredentialManager(), 'getLlmApiKey').mockResolvedValue(null));
  // Main requires a trusted owner for public models; keep this fixture's
  // native launch probes on the same synthetic public account contract.
  const pocket = createPocketFixture();
  await pocket.authority.start(LOCAL_ROX_CALLER);
  await pocket.authority.state(LOCAL_ROX_CALLER);
  setRoxAccountAuthority(pocket.authority);
  const roxExecutionContext = await pocket.authority.capture(LOCAL_ROX_CALLER);
  agent = new OmpAgent(makeOmpConfig(fixture.fake, { model: 'rox/standard', roxExecutionContext, envOverrides: {
    CRAFT_BUN_PATH: process.execPath, ROX_API_KEY: '', PI_CODING_AGENT_DIR: join(fixture.fake.dir, 'empty-user-profile'), PI_CONFIG_FILES: '',
  } }));
  mkdirSync(dirname(blobFile()), { recursive: true });
  writeFileSync(blobFile(), 'persistent fixture blob');
  return { ...fixture, agent };
}

function ownedDirs(name: 'omp' | 'omp-native'): string[] {
  const root = join(process.env.ROX_CONFIG_DIR!, 'runtime', name);
  return existsSync(root) ? readdirSync(root).filter(entry => entry.startsWith('rox-')).sort() : [];
}

function blobFile(): string { return join(process.env.ROX_CONFIG_DIR!, 'runtime', 'omp', 'state', 'blobs', 'launch-fixture.txt'); }
async function waitForCleanup() {
  const deadline = Date.now() + 3000;
  while ((ownedDirs('omp').length || ownedDirs('omp-native').length) && Date.now() < deadline) await Bun.sleep(10);
  expect(ownedDirs('omp')).toEqual([]); expect(ownedDirs('omp-native')).toEqual([]);
  expect(readFileSync(blobFile(), 'utf8')).toBe('persistent fixture blob');
}

describe.skipIf(!hasNativeSource)('managed OMP native invocation boundaries (cached 18.4.12 source)', () => {
  it('destroy during native preparation must not spawn after teardown and must clean both owners', async () => {
    const { agent, fake } = await setup();
    let entered!: () => void;
    let release!: () => void;
    const entry = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const original = (agent as any).prepareNativeInvocation.bind(agent);
    mocks.push(spyOn(agent as any, 'prepareNativeInvocation').mockImplementation(async (...args: any[]) => {
      const invocation = await original(...args);
      entered(); await gate; return invocation;
    }));
    const pending = chatEvents(agent, 'cancel native fixture launch', 30_000);
    await entry;
    agent.destroy();
    release();
    const events = await pending;
    expect(events.at(-1)?.type).toBe('complete');
    expect((agent as any).subprocess === null).toBe(true);
    expect(fake.readArgvLog()).toEqual([]);
    expect(ownedDirs('omp')).toEqual([]);
    expect(ownedDirs('omp-native')).toEqual([]);
    expect(existsSync(join(process.env.ROX_CONFIG_DIR!, 'runtime', 'omp', 'state', 'blobs'))).toBe(true);
  }, 40_000);

  for (const boundary of ['executable', 'credentials', 'path-prefix', 'bun-lookup', 'native-prepared'] as const) {
    for (const cancellation of ['destroy', 'abort', 'forceAbort'] as const) {
      it(`${cancellation} during ${boundary} prevents a late native launch and preserves blobs`, async () => {
        const { agent, fake } = await setup();
        let entered!: () => void;
        let release!: () => void;
        const entry = new Promise<void>(resolve => { entered = resolve; });
        const gate = new Promise<void>(resolve => { release = resolve; });
        const pause = async () => { entered(); await gate; };
        if (boundary === 'executable') mocks.push(spyOn(runtime, 'resolveOmpExecutableOrExplain').mockImplementation(async () => { await pause(); return fake.binPath; }));
        else if (boundary === 'credentials') mocks.push(spyOn(getCredentialManager(), 'getLlmApiKey').mockImplementation(async () => { await pause(); return null; }));
        else if (boundary === 'path-prefix') mocks.push(spyOn(runtime, 'withToolchainPathPrefix').mockImplementation(async env => { await pause(); return env; }));
        else if (boundary === 'bun-lookup') {
          (agent as any).config.envOverrides.CRAFT_BUN_PATH = '';
          const resolver = runtime.getToolchain().resolver;
          const original = resolver.findExecutable.bind(resolver);
          mocks.push(spyOn(resolver, 'findExecutable').mockImplementation(async name => {
            if (name === 'bun') { await pause(); return process.execPath; }
            return original(name);
          }));
        } else {
          const original = (agent as any).prepareNativeInvocation.bind(agent);
          mocks.push(spyOn(agent as any, 'prepareNativeInvocation').mockImplementation(async (...args: any[]) => {
            const invocation = await original(...args); await pause(); return invocation;
          }));
        }
        const pending = chatEvents(agent, 'cancel native invocation', 30_000);
        await entry;
        if (boundary === 'native-prepared') {
          expect(ownedDirs('omp')).toHaveLength(1); expect(ownedDirs('omp-native')).toHaveLength(1);
        }
        if (cancellation === 'destroy') agent.destroy();
        else if (cancellation === 'abort') await agent.abort('fixture cancel');
        else agent.forceAbort(AbortReason.Redirect);
        release();
        const events = await pending;
        expect(events.at(-1)?.type).toBe('complete');
        expect(events.some(event => event.type === 'error' || event.type === 'typed_error')).toBe(false);
        expect(agent.isProcessing()).toBe(false);
        expect((agent as any).subprocess === null).toBe(true);
        expect(fake.readArgvLog()).toEqual([]);
        await waitForCleanup();
      }, 40_000);
    }
  }

  it('destroy during one-shot preparation disposes the returned overlay and profile', async () => {
    const { agent, fake } = await setup();
    let entered!: () => void; let release!: () => void;
    const entry = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const original = (agent as any).prepareNativeInvocation.bind(agent);
    mocks.push(spyOn(agent as any, 'prepareNativeInvocation').mockImplementation(async (...args: any[]) => {
      const invocation = await original(...args); entered(); await gate; return invocation;
    }));
    const pending = agent.queryLlm({ prompt: 'cancelled one-shot' });
    await entry;
    expect(ownedDirs('omp')).toHaveLength(1); expect(ownedDirs('omp-native')).toHaveLength(1);
    agent.destroy(); release();
    await expect(pending).rejects.toThrow(/aborted/i);
    expect(fake.readArgvLog()).toEqual([]);
    await waitForCleanup();
  });

  it('missing Bun names the actual runtime and provides its recovery setting', async () => {
    const { agent, fake } = await setup();
    const missing = join(fake.dir, 'missing bun.exe');
    (agent as any).config.envOverrides.CRAFT_BUN_PATH = missing;
    const events = await chatEvents(agent, 'missing native fixture runtime', 30_000);
    const error = events.find(event => event.type === 'typed_error');
    expect(error?.type === 'typed_error' && error.error.message).toContain(missing);
    expect(error?.type === 'typed_error' && error.error.message).toContain('CRAFT_BUN_PATH');
    expect(error?.type === 'typed_error' && error.error.message).toContain('ENOENT');
    await expect(agent.queryLlm({ prompt: 'missing one-shot runtime' })).rejects.toThrow('CRAFT_BUN_PATH');
    await waitForCleanup();
    expect(fake.readArgvLog()).toEqual([]);
    (agent as any).config.envOverrides.CRAFT_BUN_PATH = process.execPath;
    expect((await chatEvents(agent, 'retry native fixture', 30_000)).some(event => event.type === 'text_complete')).toBe(true);
  }, 40_000);

  it('workspace-relative package and native runtime paths use child cwd', async () => {
    const { agent, fake, packageDir } = await setup();
    const original = (agent as any).prepareNativeInvocation.bind(agent);
    const relative = './managed runtime with spaces/bin/rox.cmd';
    const bunDir = join(fake.workspaceRoot, 'Bun runtime with spaces');
    symlinkSync(dirname(process.execPath), bunDir, process.platform === 'win32' ? 'junction' : 'dir');
    const bun = `./Bun runtime with spaces/${basename(process.execPath)}`;
    const invocation = await original(relative, { CRAFT_BUN_PATH: bun }, fake.workspaceRoot);
    try {
      expect(invocation.bin).toBe(join(bunDir, basename(process.execPath)));
      expect(invocation.prefix[0]).toContain(join('omp-native', 'rox-native-policy-'));
      expect(invocation.prefix[0]).not.toBe(join(packageDir, 'original.cjs'));
    } finally { invocation.dispose(); }
    process.env.OMP_CLI_PATH = relative;
    (agent as any).config.envOverrides.CRAFT_BUN_PATH = bun;
    expect((await chatEvents(agent, 'relative native invocation', 30_000)).some(event => event.type === 'text_complete')).toBe(true);
    expect(await agent.runMiniCompletion('relative title')).toContain('fake-omp answer');
  });

  it('rejects batch Bun and non-managed production packages before launching', async () => {
    const { agent, fake } = await setup();
    for (const bin of ['invalid.cmd', 'invalid.bat']) {
      await expect((agent as any).prepareNativeInvocation(fake.binPath, { CRAFT_BUN_PATH: bin })).rejects.toThrow('CRAFT_BUN_PATH');
    }
    const saved = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    try {
      await expect((agent as any).prepareNativeInvocation(join(fake.dir, 'external.exe'), { CRAFT_BUN_PATH: process.execPath })).rejects.toThrow('managed pinned OMP');
    } finally { if (saved === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = saved; }
    expect(fake.readArgvLog()).toEqual([]);
    await waitForCleanup();
  });

  it('preparation rejection settles startup and retry uses a fresh owned invocation', async () => {
    const { agent } = await setup();
    const original = (agent as any).prepareNativeInvocation.bind(agent);
    const mock = spyOn(agent as any, 'prepareNativeInvocation').mockRejectedValueOnce(new Error('fixture preparation rejected')).mockImplementation(original);
    mocks.push(mock);
    const events = await chatEvents(agent, 'rejected preparation', 30_000);
    expect(events.some(event => event.type === 'error')).toBe(true);
    expect(events.at(-1)?.type).toBe('complete');
    expect((agent as any).startupInFlight).toBe(false);
    await waitForCleanup();
    expect((await chatEvents(agent, 'retry preparation', 30_000)).some(event => event.type === 'text_complete')).toBe(true);
  });

  it('a real synchronous spawn rejection cleans profile and native overlay', async () => {
    const { agent, fake } = await setup();
    (agent as any).config.envOverrides.CRAFT_BUN_PATH = process.execPath + '\0';
    const events = await chatEvents(agent, 'invalid native process command', 30_000);
    expect(events.some(event => event.type === 'error')).toBe(true);
    expect(events.at(-1)?.type).toBe('complete');
    expect(fake.readArgvLog()).toEqual([]);
    await waitForCleanup();
  });

  it('an actual pre-ready exit cleans both owners and can retry', async () => {
    const { agent, fake } = await setup();
    fake.setScenario('exit-generic');
    const events = await chatEvents(agent, 'native early exit fixture', 30_000);
    expect(events.some(event => event.type === 'typed_error')).toBe(true);
    expect(events.at(-1)?.type).toBe('complete');
    await waitForCleanup();
    fake.setScenario('model-public');
    expect((await chatEvents(agent, 'retry early exit', 30_000)).some(event => event.type === 'text_complete')).toBe(true);
    expect(fake.readArgvLog()).toHaveLength(2);
  });

  it('native history/model verification and permission retirement survive the port', async () => {
    const { agent, fake } = await setup();
    agent.setPermissionMode('allow-all');
    await chatEvents(agent, 'first native turn', 30_000);
    agent.setPermissionMode('safe');
    const events = await chatEvents(agent, 'mode retired and history resumed', 30_000);
    expect(events.some(event => event.type === 'text_complete')).toBe(true);
    expect(fake.readArgvLog()).toHaveLength(2);
    expect(fake.readArgvLog()[0]).toContain('yolo');
    expect(fake.readArgvLog()[1]).not.toContain('--approval-mode');
    expect(fake.readRpcLog().some(frame => frame.type === 'switch_session' && frame.sessionPath === fake.transcriptFile)).toBe(true);
    await agent.updateRuntimeConfig({ model: 'rox/kimi-k2' });
    await chatEvents(agent, 'updated model', 30_000);
    expect(fake.readRpcLog().filter(frame => frame.type === 'prompt').at(-1)?.observedModel).toEqual({ provider: 'rox', id: 'kimi-k2' });
    expect(fake.readRpcLog().filter(frame => frame.type === 'set_thinking_level' && frame.level === 'max')).toHaveLength(3);
  }, 40_000);

  it('one-shot keeps main mandatory model/thinking/directive argv and cleans both owners on exit', async () => {
    const { agent, fake, observation } = await setup();
    const prompt = 'Русский\n" & | %PATH% !literal! \\';
    expect(await agent.runMiniCompletion(prompt)).toContain('fake-omp answer');
    expect(fake.readArgvLog()[0]).toEqual(['--no-session', '--thinking', 'max', '--model', 'rox/fast', '-p', withOmpRequiredModes(prompt)]);
    const seen = JSON.parse(readFileSync(observation, 'utf8').trim());
    expect(seen.entry).toContain(join('omp-native', 'rox-native-policy-'));
    expect(seen.attribution).toBe('rox');
    await waitForCleanup();
  });

  it('runtime guidance exists in every locale and process-error details are scrubbed', async () => {
    const { agent } = await setup();
    const i18n = setupI18n(); const previous = i18n.language;
    try {
      for (const [locale, entry] of Object.entries(LOCALE_REGISTRY)) {
        expect((entry.messages as Record<string, string>)['errors.omp.runtimeUnavailable.message']).toContain('{{path}}');
        await i18n.changeLanguage(locale);
        const error = (agent as any).nativeRuntimeError('fixture-bun.exe', Object.assign(new Error('spawn ENOENT Bearer fixture-token'), { code: 'ENOENT' }));
        expect(error.message).toContain('fixture-bun.exe'); expect(error.message).toContain('CRAFT_BUN_PATH');
        expect(error.message).toContain('ENOENT'); expect(error.message).not.toContain('fixture-token');
      }
    } finally { await i18n.changeLanguage(previous); }
  });

  it('main already routes managed .cmd to the verified native overlay with literal Node/Bun argv and NDJSON', async () => {
    const { agent, fake, packageDir } = await setup();
    const invocation = await (agent as any).prepareNativeInvocation(fake.binPath, { CRAFT_BUN_PATH: process.execPath });
    const prompt = 'Русский\n" & | %PATH% !literal! \\';
    try {
      const cli = invocation.prefix[0];
      expect(readFileSync(join(cli, '..', 'session', 'agent-session.ts'), 'utf8')).toContain('#roxRequiredModes');
      expect(readFileSync(join(packageDir, 'src', 'session', 'agent-session.ts'), 'utf8')).not.toContain('#roxRequiredModes');
      const probe = spawnSync('node', ['-e', `
        const {spawnSync} = require('node:child_process'); const spec = JSON.parse(process.argv[1]);
        const original = process.platform === 'win32' ? spawnSync(process.argv[3], [], {shell:false}) : null;
        const result = spawnSync(spec.bin, [...spec.prefix, '--mode', 'rpc', '', 'C:\\\\spaced path\\\\', '--append-system-prompt', process.argv[2]], {
          input: JSON.stringify({id:'probe',type:'prompt',message:'hi'})+'\\n', encoding:'utf8', timeout:10000, shell:false,
        });
        console.log(JSON.stringify({status:result.status,stdout:result.stdout,error:result.error?.message,originalError:original?.error?.code}));
      `, JSON.stringify({ bin: invocation.bin, prefix: invocation.prefix }), prompt, fake.binPath], { env: process.env, encoding: 'utf8', timeout: 15000 });
      expect(probe.error).toBeUndefined(); expect(probe.status).toBe(0);
      const result = JSON.parse(probe.stdout);
      expect(result.status).toBe(0);
      if (process.platform === 'win32') expect(result.originalError).toBe('EINVAL');
      const frames = result.stdout.trim().split('\n').map((line: string) => JSON.parse(line));
      expect(frames[0].type).toBe('ready'); expect(frames.at(-1).type).toBe('agent_end');
      expect(fake.readArgvLog()[0]?.at(-1)).toBe(prompt);
      expect(fake.readArgvLog()[0]?.[2]).toBe('');
      expect(fake.readArgvLog()[0]?.[3]).toBe('C:\\spaced path\\');
    } finally { invocation.dispose(); }
  }, 20_000);
});
