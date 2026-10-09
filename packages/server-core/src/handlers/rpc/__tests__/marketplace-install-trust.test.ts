/**
 * c2.7 — marketplace INSTALL computes the registry trust verdict BEFORE any
 * install work. A blocked verdict aborts with REGISTRY_TRUST_BLOCKED while the
 * installer stays cold and no lock record is written; a clean verdict reaches
 * installEntry with the assessment attached.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RpcServer } from '@rox/server-core/transport'
import { CodedError, RPC_CHANNELS } from '@rox/shared/protocol'

const actualMarketplace = await import('@rox/shared/marketplace')

let catalogEntries: unknown[] = []
let signatureVerified = true
let installCalls = 0
let lastTrust: unknown

mock.module('@rox/shared/marketplace', () => ({
  ...actualMarketplace,
  getCatalog: async () => ({
    catalog: { catalogVersion: 1, entries: catalogEntries },
    origin: signatureVerified ? 'bundled' : 'empty',
    lastCatalogFetchAt: null,
    signatureVerified,
  }),
  installEntry: async (entry: { id: string; kind: string; source: { ref: string } }, options: unknown) => {
    installCalls += 1
    lastTrust = (options as { trust?: unknown }).trust
    return { id: entry.id, kind: entry.kind, status: 'installed', ref: entry.source.ref, targets: [] }
  },
}))

const { registerMarketplaceHandlers } = await import('../marketplace')

type HandlerFn = (...args: unknown[]) => unknown

function makeServer(): { server: RpcServer; handlers: Map<string, HandlerFn> } {
  const handlers = new Map<string, HandlerFn>()
  const server = {
    handle: (channel: string, fn: HandlerFn) => {
      handlers.set(channel, fn)
    },
    push: () => {},
  } as unknown as RpcServer
  return { server, handlers }
}

const CTX = {} as never
const PIN = 'c'.repeat(64)
let tmp: string
let handlers: Map<string, HandlerFn>
const previousConfigDir = process.env.ROX_CONFIG_DIR

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'mkt-install-trust-'))
  process.env.ROX_CONFIG_DIR = tmp
  catalogEntries = []
  signatureVerified = true
  installCalls = 0
  lastTrust = undefined

  const rec = makeServer()
  registerMarketplaceHandlers(rec.server, {} as never)
  handlers = rec.handlers
})

afterEach(() => {
  if (previousConfigDir === undefined) delete process.env.ROX_CONFIG_DIR
  else process.env.ROX_CONFIG_DIR = previousConfigDir
  rmSync(tmp, { recursive: true, force: true })
})

const entry = (overrides: Record<string, unknown> = {}) => ({
  id: 'clear-pack',
  kind: 'skillpack',
  title: 'Clear Pack',
  descriptionRu: 'Пакет',
  source: { type: 'github', repo: 'owner/pack', ref: 'e'.repeat(40) },
  expectedContentSha256: { 'clear-pack': PIN },
  ...overrides,
})

describe('marketplace INSTALL registry trust gate', () => {
  it('aborts on a blocked verdict with installEntry cold and no lock write', async () => {
    catalogEntries = [entry({ expectedContentSha256: undefined })] // missing-content-pin
    const install = handlers.get(RPC_CHANNELS.marketplace.INSTALL)!

    let thrown: unknown
    try {
      await install(CTX, 'clear-pack')
    } catch (err) {
      thrown = err
    }
    expect((thrown as { code?: string } | undefined)?.code).toBe('REGISTRY_TRUST_BLOCKED')
    expect(installCalls).toBe(0)
    expect(existsSync(join(tmp, 'marketplace', 'lock.json'))).toBe(false)
  })

  it('aborts on an unsigned catalog', async () => {
    signatureVerified = false
    catalogEntries = [entry()]
    const install = handlers.get(RPC_CHANNELS.marketplace.INSTALL)!
    let thrown: unknown
    try {
      await install(CTX, 'clear-pack')
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(CodedError)
    if (thrown instanceof CodedError) expect(thrown.code).toBe('REGISTRY_TRUST_BLOCKED')
    expect(installCalls).toBe(0)
  })

  it('reaches installEntry with a clean assessment', async () => {
    catalogEntries = [entry()]
    const install = handlers.get(RPC_CHANNELS.marketplace.INSTALL)!
    const result = (await install(CTX, 'clear-pack')) as { status: string }
    expect(result.status).toBe('installed')
    expect(installCalls).toBe(1)
    expect(lastTrust).toEqual({ verdict: 'clean', reasons: [] })
  })
})