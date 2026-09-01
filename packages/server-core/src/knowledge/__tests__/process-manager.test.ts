import { describe, expect, it } from 'bun:test'
import { parseOemKernelPin } from '@craft-agent/shared/knowledge/oem-pin'
import { SiyuanProcessManager } from '../process-manager'

const pin = parseOemKernelPin({
  version: '3.1.28-rox.1',
  sha256: {
    'darwin-arm64': 'a'.repeat(64),
    'darwin-x64': 'b'.repeat(64),
    'linux-x64': 'c'.repeat(64),
    'win32-x64': 'd'.repeat(64),
  },
  relativePayloadDir: 'resources/oem-kernel',
  minApi: '3.0.0',
  maxApiExclusive: '4.0.0',
})

type TestHeadersInit = ConstructorParameters<typeof Headers>[0]

function headerGet(headers: TestHeadersInit | undefined, name: string): string | null {
  if (!headers) return null
  if (headers instanceof Headers) return headers.get(name)
  if (Array.isArray(headers)) {
    const row = headers.find(([k]) => k.toLowerCase() === name.toLowerCase())
    return row?.[1] ?? null
  }
  const rec = headers as Record<string, string>
  const key = Object.keys(rec).find((k) => k.toLowerCase() === name.toLowerCase())
  return key ? rec[key] : null
}

describe('SiyuanProcessManager', () => {
  it('fails closed when G2 is not C', async () => {
    const pm = new SiyuanProcessManager()
    await expect(
      pm.start({
        configDir: '/tmp/cfg',
        connectionId: 'c1',
        g2AcceptedVariant: null,
        pin,
        resolveBinary: () => '/bin/true',
        spawnFn: () => {
          throw new Error('should not spawn')
        },
        allocatePort: () => 19200,
        readyTimeoutMs: 0,
      }),
    ).rejects.toMatchObject({ code: 'G2_BLOCKED' })
    expect(pm.status().running).toBe(false)
  })

  it('spawns on ephemeral port with G2=C', async () => {
    const kids: Array<{ pid: number; killed?: string }> = []
    const pm = new SiyuanProcessManager()
    const inst = await pm.start({
      configDir: '/tmp/cfg',
      connectionId: 'c1',
      g2AcceptedVariant: 'C',
      pin,
      resolveBinary: () => '/fake/kernel',
      allocatePort: () => 19201,
      readyTimeoutMs: 0,
      spawnFn: (cmd, args, opts) => {
        expect(cmd).toBe('/fake/kernel')
        expect(args.some((a) => a.startsWith('--wd=') && a.includes('/fake'))).toBe(true)
        expect(args.some((a) => a.includes('19201'))).toBe(true)
        expect(args.some((a) => a.includes('6806'))).toBe(false)
        expect(opts.cwd).toBe('/fake')
        expect(opts.cwd).not.toContain('knowledge-workspaces')
        return {
          pid: 4242,
          unref() {},
          on() {},
          kill(sig?: string) {
            kids.push({ pid: 4242, killed: sig })
          },
        }
      },
    })
    expect(inst.port).toBe(19201)
    expect(inst.baseUrl).toBe('http://127.0.0.1:19201')
    expect(inst.workspacePath).toContain('knowledge-workspaces/c1')
    await pm.stop({ graceMs: 0 })
    expect(kids[0]?.killed).toBe('SIGTERM')
  })

  it('marks KERNEL_CRASHED after five exits', async () => {
    const pm = new SiyuanProcessManager()
    const exitCbs: Array<(code: number | null) => void> = []
    await pm.start({
      configDir: '/tmp/cfg',
      connectionId: 'c1',
      g2AcceptedVariant: 'C',
      pin,
      resolveBinary: () => '/fake/kernel',
      allocatePort: () => 19202,
      readyTimeoutMs: 0,
      spawnFn: () => ({
        pid: 7,
        unref() {},
        on(_ev: 'exit', cb: (code: number | null) => void) {
          exitCbs.push(cb)
        },
        kill() {},
      }),
    })
    for (let i = 0; i < 5; i++) {
      const cb = exitCbs[exitCbs.length - 1]
      cb?.(1)
    }
    expect(pm.status().running).toBe(false)
    expect(pm.status().error).toBe('KERNEL_CRASHED')
  })

  it('seeds default notebook when kernel reports none', async () => {
    const pm = new SiyuanProcessManager()
    const called: string[] = []
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      called.push(url)
      if (url.endsWith('/api/system/version')) {
        return new Response(JSON.stringify({ code: 0, data: '3.1.28' }), { status: 200 })
      }
      if (url.endsWith('/api/notebook/lsNotebooks')) {
        expect(headerGet(init?.headers, 'Authorization')?.startsWith('Token ')).toBe(true)
        return new Response(JSON.stringify({ code: 0, data: { notebooks: [] } }), { status: 200 })
      }
      if (url.endsWith('/api/notebook/createNotebook')) {
        expect(headerGet(init?.headers, 'Authorization')?.startsWith('Token ')).toBe(true)
        expect(JSON.parse(String(init?.body))).toEqual({ name: 'Знания' })
        return new Response(JSON.stringify({ code: 0, data: {} }), { status: 200 })
      }
      throw new Error(`unexpected url ${url}`)
    }) as unknown as typeof fetch
    await pm.start({
      configDir: '/tmp/cfg',
      connectionId: 'c1',
      g2AcceptedVariant: 'C',
      pin,
      resolveBinary: () => '/fake/kernel',
      allocatePort: () => 19203,
      readyTimeoutMs: 5000,
      fetchImpl,
      spawnFn: () => ({
        pid: 9,
        unref() {},
        on() {},
        kill() {},
      }),
    })
    expect(called.some((url) => url.includes('/api/notebook/createNotebook'))).toBe(true)
    await pm.stop({ graceMs: 0 })
  })

  it('does not create notebook when lsNotebooks is non-empty', async () => {
    const pm = new SiyuanProcessManager()
    const called: string[] = []
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      called.push(url)
      if (url.endsWith('/api/system/version')) {
        return new Response(JSON.stringify({ code: 0, data: '3.1.28' }), { status: 200 })
      }
      if (url.endsWith('/api/notebook/lsNotebooks')) {
        expect(headerGet(init?.headers, 'Authorization')?.startsWith('Token ')).toBe(true)
        return new Response(JSON.stringify({ code: 0, data: { notebooks: [{ id: 'n1' }] } }), { status: 200 })
      }
      throw new Error(`unexpected url ${url}`)
    }) as unknown as typeof fetch
    await pm.start({
      configDir: '/tmp/cfg',
      connectionId: 'c1',
      g2AcceptedVariant: 'C',
      pin,
      resolveBinary: () => '/fake/kernel',
      allocatePort: () => 19204,
      readyTimeoutMs: 5000,
      fetchImpl,
      spawnFn: () => ({
        pid: 9,
        unref() {},
        on() {},
        kill() {},
      }),
    })
    expect(called.some((url) => url.includes('/api/notebook/createNotebook'))).toBe(false)
    expect(called.some((url) => url.includes('/api/notebook/lsNotebooks'))).toBe(true)
    await pm.stop({ graceMs: 0 })
  })

})
