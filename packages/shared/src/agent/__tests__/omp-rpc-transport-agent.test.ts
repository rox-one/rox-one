import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentEvent } from '@rox/core/types';
import { createPocketFixture } from '../../auth/__tests__/pocket-test-fixture.ts';
import { LOCAL_ROX_CALLER, peekRoxAccountAuthority, setRoxAccountAuthority } from '../../auth/rox-account-authority.ts';
import { OmpAgent } from '../omp-agent.ts';
import { OmpRpcTransport } from '../omp-rpc-transport.ts';
import { withOmpRequiredModes } from '../omp-history.ts';
import { chatEvents, createFakeOmp, makeOmpConfig, useFakeOmpEnv, type FakeOmp } from './omp-fake-cli.ts';

// Permit bounded Pocket setup, an 8-second turn, and subprocess disposal.
// Recovery cases contain two separately bounded turns. Keep those turn bounds.
const PROCESS_FIXTURE_TIMEOUT_MS = 30_000;
let fake: FakeOmp | undefined;
let agent: OmpAgent | undefined;
let restore: (() => void) | undefined;
let restoreAuthority: (() => void) | undefined;
let restoreConfigEnv: (() => void) | undefined;
async function setup(scenario: string, trustedCaller = true) {
  fake = createFakeOmp(scenario);
  restore = useFakeOmpEnv(fake);
  const envKeys = ['ROX_CONFIG_DIR', 'CRAFT_CONFIG_DIR', 'ROX_API_KEY', 'ROX_BASE_URL', 'PI_CODING_AGENT_DIR', 'PI_CONFIG_FILES', 'OMP_PROFILE'] as const;
  const savedEnv = new Map(envKeys.map(key => [key, process.env[key]]));
  restoreConfigEnv = () => {
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  const configDir = join(fake.dir, 'config');
  mkdirSync(configDir);
  process.env.ROX_CONFIG_DIR = configDir;
  process.env.CRAFT_CONFIG_DIR = configDir;
  for (const key of envKeys.slice(2)) delete process.env[key];
  const previousAuthority = peekRoxAccountAuthority();
  // The setter assigns its singleton directly; restore an initially unset
  // singleton too, without loading a host account store.
  restoreAuthority = () => setRoxAccountAuthority(previousAuthority!);
  const pocket = createPocketFixture();
  await pocket.authority.start(LOCAL_ROX_CALLER);
  await pocket.authority.state(LOCAL_ROX_CALLER);
  setRoxAccountAuthority(pocket.authority);
  const roxExecutionContext = await pocket.authority.capture(LOCAL_ROX_CALLER);
  const script = join(fake.dir, 'fake-omp.js');
  writeFileSync(script, `require('node:fs').appendFileSync(${JSON.stringify(join(fake.dir, 'profiles.jsonl'))}, JSON.stringify(process.env.PI_CODING_AGENT_DIR) + '\\n');\n` + readFileSync(script, 'utf8'));
  agent = new OmpAgent(makeOmpConfig(fake, {
    model: 'rox/standard',
    ...(trustedCaller ? { roxExecutionContext } : {}),
  }));
  return { agent, fake };
}
afterEach(async () => {
  agent?.destroy();
  try {
    const log = fake && join(fake.dir, 'profiles.jsonl');
    const profiles: string[] = log && existsSync(log)
      ? readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
    const deadline = Date.now() + 8_000;
    while (profiles.some(path => existsSync(path)) && Date.now() < deadline) await Bun.sleep(10);
    expect(profiles.every(path => !existsSync(path))).toBe(true);
  } finally {
    restoreAuthority?.(); restoreConfigEnv?.(); restore?.(); fake?.cleanup();
    agent = undefined; fake = undefined; restore = undefined;
    restoreAuthority = undefined; restoreConfigEnv = undefined;
  }
});

const transportErrors: Record<string, string> = {
  'transport-out-of-order': 'OMP RPC chunk sequence must start at index 0',
  'transport-bad-base64': 'OMP RPC invalid chunk base64',
  'transport-oversize': 'OMP RPC invalid chunk metadata',
  'transport-interrupted': 'OMP RPC chunk sequence interrupted',
  'transport-incomplete': 'OMP RPC chunk sequence was truncated',
  'transport-bad-ack': 'OMP protocol v2 negotiation failed: OMP sent an invalid protocol v2 acknowledgement',
  'transport-unterminated': 'OMP RPC physical frame exceeds the transport limit',
  'transport-frame-error': 'Controlled transport overflow',
};
function expectTransportFailure(events: AgentEvent[], fake: FakeOmp, scenario: string) {
  expect(events.some(event => event.type === 'error' && event.message === transportErrors[scenario])).toBe(true);
  expect(events.some(event => event.type === 'typed_error' && event.error.code === 'OMP_PROTOCOL_ERROR')).toBe(true);
  const frames = fake.readRpcLog();
  expect(frames.filter(frame => frame.type === 'negotiate_protocol')).toHaveLength(1);
  expect(frames.filter(frame => frame.type === 'get_available_models')).toHaveLength(scenario === 'transport-bad-ack' ? 0 : 1);
}

describe('OMP negotiated transport before provider execution', () => {
  it('rejects a public model without a trusted caller context before starting the peer', async () => {
    const { agent, fake } = await setup('transport-large-catalog', false);
    const events = await chatEvents(agent, 'QA missing trusted caller', 8_000);
    expect(events.some(event => event.type === 'error' && event.message === 'ROX_TRUSTED_ACCOUNT_REQUIRED')).toBe(true);
    expect(events.at(-1)?.type).toBe('complete');
    expect(agent.isProcessing()).toBe(false);
    expect(fake.readArgvLog()).toEqual([]);
    expect(fake.readRpcLog()).toEqual([]);
  }, PROCESS_FIXTURE_TIMEOUT_MS);
  it('negotiates v2 and verifies a catalogue larger than the native 1,424,866-byte response before prompting', async () => {
    const { agent, fake } = await setup('transport-large-catalog');
    const events = await chatEvents(agent, 'QA bounded large catalogue', 8_000);
    expect(events.some(event => event.type === 'error')).toBe(false);
    expect(events.some(event => event.type === 'text_complete')).toBe(true);
    const frames = fake.readRpcLog();
    expect(frames.findIndex(frame => frame.type === 'negotiate_protocol')).toBeLessThan(frames.findIndex(frame => frame.type === 'get_available_models'));
    expect(frames.filter(frame => frame.type === 'prompt')).toHaveLength(1);
    expect(frames.find(frame => frame.type === 'prompt')?.observedModel).toEqual({ provider: 'rox', id: 'standard' });
  }, PROCESS_FIXTURE_TIMEOUT_MS);

  for (const sourceState of ['', '<sources>\nActive: none\n</sources>']) {
    it(`sends an exact large provider command with ${sourceState ? 'source' : 'empty'} context using negotiated outbound chunks`, async () => {
      const { agent, fake } = await setup('transport-large-command');
      // Own this fixture instead of inheriting another suite's SourceManager
      // module mock. Production adds this volatile context before the user tail.
      agent.getSourceManager().formatSourceState = () => sourceState;
      const message = 'QA large command ' + 'x'.repeat(1_424_866);
      const events = await chatEvents(agent, message, 8_000);
      expect(events.some(event => event.type === 'error')).toBe(false);
      expect(events.some(event => event.type === 'text_complete')).toBe(true);
      const prompts = fake.readRpcLog().filter(frame => frame.type === 'prompt');
      expect(prompts).toHaveLength(1);
      expect(prompts[0]?.message).toBe(`${sourceState}\n\n${withOmpRequiredModes(message)}`);
      expect(prompts[0]?.observedModel).toEqual({ provider: 'rox', id: 'standard' });
    }, PROCESS_FIXTURE_TIMEOUT_MS);
  }

  it('preserves a small ordinary turn with an older v1-only peer', async () => {
    const { agent, fake } = await setup('transport-v1');
    expect((await chatEvents(agent, 'QA legacy peer', 8_000)).some(event => event.type === 'text_complete')).toBe(true);
    expect(fake.readRpcLog().some(frame => frame.type === 'negotiate_protocol')).toBe(false);
  }, PROCESS_FIXTURE_TIMEOUT_MS);

  for (const scenario of ['transport-wrong-limits', 'transport-missing-limits']) {
    it(`keeps v1 and fails the large response without prompting for ${scenario}`, async () => {
      const { agent, fake } = await setup(scenario);
      const events = await chatEvents(agent, 'QA incompatible capability bounds', 8_000);
      expect(events.some(event => event.type === 'error')).toBe(true);
      expect(events.some(event => event.type === 'error' && event.message === 'RPC response exceeded the transport limit')).toBe(true);
      expect(fake.readRpcLog().some(frame => frame.type === 'negotiate_protocol')).toBe(false);
      expect(fake.readRpcLog().filter(frame => frame.type === 'get_available_models')).toHaveLength(1);
      expect(fake.readRpcLog().filter(frame => frame.type === 'prompt')).toHaveLength(0);
    }, PROCESS_FIXTURE_TIMEOUT_MS);
  }

  for (const scenario of ['transport-out-of-order', 'transport-bad-base64', 'transport-oversize', 'transport-interrupted', 'transport-incomplete', 'transport-bad-ack', 'transport-unterminated', 'transport-frame-error']) {
    it(`fails without a provider prompt for ${scenario}`, async () => {
      const { agent, fake } = await setup(scenario);
      const events = await chatEvents(agent, 'QA must never reach provider', 8_000);
      expect(events.some(event => event.type === 'error')).toBe(true);
      expectTransportFailure(events, fake, scenario);
      expect(events.at(-1)?.type).toBe('complete');
      expect(fake.readRpcLog().filter(frame => frame.type === 'prompt')).toHaveLength(0);
      expect(agent.isProcessing()).toBe(false);
    }, PROCESS_FIXTURE_TIMEOUT_MS);
  }

  it('releases a peer frame-error failure and negotiates a fresh child without an old pending request', async () => {
    const { agent, fake } = await setup('transport-frame-error');
    const failed = await chatEvents(agent, 'QA peer rejects its transport frame', 8_000);
    expect(failed.some(event => event.type === 'error' && event.message.includes('Controlled transport overflow'))).toBe(true);
    expectTransportFailure(failed, fake, 'transport-frame-error');
    fake.setScenario('transport-large-catalog');
    await agent.reconnect();
    expect((await chatEvents(agent, 'QA recovered peer', 8_000)).some(event => event.type === 'text_complete')).toBe(true);
    expect(fake.readRpcLog().filter(frame => frame.type === 'prompt')).toHaveLength(1);
    expect(fake.readRpcLog().filter(frame => frame.type === 'negotiate_protocol')).toHaveLength(2);
  }, PROCESS_FIXTURE_TIMEOUT_MS);

  it('discards unfinished assembly on a failed child and negotiates a fresh child', async () => {
    const { agent, fake } = await setup('transport-incomplete');
    const failed = await chatEvents(agent, 'QA truncated first child', 8_000);
    expectTransportFailure(failed, fake, 'transport-incomplete');
    fake.setScenario('transport-large-catalog');
    await agent.reconnect();
    expect((await chatEvents(agent, 'QA new child', 8_000)).some(event => event.type === 'text_complete')).toBe(true);
    expect(fake.readRpcLog().filter(frame => frame.type === 'prompt')).toHaveLength(1);
    expect(fake.readRpcLog().filter(frame => frame.type === 'negotiate_protocol')).toHaveLength(2);
  }, PROCESS_FIXTURE_TIMEOUT_MS);

  it('releases an unfinished response immediately when the current child is destroyed', async () => {
    const { agent } = await setup('transport-large-catalog');
    expect((await chatEvents(agent, 'QA stop releases transport', 8_000)).some(event => event.type === 'text_complete')).toBe(true);
    // Stop after a valid first chunk, as if a child paused mid-response.
    const encoder = new OmpRpcTransport();
    encoder.enableV2();
    const firstChunk = encoder.encodeFrames({ type: 'response', data: 'x'.repeat(1_424_866) }).next().value!;
    const transport = (agent as unknown as { rpcTransport: OmpRpcTransport }).rpcTransport;
    expect(transport.decodeLine(firstChunk.trimEnd())).toBeUndefined();
    agent.destroy();
    expect(() => transport.finish()).not.toThrow();
    expect(() => [...transport.encodeFrames({ type: 'prompt', message: 'x'.repeat(1_424_866) })]).toThrow('protocol v1');
  }, PROCESS_FIXTURE_TIMEOUT_MS);
});
