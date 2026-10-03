import { setRoxAccountAuthority, LOCAL_ROX_CALLER } from '../../auth/rox-account-authority.ts';
import { createPocketFixture, pocketSnapshot } from '../../auth/__tests__/pocket-test-fixture.ts';
import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { OmpAgent } from '../omp-agent.ts';
import { getCredentialManager } from '../../credentials/manager.ts';
import { chatEvents, createFakeOmp, makeOmpConfig, useFakeOmpEnv, type FakeOmp } from './omp-fake-cli.ts';

type Observation = { agentDir: string; profile: string; ids: string[]; secretInFile: boolean; credentialMatches: boolean };
const PROCESS_FIXTURE_TIMEOUT_MS = 30_000;
const ids = ['rox/r1-max', 'rox/explore', 'rox/standard', 'rox/max', 'rox/vision', 'rox/fast'];
let fake: FakeOmp | undefined;
let agent: OmpAgent | undefined;
let restore: (() => void) | undefined;
let connectionSlug: string | undefined;
let savedKey: string | undefined;
const profiles = new Set<string>();

async function waitUntil(predicate: () => boolean) {
  const deadline = Date.now() + 8000;
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

async function setup(scenario = 'model-public', model = 'rox/standard') {
  fake = createFakeOmp(scenario);
  restore = useFakeOmpEnv(fake);
  savedKey = process.env.ROX_API_KEY;
  delete process.env.ROX_API_KEY;
  connectionSlug = `omp-runtime-fixture-${crypto.randomUUID()}`;
  await getCredentialManager().setLlmApiKey(connectionSlug, 'wrong-connection-fixture-key');
  const pocket = createPocketFixture();
  await pocket.authority.start(LOCAL_ROX_CALLER);
  await pocket.authority.state(LOCAL_ROX_CALLER);
  setRoxAccountAuthority(pocket.authority);
  const roxExecutionContext = await pocket.authority.capture(LOCAL_ROX_CALLER);
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
fixtureFs.appendFileSync(${JSON.stringify(join(fake.dir, 'profile-observations.jsonl'))}, JSON.stringify({ agentDir: fixtureDir, profile: process.env.OMP_PROFILE, ids: fixtureIds, secretInFile: fixtureModels.includes('account-key-fixture'), credentialMatches: process.env.ROX_API_KEY === 'account-key-fixture' }) + '\\n');
`;
  const original = readFileSync(script, 'utf8');
  // This CLI's RPC catalog comes from the actual generated file, not a fixed alias.
  writeFileSync(script, inspect + original.replace(/const availableModels = \[[\s\S]*?\n\];/, "const availableModels = fixtureIds.map(id => ({ provider: 'rox', id, name: id }));"));
  agent = new OmpAgent(makeOmpConfig(fake, {
    model, connectionSlug, roxExecutionContext,
    envOverrides: { PI_CODING_AGENT_DIR: hostile, OMP_PROFILE: 'inherited-user-profile', ROX_API_KEY: 'wrong-session-env-fixture-key', ROX_BASE_URL: 'https://wrong.example.test/v1' },
  }));
  return { agent, fake, hostile, pocket };
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
  it('confirms the R1 Max provider/model before executing a new default-model turn', async () => {
    const { agent, fake } = await setup('model-public', 'rox/r1-max');
    const events = await chatEvents(agent, 'default-model fixture turn', PROCESS_FIXTURE_TIMEOUT_MS);
    expect(events.some(event => event.type === 'text_complete')).toBe(true);
    expect(fake.readRpcLog().find(frame => frame.type === 'set_model'))
      .toMatchObject({ provider: 'rox', modelId: 'rox/r1-max' });
    expect(fake.readRpcLog().find(frame => frame.type === 'prompt')?.observedModel)
      .toEqual({ provider: 'rox', id: 'rox/r1-max' });
  }, 60_000);
  it('uses trusted account key after final environment assembly despite wrong ambient/connection/session keys', async () => {
    const { agent, fake, hostile } = await setup();
    expect((await chatEvents(agent, 'fixture turn, no provider request', PROCESS_FIXTURE_TIMEOUT_MS)).some(event => event.type === 'text_complete')).toBe(true);
    const [record] = observations();
    expect(record).toMatchObject({ ids, profile: 'default', secretInFile: false, credentialMatches: true });
    expect(record?.agentDir).not.toBe(hostile);
    expect(fake.readRpcLog().find(frame => frame.type === 'set_model')).toMatchObject({ provider: 'rox', modelId: 'rox/standard' });
    expect(fake.readRpcLog().find(frame => frame.type === 'prompt')?.observedModel).toEqual({ provider: 'rox', id: 'rox/standard' });
    expect(readFileSync(join(hostile, 'models.yml'), 'utf8')).toBe('providers: existing-user-profile\n');
    expect(readFileSync(join(hostile, 'config.yml'), 'utf8')).toBe('modelRoles: existing-user-choice\n');
    agent.destroy();
    await waitUntil(() => !!record && !existsSync(record.agentDir));
  }, 60_000);

  it('keeps the successor profile when the predecessor close disposer arrives after actual respawn', async () => {
    const { agent, fake } = await setup();
    await chatEvents(agent, 'first fixture turn', PROCESS_FIXTURE_TIMEOUT_MS);
    const predecessor = (agent as unknown as { subprocess: ChildProcess }).subprocess;
    const [lateClose] = predecessor.rawListeners('close');
    if (!lateClose) throw new Error('Expected child-scoped runtime disposer');
    predecessor.removeListener('close', lateClose);
    const first = observations()[0]!;
    await agent.reconnect();
    await chatEvents(agent, 'successor fixture turn', PROCESS_FIXTURE_TIMEOUT_MS);
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
  }, 60_000);

  it('removes the private profile after an actual pre-ready child failure', async () => {
    const { agent, fake } = await setup('exit-generic');
    const events = await chatEvents(agent, 'must not execute', PROCESS_FIXTURE_TIMEOUT_MS);
    expect(events.some(event => event.type === 'error')).toBe(true);
    expect(fake.readRpcLog().filter(frame => frame.type === 'prompt')).toHaveLength(0);
    const [record] = observations();
    expect(record?.ids).toEqual(ids);
    await waitUntil(() => !!record && !existsSync(record.agentDir));
  }, 60_000);
  it('runs actual mini/title and call_llm children with the account key and aborts old identity after logout', async () => {
    const { agent, pocket } = await setup();
    expect(await agent.runMiniCompletion('title fixture')).toContain('title fixture');
    expect((await agent.queryLlm({ prompt: 'call fixture', model: 'rox/fast' })).text).toContain('call fixture');
    expect(observations()).toHaveLength(2);
    expect(observations().every(record => record.credentialMatches && !record.secretInFile)).toBe(true);
    await pocket.authority.logout(LOCAL_ROX_CALLER);
    await expect(agent.queryLlm({ prompt: 'stale call', model: 'rox/fast' })).rejects.toThrow('ROX_ACCOUNT_CHANGED');
    expect(observations()).toHaveLength(2);
  }, 60_000);
  it('never dispatches zero balance or ownerless public executions', async () => {
    const { agent, pocket, fake } = await setup();
    pocket.setSnapshot({ ...pocketSnapshot(), balance: { currency: 'ROX', balanceRox: '0.000000', availableRox: '0.000000', heldRox: '0.000000', bonusStatus: 'pending' } });
    expect((await chatEvents(agent, 'zero budget', PROCESS_FIXTURE_TIMEOUT_MS)).some(event => event.type === 'error')).toBe(true);
    expect(fake.readArgvLog()).toHaveLength(0);
    const unbound = new OmpAgent(makeOmpConfig(fake, { model: 'rox/standard' }));
    expect((await chatEvents(unbound, 'ownerless', PROCESS_FIXTURE_TIMEOUT_MS)).some(event => event.type === 'error')).toBe(true);
    expect(fake.readArgvLog()).toHaveLength(0);
    unbound.destroy();
  }, 60_000);

  it('kills an actual in-flight one-shot at logout and never accepts its delayed result', async () => {
    const { agent, pocket, fake } = await setup();
    const script = join(fake.dir, 'fake-omp.js');
    const source = readFileSync(script, 'utf8');
    // The profile inspector is before this delayed fake invocation, so the test
    // observes actual process creation before switching identity.
    writeFileSync(script, source.replace("'use strict';", "if (process.argv.includes('-p')) { setTimeout(() => { process.stdout.write('late account response'); process.exit(0); }, 500); process.stdin.resume(); return; }\n'use strict';"));
    const pending = agent.queryLlm({ prompt: 'slow fixture', model: 'rox/fast' });
    await waitUntil(() => observations().length === 1);
    await pocket.authority.logout(LOCAL_ROX_CALLER);
    await expect(pending).rejects.toThrow();
    expect(observations()).toHaveLength(1);
  }, 60_000);

  it('redacts a personal key echoed by an actual child from debug logs and one-shot errors', async () => {
    const { agent, fake } = await setup();
    const script = join(fake.dir, 'fake-omp.js');
    const source = readFileSync(script, 'utf8');
    writeFileSync(script, source.replace("'use strict';", "process.stderr.write(process.env.ROX_API_KEY + '\\n'); if (process.argv.includes('-p')) process.exit(1);\n'use strict';"));
    const logs: string[] = []; agent.onDebug = message => logs.push(message);
    expect((await chatEvents(agent, 'redaction fixture', PROCESS_FIXTURE_TIMEOUT_MS)).some(event => event.type === 'text_complete')).toBe(true);
    const result = await agent.queryLlm({ prompt: 'redaction fixture', model: 'rox/fast' }).then(() => '', error => String(error));
    expect(result).toContain('REDACTED');
    expect(result).not.toContain('account-key-fixture');
    expect(logs.join('\n')).toContain('REDACTED');
    expect(logs.join('\n')).not.toContain('account-key-fixture');
  }, 60_000);

  it('cleans prepared runtime artifacts when logout occurs immediately before dispatch', async () => {
    const { agent, fake, pocket } = await setup();
    const seam = agent as unknown as { prepareNativeInvocation: (bin: string, env: NodeJS.ProcessEnv) => Promise<{ bin: string; prefix: string[]; dispose(): void }> };
    const prepare = seam.prepareNativeInvocation.bind(agent);
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve });
    let profile: string | undefined;
    seam.prepareNativeInvocation = async (bin, env) => {
      const invocation = await prepare(bin, env);
      profile = env.PI_CODING_AGENT_DIR;
      await barrier;
      return invocation;
    };
    const pending = agent.queryLlm({ prompt: 'fenced preparation', model: 'rox/fast' });
    await waitUntil(() => !!profile);
    await pocket.authority.logout(LOCAL_ROX_CALLER);
    release();
    await expect(pending).rejects.toThrow('ROX_ACCOUNT_CHANGED');
    expect(fake.readArgvLog()).toHaveLength(0);
    expect(existsSync(profile!)).toBe(false);
  }, 60_000);

});
