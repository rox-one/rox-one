/**
 * c2.6 — extension hot reload: revision cache-busting, drain/EXTENSION_RELOADING,
 * dependency-change restartRequired, and failed-load revocation.
 *
 * The in-process worker harness injects an `importFn` that records every
 * specifier the worker asks for. Bun's ESM loader strips the `?rev=` query, so
 * the recorded specifiers (not a fresh module instance) are the proof that a
 * reload asks for a distinct import URL. The entry bytes are re-read on every
 * import so the swap is exercised end to end through the real message protocol.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ExtensionHostManager,
  ExtensionHostReloadError,
  resetExtensionHostManagers,
  type ExtensionHostChild,
  type ExtensionHostForkFn,
} from '../extension-host-manager'
import { CapabilityBroker } from '../extension-host/capability-broker'
import { startWorker } from '../extension-host/worker'

async function flush(times = 10) {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

class FakeChild extends EventEmitter implements ExtensionHostChild {
  pid = 4321
  killed = false
  messages: unknown[] = []
  postMessage(message: unknown): void {
    this.messages.push(message)
  }
  kill(): void {
    this.killed = true
  }
}

interface Harness {
  forkFn: ExtensionHostForkFn
  children: FakeChild[]
  importUrls: string[]
}

/**
 * In-process worker with a recording importFn.
 * `url` is a file URL possibly carrying `?rev=`; bytes are re-read every time
 * and imported via a data URL so the loader does not serve a stale module.
 */
function createHarness(configDir: string, sandboxRootEnv: string): Harness {
  const children: FakeChild[] = []
  const importUrls: string[] = []

  const forkFn: ExtensionHostForkFn = () => {
    const child = new FakeChild()
    children.push(child)
    const toWorker = new EventEmitter()
    child.postMessage = (message: unknown) => {
      child.messages.push(message)
      queueMicrotask(() => toWorker.emit('message', message))
    }
    startWorker({
      port: {
        postMessage: (msg: unknown) => {
          queueMicrotask(() => child.emit('message', msg))
        },
        on: (event: string, handler: (data: unknown) => void) => {
          if (event === 'message') toWorker.on('message', handler)
        },
      } as never,
      configDir,
      sandboxRootEnv,
      importFn: async (url: string) => {
        importUrls.push(url)
        // Bun ignores `?rev=` for module identity; simulate the Node/Electron
        // loader by importing the CURRENT bytes under a unique specifier.
        const source = readFileSync(fileURLToPath(url.split('?')[0]!), 'utf8')
        const dataUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
        return import(dataUrl)
      },
    })
    return child
  }

  return { forkFn, children, importUrls }
}

const MANIFEST = (id: string) => ({
  id,
  name: id,
  version: '1.0.0',
  runtime: 'craft-sandbox',
  permissions: [],
  operations: { version: [] },
})

let tmp: string

afterEach(() => {
  resetExtensionHostManagers()
  if (tmp) {
    try {
      rmSync(tmp, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
})

function writePackage(root: string, name: string, entry: string, helper?: string): string {
  const dir = join(root, 'extensions', 'sandbox', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(MANIFEST(name)))
  writeFileSync(join(dir, 'index.mjs'), entry)
  if (helper !== undefined) writeFileSync(join(dir, 'helper.mjs'), helper)
  return join(dir, 'index.mjs')
}

function makeManager(harness: Harness, sandboxRoot: string, options: { reloadDrainTimeoutMs?: number } = {}) {
  return new ExtensionHostManager({
    forkFn: harness.forkFn,
    configDir: tmp,
    sandboxRootEnv: sandboxRoot,
    workerPath: '/virtual/worker.cjs',
    broker: new CapabilityBroker(),
    getCredential: async () => null,
    messageTimeoutMs: 3000,
    ...options,
  })
}

describe('ExtensionHostManager.reloadExtension', () => {
  it('entry-only change swaps and asks for a distinct import URL', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'eh-reload-'))
    const sandboxRoot = join(tmp, 'extensions', 'sandbox')
    const entry = writePackage(
      tmp,
      'swap-pack',
      'export function version() { return "v1" }\n',
    )
    const harness = createHarness(tmp, sandboxRoot)
    const mgr = makeManager(harness, sandboxRoot)

    await mgr.start()
    await mgr.loadExtension('swap-pack', entry, ['network.request'], { version: [] })
    expect(await mgr.callExtension('swap-pack', 'version')).toBe('v1')

    const firstUrl = harness.importUrls.at(-1)!
    expect(firstUrl).toContain('?rev=')

    writeFileSync(entry, 'export function version() { return "v2" }\n')
    const outcome = await mgr.reloadExtension('swap-pack', {
      entryPath: entry,
      grantedPermissions: ['network.request'],
      operations: { version: [] },
    })

    expect(outcome.status).toBe('swapped')
    if (outcome.status === 'swapped') {
      expect(outcome.generation).toBe(1)
      expect(outcome.entryHash).toMatch(/^[0-9a-f]{64}$/)
    }
    expect(await mgr.callExtension('swap-pack', 'version')).toBe('v2')

    const secondUrl = harness.importUrls.at(-1)!
    expect(secondUrl).not.toBe(firstUrl)
    expect(secondUrl).toContain('?rev=')
  })

  it('refuses new calls with EXTENSION_RELOADING while draining', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'eh-reload-'))
    const sandboxRoot = join(tmp, 'extensions', 'sandbox')
    const entry = writePackage(
      tmp,
      'drain-pack',
      'export function hang() { return new Promise(() => {}) }\nexport function version() { return "v1" }\n',
    )
    const harness = createHarness(tmp, sandboxRoot)
    const mgr = makeManager(harness, sandboxRoot, { reloadDrainTimeoutMs: 60 })
    await mgr.start()
    await mgr.loadExtension('drain-pack', entry, [], { hang: [], version: [] })

    const inflight = mgr.callExtension('drain-pack', 'hang')
    await flush(20)

    const reload = mgr.reloadExtension('drain-pack', {
      entryPath: entry,
      grantedPermissions: [],
      operations: { hang: [], version: [] },
    })
    await flush(10)

    let refusal: unknown
    try {
      await mgr.callExtension('drain-pack', 'version')
    } catch (err) {
      refusal = err
    }
    expect(refusal).toBeInstanceOf(ExtensionHostReloadError)
    expect((refusal as ExtensionHostReloadError).code).toBe('EXTENSION_RELOADING')

    const outcome = await reload
    expect(outcome.status).toBe('swapped')
    // The straggler was dropped by request id rather than resolved late.
    await expect(inflight).rejects.toMatchObject({ code: 'EXTENSION_RELOADING' })
  })

  it('non-entry change → restartRequired with zero load messages', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'eh-reload-'))
    const sandboxRoot = join(tmp, 'extensions', 'sandbox')
    const entry = writePackage(
      tmp,
      'deps-pack',
      'export function version() { return "v1" }\n',
      'export const helper = 1\n',
    )
    const harness = createHarness(tmp, sandboxRoot)
    const mgr = makeManager(harness, sandboxRoot)
    await mgr.start()
    await mgr.loadExtension('deps-pack', entry, [], { version: [] })

    const child = harness.children.at(-1)!
    const before = child.messages.length
    writeFileSync(join(join(entry, '..'), 'helper.mjs'), 'export const helper = 2\n')

    const outcome = await mgr.reloadExtension('deps-pack', {
      entryPath: entry,
      grantedPermissions: [],
      operations: { version: [] },
    })

    expect(outcome).toEqual({ status: 'restartRequired', reason: 'dependency-changed' })
    const sent = child.messages.slice(before) as Array<{ type?: string }>
    expect(sent.filter((m) => m.type === 'load' || m.type === 'unload')).toEqual([])
    // Extension stays loaded on the previous revision.
    expect(mgr.getStatus().loadedExtensions).toContain('deps-pack')
    expect(await mgr.callExtension('deps-pack', 'version')).toBe('v1')
  })

  it('failed load leaves the extension unloaded with grants revoked', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'eh-reload-'))
    const sandboxRoot = join(tmp, 'extensions', 'sandbox')
    const entry = writePackage(tmp, 'fail-pack', 'export function version() { return "v1" }\n')
    const harness = createHarness(tmp, sandboxRoot)
    const mgr = makeManager(harness, sandboxRoot)
    await mgr.start()
    await mgr.loadExtension('fail-pack', entry, ['network.request'], { version: [] })
    expect(mgr.getGrantedPermissions('fail-pack')).toEqual(['network.request'])

    writeFileSync(entry, 'throw new Error("boom at import")\n')
    const outcome = await mgr.reloadExtension('fail-pack', {
      entryPath: entry,
      grantedPermissions: ['network.request'],
      operations: { version: [] },
    })

    expect(outcome.status).toBe('failed')
    expect(mgr.getStatus().loadedExtensions ?? []).not.toContain('fail-pack')
    expect(mgr.getGrantedPermissions('fail-pack')).toEqual([])
    await expect(mgr.callExtension('fail-pack', 'version')).rejects.toThrow(
      /not loaded|undeclared operation|not granted/i,
    )
  })

  it('manifest contract change → restartRequired host-protocol-mismatch', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'eh-reload-'))
    const sandboxRoot = join(tmp, 'extensions', 'sandbox')
    const entry = writePackage(tmp, 'manifest-pack', 'export function version() { return "v1" }\n')
    const harness = createHarness(tmp, sandboxRoot)
    const mgr = makeManager(harness, sandboxRoot)
    await mgr.start()
    await mgr.loadExtension('manifest-pack', entry, [], { version: [] })

    // Same identity/runtime, different host-facing contract (permissions).
    writeFileSync(join(join(entry, '..'), 'manifest.json'), JSON.stringify({
      ...MANIFEST('manifest-pack'),
      permissions: ['ui.command'],
    }))

    const outcome = await mgr.reloadExtension('manifest-pack', {
      entryPath: entry,
      grantedPermissions: [],
      operations: { version: [] },
    })
    expect(outcome).toEqual({ status: 'restartRequired', reason: 'host-protocol-mismatch' })
  })

  it('unknown id → typed EXTENSION_NOT_LOADED', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'eh-reload-'))
    const sandboxRoot = join(tmp, 'extensions', 'sandbox')
    const entry = writePackage(tmp, 'known-pack', 'export function version() { return "v1" }\n')
    const harness = createHarness(tmp, sandboxRoot)
    const mgr = makeManager(harness, sandboxRoot)
    await mgr.start()

    let err: unknown
    try {
      await mgr.reloadExtension('ghost', { entryPath: entry })
    } catch (caught) {
      err = caught
    }
    expect(err).toBeInstanceOf(ExtensionHostReloadError)
    expect((err as ExtensionHostReloadError).code).toBe('EXTENSION_NOT_LOADED')
  })
})