import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { OmpAgent } from '../omp-agent.ts';
import { getCredentialManager } from '../../credentials/manager.ts';
import { chatEvents, createFakeOmp, makeOmpConfig, useFakeOmpEnv, type FakeOmp } from './omp-fake-cli.ts';

type Observation = { agentDir: string; profile: string; ids: string[]; secretInFile: boolean; credentialMatches: boolean };
const ids = ['rox/explore', 'rox/standard', 'rox/max', 'rox/vision', 'rox/fast'];
let fake: FakeOmp | undefined;
let agent: OmpAgent | undefined;
let restore: (() => void) | undefined;
let connectionSlug: string | undefined;
let savedKey: string | undefined;
const profiles = new Set<string>();

async function waitUntil(predicate: () => boolean) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await Bun.sleep(10);
  }
  throw new Error('OMP runtime lifecycle fixture did not reach the expected state');
}

function observations(): Observation[] {
  if (!fake) throw new Error('Fixture missing');
  const path = join(fake.dir, 'profile-observations.jsonl');
  const records: Observation[] = existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
  for (const record of records) profiles.add(record.agentDir);
  return records;
}

async function setup(scenario = 'model-public') {
  fake = createFakeOmp(scenario);
  restore = useFakeOmpEnv(fake);
  savedKey = process.env.ROX_API_KEY;
  delete process.env.ROX_API_KEY;
  connectionSlug = `omp-runtime-fixture-${crypto.randomUUID()}`;
  await getCredentialManager().setLlmApiKey(connectionSlug, 'isolated-public-runtime-fixture-key');
  const hostile = join(fake.dir, 'existing-user-profile');
  mkdirSync(hostile);
  writeFileSync(join(hostile, 'models.yml'), 'providers: existing-user-profile\n');
  writeFileSync(join(hostile, 'config.yml'), 'modelRoles: existing-user-choice\n');
  const script = join(fake.dir, 'fake-omp.js');
  const inspect = `
const fixtureFs = require('node:fs');
const fixturePath = require('node:path');
const fixtureDir = process.env.PI_CODING_AGENT_DIR;
const fixtureModels = fixtureFs.readFileSync(fixturePath.join(fixtureDir, 'models.yml'), 'utf8');
const fixtureIds = [...fixtureModels.matchAll(/- id: (.+)/g)].map(match => match[1]);
fixtureFs.appendFileSync(${JSON.stringify(join(fake.dir, 'profile-observations.jsonl'))}, JSON.stringify({ agentDir: fixtureDir, profile: process.env.OMP_PROFILE, ids: fixtureIds, secretInFile: fixtureModels.includes('isolated-public-runtime-fixture-key'), credentialMatches: process.env.ROX_API_KEY === 'isolated-public-runtime-fixture-key' }) + '\\n');
`;
  const original = readFileSync(script, 'utf8');
  // This CLI's RPC catalog comes from the actual generated file, not a fixed alias.
  writeFileSync(script, inspect + original.replace(/const availableModels = \[[\s\S]*?\n\];/, "const availableModels = fixtureIds.map(id => ({ provider: 'rox', id, name: id }));"));
  agent = new OmpAgent(makeOmpConfig(fake, {
    model: 'rox/standard', connectionSlug,
    envOverrides: { PI_CODING_AGENT_DIR: hostile, OMP_PROFILE: 'inherited-user-profile' },
  }));
  return { agent, fake, hostile };
}

afterEach(async () => {
  agent?.destroy();
  observations();
  await waitUntil(() => [...profiles].every(path => !existsSync(path)));
  profiles.clear();
  if (connectionSlug) await getCredentialManager().deleteLlmApiKey(connectionSlug);
  if (savedKey === undefined) delete process.env.ROX_API_KEY;
  else process.env.ROX_API_KEY = savedKey;
  restore?.();
  fake?.cleanup();
  agent = undefined; fake = undefined; connectionSlug = undefined; restore = undefined;
});

describe('actual OmpAgent private public catalog lifecycle', () => {
  it('uses the selected connection credential and generated exact catalog despite conflicting inherited profile', async () => {
    const { agent, fake, hostile } = await setup();
    expect((await chatEvents(agent, 'fixture turn, no provider request', 8000)).some(event => event.type === 'text_complete')).toBe(true);
    const [record] = observations();
    expect(record).toMatchObject({ ids, profile: 'default', secretInFile: false, credentialMatches: true });
    expect(record?.agentDir).not.toBe(hostile);
    expect(fake.readRpcLog().find(frame => frame.type === 'set_model')).toMatchObject({ provider: 'rox', modelId: 'rox/standard' });
    expect(fake.readRpcLog().find(frame => frame.type === 'prompt')?.observedModel).toEqual({ provider: 'rox', id: 'rox/standard' });
    expect(readFileSync(join(hostile, 'models.yml'), 'utf8')).toBe('providers: existing-user-profile\n');
    expect(readFileSync(join(hostile, 'config.yml'), 'utf8')).toBe('modelRoles: existing-user-choice\n');
    agent.destroy();
    await waitUntil(() => !!record && !existsSync(record.agentDir));
  });

  it('keeps the successor profile when the predecessor close disposer arrives after actual respawn', async () => {
    const { agent, fake } = await setup();
    await chatEvents(agent, 'first fixture turn', 8000);
    const predecessor = (agent as unknown as { subprocess: ChildProcess }).subprocess;
    const [lateClose] = predecessor.rawListeners('close');
    if (!lateClose) throw new Error('Expected child-scoped runtime disposer');
    predecessor.removeListener('close', lateClose);
    const first = observations()[0]!;
    await agent.reconnect();
    await chatEvents(agent, 'successor fixture turn', 8000);
    const second = observations()[1]!;
    expect(first.agentDir).not.toBe(second.agentDir);
    expect(existsSync(first.agentDir)).toBe(true);
    expect(existsSync(second.agentDir)).toBe(true);
    lateClose.call(predecessor, 0, null);
    expect(existsSync(first.agentDir)).toBe(false);
    expect(existsSync(second.agentDir)).toBe(true);
    expect(fake.readRpcLog().filter(frame => frame.type === 'prompt').map(frame => frame.observedModel)).toEqual([
      { provider: 'rox', id: 'rox/standard' }, { provider: 'rox', id: 'rox/standard' },
    ]);
    agent.destroy();
    await waitUntil(() => !existsSync(second.agentDir));
  });

  it('removes the private profile after an actual pre-ready child failure', async () => {
    const { agent, fake } = await setup('exit-generic');
    const events = await chatEvents(agent, 'must not execute', 8000);
    expect(events.some(event => event.type === 'error')).toBe(true);
    expect(fake.readRpcLog().filter(frame => frame.type === 'prompt')).toHaveLength(0);
    const [record] = observations();
    expect(record?.ids).toEqual(ids);
    await waitUntil(() => !!record && !existsSync(record.agentDir));
  });
});
