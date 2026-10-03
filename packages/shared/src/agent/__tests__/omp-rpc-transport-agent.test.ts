import { afterEach, describe, expect, it } from 'bun:test';
import { OmpAgent } from '../omp-agent.ts';
import { OmpRpcTransport } from '../omp-rpc-transport.ts';
import { withOmpRequiredModes } from '../omp-history.ts';
import { chatEvents, createFakeOmp, makeOmpConfig, useFakeOmpEnv, type FakeOmp } from './omp-fake-cli.ts';

let fake: FakeOmp | undefined;
let agent: OmpAgent | undefined;
let restore: (() => void) | undefined;
function setup(scenario: string) {
  fake = createFakeOmp(scenario);
  restore = useFakeOmpEnv(fake);
  agent = new OmpAgent(makeOmpConfig(fake, { model: 'rox/standard' }));
  return { agent, fake };
}
afterEach(() => { agent?.destroy(); restore?.(); fake?.cleanup(); agent = undefined; fake = undefined; restore = undefined; });

describe('OMP negotiated transport before provider execution', () => {
  it('negotiates v2 and verifies a catalogue larger than the native 1,424,866-byte response before prompting', async () => {
    const { agent, fake } = setup('transport-large-catalog');
    const events = await chatEvents(agent, 'QA bounded large catalogue', 8_000);
    expect(events.some(event => event.type === 'error')).toBe(false);
    expect(events.some(event => event.type === 'text_complete')).toBe(true);
    const frames = fake.readRpcLog();
    expect(frames.findIndex(frame => frame.type === 'negotiate_protocol')).toBeLessThan(frames.findIndex(frame => frame.type === 'get_available_models'));
    expect(frames.filter(frame => frame.type === 'prompt')).toHaveLength(1);
    expect(frames.find(frame => frame.type === 'prompt')?.observedModel).toEqual({ provider: 'rox', id: 'standard' });
  });

  for (const sourceState of ['', '<sources>\nActive: none\n</sources>']) {
    it(`sends an exact large provider command with ${sourceState ? 'source' : 'empty'} context using negotiated outbound chunks`, async () => {
      const { agent, fake } = setup('transport-large-command');
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
    });
  }

  it('preserves a small ordinary turn with an older v1-only peer', async () => {
    const { agent, fake } = setup('transport-v1');
    expect((await chatEvents(agent, 'QA legacy peer', 8_000)).some(event => event.type === 'text_complete')).toBe(true);
    expect(fake.readRpcLog().some(frame => frame.type === 'negotiate_protocol')).toBe(false);
  });

  for (const scenario of ['transport-wrong-limits', 'transport-missing-limits']) {
    it(`keeps v1 and fails the large response without prompting for ${scenario}`, async () => {
      const { agent, fake } = setup(scenario);
      const events = await chatEvents(agent, 'QA incompatible capability bounds', 8_000);
      expect(events.some(event => event.type === 'error')).toBe(true);
      expect(fake.readRpcLog().some(frame => frame.type === 'negotiate_protocol')).toBe(false);
      expect(fake.readRpcLog().filter(frame => frame.type === 'prompt')).toHaveLength(0);
    });
  }

  for (const scenario of ['transport-out-of-order', 'transport-bad-base64', 'transport-oversize', 'transport-interrupted', 'transport-incomplete', 'transport-bad-ack', 'transport-unterminated', 'transport-frame-error']) {
    it(`fails without a provider prompt for ${scenario}`, async () => {
      const { agent, fake } = setup(scenario);
      const events = await chatEvents(agent, 'QA must never reach provider', 8_000);
      expect(events.some(event => event.type === 'error')).toBe(true);
      expect(events.at(-1)?.type).toBe('complete');
      expect(fake.readRpcLog().filter(frame => frame.type === 'prompt')).toHaveLength(0);
      expect(agent.isProcessing()).toBe(false);
    });
  }

  it('releases a peer frame-error failure and negotiates a fresh child without an old pending request', async () => {
    const { agent, fake } = setup('transport-frame-error');
    const failed = await chatEvents(agent, 'QA peer rejects its transport frame', 8_000);
    expect(failed.some(event => event.type === 'error' && event.message.includes('Controlled transport overflow'))).toBe(true);
    fake.setScenario('transport-large-catalog');
    await agent.reconnect();
    expect((await chatEvents(agent, 'QA recovered peer', 8_000)).some(event => event.type === 'text_complete')).toBe(true);
    expect(fake.readRpcLog().filter(frame => frame.type === 'prompt')).toHaveLength(1);
    expect(fake.readRpcLog().filter(frame => frame.type === 'negotiate_protocol')).toHaveLength(2);
  });

  it('discards unfinished assembly on a failed child and negotiates a fresh child', async () => {
    const { agent, fake } = setup('transport-incomplete');
    await chatEvents(agent, 'QA truncated first child', 8_000);
    fake.setScenario('transport-large-catalog');
    await agent.reconnect();
    expect((await chatEvents(agent, 'QA new child', 8_000)).some(event => event.type === 'text_complete')).toBe(true);
    expect(fake.readRpcLog().filter(frame => frame.type === 'prompt')).toHaveLength(1);
    expect(fake.readRpcLog().filter(frame => frame.type === 'negotiate_protocol')).toHaveLength(2);
  });

  it('releases an unfinished response immediately when the current child is destroyed', async () => {
    const { agent } = setup('transport-large-catalog');
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
  });
});
