/**
 * Cookbooks runtime — cancel / export plumbing (SPEC wave 9 §1, §3).
 *
 * Mirrors `cookbooks-runtime.test.ts`: a real loopback `Bun.serve` stands in
 * for the sidecar's JSON surface and the runtime is driven to `running` through
 * its injected fake spawn, so these assertions exercise the real client
 * (bearer token, budget, error mapping) rather than a mock of it.
 *
 * `exportNotebook` never touches Electron here — its dialog/fs are injected.
 */
import { describe, expect, it } from 'bun:test'
import {
  CookbooksRuntime,
  type CookbooksChild,
  type CookbooksExportDeps,
  type CookbooksSaveDialogOptions,
} from '../cookbooks-runtime'
import { CookbooksApiError } from '../../shared/cookbooks'

const TOKEN = 'A'.repeat(32)
const line = (port: number, token = TOKEN) => `http://127.0.0.1:${port}/lab.html?token=${token}\n`
const tick = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve()
}

/** Minimal child stand-in — same shape as the runtime test suite's fake. */
class FakeChild implements CookbooksChild {
  pid = Math.floor(Math.random() * 1e5)
  autoExitOnKill = true
  private out: Array<(c: string) => void> = []
  private exits: Array<(code: number | null) => void> = []
  signals: Array<string | undefined> = []
  stdout = { on: (_e: 'data', cb: (c: Buffer | string) => void) => { this.out.push(cb) } }
  stderr = { on: (_e: 'data', _cb: (c: Buffer | string) => void) => {} }
  on(_e: 'exit', cb: (code: number | null) => void) { this.exits.push(cb) }
  kill(signal?: string) {
    this.signals.push(signal)
    if (this.autoExitOnKill) this.exit(137)
    return true
  }
  emit(s: string) { for (const cb of this.out) cb(s) }
  exit(code: number | null) { const e = this.exits; this.exits = []; for (const cb of e) cb(code) }
}

interface CancelCall {
  itemId: string
  body: Record<string, unknown>
  authorization: string | null
}

function startStub(handlers: {
  cancel?: (body: Record<string, unknown>) => Response
  run?: (body: Record<string, unknown>) => Response
  runAll?: (body: Record<string, unknown>) => Response
} = {}) {
  const requests: Array<{ path: string; authorization: string | null }> = []
  const cancels: CancelCall[] = []
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      requests.push({ path: url.pathname, authorization: request.headers.get('authorization') })
      if (request.headers.get('authorization') !== `Bearer ${TOKEN}`) {
        return Response.json({ error: 'unauthorized' }, { status: 401 })
      }
      switch (url.pathname) {
        case '/cancel': {
          const body = (await request.json()) as Record<string, unknown>
          cancels.push({ itemId: String(body.itemId), body, authorization: request.headers.get('authorization') })
          return handlers.cancel?.(body) ?? Response.json({ ok: true, cancelled: 1 })
        }
        case '/run': {
          const body = (await request.json()) as Record<string, unknown>
          return handlers.run?.(body) ?? Response.json({ ok: true, stdout: '' })
        }
        case '/run-all': {
          const body = (await request.json()) as Record<string, unknown>
          return handlers.runAll?.(body) ?? Response.json({ ok: true, cells: [] })
        }
        default:
          return Response.json({ error: 'not found' }, { status: 404 })
      }
    },
  })
  const port = server.port
  if (port === undefined) throw new Error('stub sidecar did not bind a port')
  return { port, requests, cancels, stop: () => server.stop(true) }
}

/** Build a runtime on the fake spawn and drive it to `running` on `port`. */
async function runtimeOnPort(
  port: number,
  options: Partial<ConstructorParameters<typeof CookbooksRuntime>[0]> = {},
): Promise<CookbooksRuntime> {
  const children: FakeChild[] = []
  const runtime = new CookbooksRuntime({
    spawn: () => { const child = new FakeChild(); children.push(child); return child },
    resolvePython: async () => '/usr/bin/python3',
    getCookbooksDir: () => '/res/cookbooks',
    getWorkspaceDir: () => '/ws',
    buildEnv: async () => ({ PATH: '/bin' }),
    resolveStore: async () => ({}),
    checkHealth: async () => true,
    ...options,
  })
  const ready = runtime.ensure()
  await tick()
  children[0].emit(line(port))
  await ready
  return runtime
}

describe('CookbooksRuntime cancel', () => {
  it('POSTs {itemId} to /cancel and maps {ok, cancelled}', async () => {
    const stub = startStub({ cancel: () => Response.json({ ok: true, cancelled: 3 }) })
    const runtime = await runtimeOnPort(stub.port)
    try {
      expect(await runtime.apiCancel('probe-item')).toEqual({ ok: true, cancelled: 3 })
      expect(stub.cancels).toEqual([
        {
          itemId: 'probe-item',
          body: { itemId: 'probe-item' },
          authorization: `Bearer ${TOKEN}`,
        },
      ])
    } finally {
      await runtime.stop()
      stub.stop()
    }
  })

  it('reports cancelled:0 for an idempotent no-op answer', async () => {
    const stub = startStub({ cancel: () => Response.json({ ok: true, cancelled: 0 }) })
    const runtime = await runtimeOnPort(stub.port)
    try {
      expect(await runtime.apiCancel('probe-item')).toEqual({ ok: true, cancelled: 0 })
    } finally {
      await runtime.stop()
      stub.stop()
    }
  })

  it('normalises a malformed cancelled field to 0 and ok to false', async () => {
    const stub = startStub({ cancel: () => Response.json({ cancelled: 'nope' }) })
    const runtime = await runtimeOnPort(stub.port)
    try {
      expect(await runtime.apiCancel('probe-item')).toEqual({ ok: false, cancelled: 0 })
    } finally {
      await runtime.stop()
      stub.stop()
    }
  })

  it('surfaces an unknown itemId as CookbooksApiError(404)', async () => {
    const stub = startStub({ cancel: () => Response.json({ error: 'unknown itemId' }, { status: 404 }) })
    const runtime = await runtimeOnPort(stub.port)
    try {
      const err = await runtime.apiCancel('missing').catch((e: unknown) => e)
      expect(err).toBeInstanceOf(CookbooksApiError)
      expect((err as CookbooksApiError).status).toBe(404)
      expect((err as CookbooksApiError).message).toBe('unknown itemId')
    } finally {
      await runtime.stop()
      stub.stop()
    }
  })

  it('reports status 0 without touching the network when the runtime is not running', async () => {
    const runtime = new CookbooksRuntime({
      spawn: () => { throw new Error('must not spawn') },
      resolvePython: async () => null,
    })
    const err = await runtime.apiCancel('probe-item').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(CookbooksApiError)
    expect((err as CookbooksApiError).status).toBe(0)
    expect((err as CookbooksApiError).message).toBe('runtime not running')
  })
})

describe('CookbooksRuntime cancelled DTO pass-through', () => {
  it('passes a sidecar-side cancelled:true through apiRun', async () => {
    const stub = startStub({
      run: () => Response.json({ ok: false, stdout: '', timed_out: false, cancelled: true }),
    })
    const runtime = await runtimeOnPort(stub.port)
    try {
      expect(await runtime.apiRun('probe-item', 'import time; time.sleep(30)', 0)).toEqual({
        ok: false,
        stdout: '',
        error: null,
        timedOut: false,
        missing: [],
        // Wave 11: the runner wrote no results file for a cancelled run.
        displays: [],
        cancelled: true,
      })
    } finally {
      await runtime.stop()
      stub.stop()
    }
  })

  it('omits cancelled on a run result that predates the field', async () => {
    const stub = startStub({ run: () => Response.json({ ok: true, stdout: 'hi\n' }) })
    const runtime = await runtimeOnPort(stub.port)
    try {
      const result = await runtime.apiRun('probe-item', 'print(1)', 0)
      expect('cancelled' in result).toBe(false)
    } finally {
      await runtime.stop()
      stub.stop()
    }
  })

  it('passes the run-all top-level cancelled flag through with its cells', async () => {
    const stub = startStub({
      runAll: () =>
        Response.json({
          ok: false,
          cancelled: true,
          cells: [{ index: 0, status: 'ok', stdout: 'started\n', error: null }],
        }),
    })
    const runtime = await runtimeOnPort(stub.port)
    try {
      expect(await runtime.apiRunAll('probe-item', [{ index: 0, source: 'x' }])).toEqual({
        cells: [{ index: 0, status: 'ok', stdout: 'started\n', error: null, displays: [] }],
        cancelled: true,
      })
    } finally {
      await runtime.stop()
      stub.stop()
    }
  })

  it('omits the run-all cancelled flag when the sidecar does not send it', async () => {
    const stub = startStub({ runAll: () => Response.json({ ok: true, cells: [] }) })
    const runtime = await runtimeOnPort(stub.port)
    try {
      expect(await runtime.apiRunAll('probe-item', [])).toEqual({ cells: [] })
    } finally {
      await runtime.stop()
      stub.stop()
    }
  })
})

describe('CookbooksRuntime exportNotebook', () => {
  /** A save dialog stub that always returns the same outcome. */
  const dialogReturning = (
    result: { canceled: boolean; filePath?: string },
    seen: CookbooksSaveDialogOptions[] = [],
  ) => ({
    show: async (options: CookbooksSaveDialogOptions) => {
      seen.push(options)
      return result
    },
    seen,
  })

  it('asks with the notebook default path + ipynb filter and writes the content', async () => {
    const writes: Array<{ path: string; data: string; encoding: string }> = []
    const dialog = dialogReturning({ canceled: false, filePath: '/tmp/probe.ipynb' })
    const deps: CookbooksExportDeps = {
      showSaveDialog: dialog.show,
      writeFile: async (path, data, encoding) => { writes.push({ path, data, encoding }) },
    }
    const runtime = new CookbooksRuntime({ spawn: () => { throw new Error('must not spawn') } })

    expect(
      await runtime.exportNotebook({ itemId: 'probe-item', filename: 'probe.ipynb', content: '{}\n' }, deps),
    ).toEqual({ saved: true, path: '/tmp/probe.ipynb' })
    expect(dialog.seen).toEqual([
      { defaultPath: 'probe.ipynb', filters: [{ name: 'Jupyter Notebook', extensions: ['ipynb'] }] },
    ])
    expect(writes).toEqual([{ path: '/tmp/probe.ipynb', data: '{}\n', encoding: 'utf8' }])
  })

  it('resolves {saved:false} and writes nothing when the dialog is dismissed', async () => {
    const writes: unknown[] = []
    const dialog = dialogReturning({ canceled: true })
    const runtime = new CookbooksRuntime({ spawn: () => { throw new Error('must not spawn') } })

    expect(
      await runtime.exportNotebook(
        { itemId: 'probe-item', filename: 'probe.ipynb', content: '{}' },
        { showSaveDialog: dialog.show, writeFile: async (...args) => { writes.push(args) } },
      ),
    ).toEqual({ saved: false })
    expect(writes).toEqual([])
  })

  it('treats a cancelled dialog without a path as not saved', async () => {
    const runtime = new CookbooksRuntime({ spawn: () => { throw new Error('must not spawn') } })
    const result = await runtime.exportNotebook(
      { itemId: 'probe-item', filename: 'probe.ipynb', content: '{}' },
      { showSaveDialog: async () => ({ canceled: false }), writeFile: async () => {} },
    )
    expect(result).toEqual({ saved: false })
  })

  it('rejects when the write fails so the renderer can surface a notice', async () => {
    const runtime = new CookbooksRuntime({ spawn: () => { throw new Error('must not spawn') } })
    const err = await runtime
      .exportNotebook(
        { itemId: 'probe-item', filename: 'probe.ipynb', content: '{}' },
        {
          showSaveDialog: async () => ({ canceled: false, filePath: '/read-only/probe.ipynb' }),
          writeFile: async () => { throw new Error('EACCES: permission denied') },
        },
      )
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toContain('EACCES')
  })
})
