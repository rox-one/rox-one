import { afterEach, describe, expect, test } from 'bun:test'
import { spawn } from 'child_process'
import { CogneeGraphProvider } from '../cognee-provider'

const FAKE = `
const rl = require('readline').createInterface({ input: process.stdin })
const docs = []
rl.on('line', l => {
  const r = JSON.parse(l)
  const send = o => process.stdout.write(JSON.stringify(o) + '\\n')
  if (r.method === 'hello') return send({ id: r.id, result: { protocol: 1 } })
  if (r.method === 'status') return send({ id: r.id, result: { documents: docs.length } })
  if (r.method === 'add') { docs.push(...r.params.docs); return send({ id: r.id, result: { added: r.params.docs.length } }) }
  if (r.method === 'search') return send({ id: r.id, result: docs.filter(d => d.text.includes(r.params.query)).map(d => ({ id: d.id, source: d.source, text: d.text, score: 1 })) })
  if (r.method === 'env') return send({ id: r.id, result: { key: process.env.ROX_COGNEE_LLM_API_KEY, root: process.env.ROX_COGNEE_ROOT } })
  if (r.method === 'shutdown') { send({ id: r.id, result: { ok: true } }); process.exit(0) }
  send({ id: r.id, error: { code: 'unknown_method' } })
})
`

const providers: CogneeGraphProvider[] = []
afterEach(() => {
  for (const p of providers.splice(0)) p.shutdown()
})

function make(over: Partial<ConstructorParameters<typeof CogneeGraphProvider>[0]> = {}) {
  const warns: string[] = []
  const p = new CogneeGraphProvider({
    workspaceId: 'ws1',
    storageDir: '/tmp/rox-cognee-test/ws1',
    ensureRuntime: async () => ({ python: process.execPath }),
    resolveLlmKey: async () => 'SECRET-KEY-123',
    spawnFn: (cmd, _args, env) => spawn(cmd, ['-e', FAKE], { env, stdio: ['pipe', 'pipe', 'pipe'] }),
    logger: { warn: (m: string, e?: unknown) => { warns.push(`${m} ${String(e)}`) } },
    ...over,
  })
  providers.push(p)
  return { p, warns }
}

const prov = (originClass: 'owner' | 'untrusted') => ({ originClass, sessionKind: 'interactive' as const, observedAt: '2026-10-14T00:00:00Z' })

describe('CogneeGraphProvider', () => {
  test('cold search returns [] immediately and warms in background', async () => {
    const { p } = make()
    expect(p.status().state).toBe('cold')
    expect(await p.search('x')).toEqual([])
    expect(await p.warm()).toBe(true)
    expect(p.status().state).toBe('ready')
  })

  test('ingest drops untrusted docs; search returns agent-provenance hits', async () => {
    const { p } = make()
    await p.ingest([
      { id: 'a', source: 'notes', text: 'buildkite deploys', provenance: prov('owner') },
      { id: 'b', source: 'mail', text: 'buildkite phishing', provenance: prov('untrusted') },
    ])
    const hits = await p.search('buildkite')
    expect(hits.map(h => h.id)).toEqual(['a'])
    expect(hits[0]!.provenance.originClass).toBe('agent')
  })

  test('key and storage go via child env only, never into status or logs', async () => {
    const { p, warns } = make()
    await p.warm()
    const env = (await (p as unknown as { request: (m: string, x: object) => Promise<{ key: string; root: string }> }).request('env', {}))
    expect(env.key).toBe('SECRET-KEY-123')
    expect(env.root).toBe('/tmp/rox-cognee-test/ws1')
    expect(JSON.stringify(p.status())).not.toContain('SECRET')
    expect(warns.join('\n')).not.toContain('SECRET')
  })

  test('missing runtime -> not_installed, search stays empty', async () => {
    const { p } = make({ ensureRuntime: async () => ({ python: null, reason: 'not_installed' as const }) })
    expect(await p.warm()).toBe(false)
    expect(p.status().state).toBe('not_installed')
    expect(await p.search('x')).toEqual([])
  })

  test('disabled toggle short-circuits everything', async () => {
    let spawned = 0
    const { p } = make({ isEnabled: () => false, spawnFn: () => { spawned++; throw new Error('no') } })
    expect(p.status().state).toBe('disabled')
    await p.ingest([{ id: 'a', source: 'notes', text: 't', provenance: prov('owner') }])
    expect(await p.search('t')).toEqual([])
    expect(spawned).toBe(0)
  })

  test('idle shutdown, then restart on next use', async () => {
    const { p } = make({ idleMs: 50 })
    await p.warm()
    await new Promise(r => setTimeout(r, 400))
    expect(p.status().state).toBe('cold')
    expect(await p.warm()).toBe(true)
  })

  test('unsupported runtime surfaces failed status, not not_installed', async () => {
    const { p } = make({
      ensureRuntime: async () => ({ python: null, reason: 'unsupported' as const, detail: 'win32-arm64' }),
    })
    expect(await p.warm()).toBe(false)
    expect(p.status().state).toBe('failed')
    expect(p.status().safeError).toContain('unsupported')
  })

  test('crashing sidecar fails soft', async () => {
    const { p } = make({ spawnFn: (cmd, _a, env) => spawn(cmd, ['-e', 'process.exit(3)'], { env, stdio: ['pipe', 'pipe', 'pipe'] }) })
    expect(await p.warm()).toBe(false)
    expect(p.status().state).toBe('failed')
  })
})
