import { expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import { OmpAgent } from '../omp-agent.ts'
import { createFakeOmp, useFakeOmpEnv, makeOmpConfig, chatEvents } from './omp-fake-cli.ts'
import { createPocketFixture } from '../../auth/__tests__/pocket-test-fixture.ts'
import { setRoxAccountAuthority, LOCAL_ROX_CALLER } from '../../auth/rox-account-authority.ts'

async function fixture(delayed = false) {
  const fake = createFakeOmp('model-public')
  const restore = useFakeOmpEnv(fake)
  // Private models require an existing provider catalog. Own that prerequisite
  // instead of depending on the developer's ~/.omp or the CI runner's home.
  const privateHome = join(fake.dir, 'private-home')
  const privateAgentDir = join(privateHome, '.omp', 'agent')
  mkdirSync(privateAgentDir, { recursive: true })
  const privateModels = 'providers:\n  rox:\n    baseUrl: https://private.example.test/v1\n    apiKey: ROX_API_KEY\n    models:\n      - id: kimi-k3\n'
  writeFileSync(join(privateAgentDir, 'models.yml'), privateModels)
  const savedHome = process.env.HOME
  const savedUserProfile = process.env.USERPROFILE
  process.env.HOME = privateHome
  process.env.USERPROFILE = privateHome
  const restoreFixture = () => {
    if (savedHome === undefined) delete process.env.HOME
    else process.env.HOME = savedHome
    if (savedUserProfile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = savedUserProfile
    restore(); fake.cleanup()
  }
  try {
    const script = join(fake.dir, 'fake-omp.js')
    let source = readFileSync(script, 'utf8').replace('function logRpc(obj) {', `function logRpc(obj) {
      if (obj.type === 'prompt') {
        obj.personalCredentialMatches = process.env.ROX_API_KEY === 'account-key-fixture';
        obj.privateCredentialMatches = process.env.ROX_API_KEY === 'wrong-session-fixture-key';
        obj.canonicalBase = process.env.ROX_BASE_URL === 'https://api.rox.one/v1';
        const models = fs.readFileSync(require('node:path').join(process.env.PI_CODING_AGENT_DIR, 'models.yml'), 'utf8');
        obj.publicCatalog = models.includes('- id: rox/r1-max');
      }`)
    if (delayed) source = source.replace('emitTurnStream();', 'setTimeout(emitTurnStream, 500);')
    writeFileSync(script, source)
    const pocket = createPocketFixture()
    await pocket.authority.start(LOCAL_ROX_CALLER)
    await pocket.authority.state(LOCAL_ROX_CALLER)
    setRoxAccountAuthority(pocket.authority)
    const agent = new OmpAgent(makeOmpConfig(fake, {
      model: 'kimi-k3', roxExecutionContext: await pocket.authority.capture(LOCAL_ROX_CALLER),
      envOverrides: { PI_CODING_AGENT_DIR: privateAgentDir, ROX_API_KEY: 'wrong-session-fixture-key', ROX_BASE_URL: 'https://wrong.example.test/v1' },
    }))
    const children: ChildProcess[] = []
    const observeChild = () => { const child = (agent as any).subprocess as ChildProcess | null; if (child && !children.includes(child)) children.push(child) }
    return { fake, agent, observeChild, privateAgentDir, privateModels, async cleanup() {
      observeChild(); agent.destroy()
      try {
        await Promise.all(children.map(child => child.exitCode !== null || child.signalCode ? Promise.resolve() : new Promise<void>(resolve => child.once('exit', () => resolve()))))
      } finally {
        restoreFixture()
      }
    } }
  } catch (error) {
    restoreFixture()
    throw error
  }
}

test('actual OmpAgent respawns in both credential/catalog directions and preserves each domain key', async () => {
  const f = await fixture()
  try {
    expect((await chatEvents(f.agent, 'private first', 30_000)).some(e => e.type === 'text_complete')).toBe(true)
    f.observeChild(); f.agent.setModel('rox/standard')
    expect((await chatEvents(f.agent, 'public second', 30_000)).some(e => e.type === 'text_complete')).toBe(true)
    f.observeChild(); f.agent.setModel('kimi-k3')
    expect((await chatEvents(f.agent, 'private third', 30_000)).some(e => e.type === 'text_complete')).toBe(true)
    f.observeChild()
    const prompts = f.fake.readRpcLog().filter(frame => frame.type === 'prompt')
    expect(prompts.map(p => [p.personalCredentialMatches, p.privateCredentialMatches, p.canonicalBase, p.publicCatalog])).toEqual([
      [false, true, false, false], [true, false, true, true], [false, true, false, false],
    ])
    expect(readFileSync(join(f.privateAgentDir, 'models.yml'), 'utf8')).toBe(f.privateModels)
    expect(f.fake.readArgvLog()).toHaveLength(3)
  } finally { await f.cleanup() }
}, 120_000)

test('actual in-flight credential-domain switch retires old child and ignores its delayed stream', async () => {
  const f = await fixture(true)
  try {
    const first = chatEvents(f.agent, 'old delayed private turn', 30_000)
    const deadline = Date.now() + 20_000
    while (!f.fake.readRpcLog().some(frame => frame.type === 'prompt')) {
      if (Date.now() > deadline) throw Error('old prompt did not dispatch')
      await Bun.sleep(5)
    }
    f.observeChild(); f.agent.setModel('rox/standard')
    const oldEvents = await first
    expect(oldEvents.some(e => e.type === 'text_complete')).toBe(false)
    const next = await chatEvents(f.agent, 'fresh public turn', 30_000)
    f.observeChild()
    expect(next.some(e => e.type === 'text_complete')).toBe(true)
    expect(f.fake.readRpcLog().filter(frame => frame.type === 'prompt')[1]).toMatchObject({ personalCredentialMatches: true, canonicalBase: true, publicCatalog: true })
    expect(f.fake.readArgvLog()).toHaveLength(2)
  } finally { await f.cleanup() }
}, 90_000)

test('credential-domain switch during asynchronous native preparation never spawns its obsolete profile', async () => {
  const f = await fixture()
  try {
    const { existsSync } = await import('node:fs')
    const original = (f.agent as any).prepareNativeInvocation.bind(f.agent)
    let entered!: () => void, release!: () => void
    const preparing = new Promise<void>(resolve => { entered = resolve })
    const blocked = new Promise<void>(resolve => { release = resolve })
    let oldProfile = '', once = true
    ;(f.agent as any).prepareNativeInvocation = async (...args: any[]) => {
      if (once) { once = false; oldProfile = args[1].PI_CODING_AGENT_DIR; entered(); await blocked }
      return original(...args)
    }
    const old = chatEvents(f.agent, 'private preparation pending', 30_000)
    await preparing
    f.agent.setModel('rox/standard'); release()
    expect((await old).some(event => event.type === 'text_complete')).toBe(false)
    expect(existsSync(oldProfile)).toBe(false)
    expect(f.fake.readArgvLog()).toHaveLength(0)
    expect((await chatEvents(f.agent, 'fresh public preparation', 30_000)).some(event => event.type === 'text_complete')).toBe(true)
    f.observeChild()
    expect(f.fake.readArgvLog()).toHaveLength(1)
    expect(f.fake.readRpcLog().find(frame => frame.type === 'prompt')).toMatchObject({ personalCredentialMatches: true, canonicalBase: true, publicCatalog: true })
  } finally { await f.cleanup() }
}, 60_000)

test('one-shot helper preparation crossing a credential domain never spawns or returns its obsolete profile', async () => {
  const f = await fixture()
  try {
    const { existsSync } = await import('node:fs')
    const original = (f.agent as any).prepareNativeInvocation.bind(f.agent)
    let entered!: () => void, release!: () => void
    const preparing = new Promise<void>(resolve => { entered = resolve })
    const blocked = new Promise<void>(resolve => { release = resolve })
    let oldProfile = ''
    ;(f.agent as any).prepareNativeInvocation = async (...args: any[]) => {
      oldProfile = args[1].PI_CODING_AGENT_DIR; entered(); await blocked
      return original(...args)
    }
    const helper = f.agent.runMiniCompletion('obsolete helper preparation')
    await preparing; f.agent.setModel('rox/standard'); release()
    expect(await helper).toBeNull()
    expect(f.fake.readArgvLog()).toHaveLength(0)
    expect(existsSync(oldProfile)).toBe(false)
  } finally { await f.cleanup() }
}, 60_000)

test('credential-domain crossing retires an already-dispatched one-shot helper and refuses its late stdout', async () => {
  const f = await fixture()
  try {
    const script = join(f.fake.dir, 'fake-omp.js')
    const source = readFileSync(script, 'utf8')
    const output = source.split('\n').find(line => line.includes("fs.writeSync(1, 'fake-omp answer:"))
    if (!output) throw new Error('Expected actual one-shot output seam')
    writeFileSync(script, source.replace(output, "setTimeout(() => { " + output + " process.exit(0); }, 800); return;") )
    const helper = f.agent.runMiniCompletion('obsolete running helper')
    const deadline = Date.now() + 20_000
    while (f.fake.readArgvLog().length === 0) {
      if (Date.now() > deadline) throw new Error('Expected actual one-shot dispatch')
      await Bun.sleep(5)
    }
    expect((f.agent as any).oneShotChildren.size).toBe(1)
    f.agent.setModel('rox/standard')
    expect(await helper).toBeNull()
    expect(f.fake.readArgvLog()).toHaveLength(1)
    expect((f.agent as any).oneShotChildren.size).toBe(0)
  } finally { await f.cleanup() }
}, 60_000)
