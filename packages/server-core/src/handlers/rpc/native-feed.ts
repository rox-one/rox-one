import { createHash, randomUUID } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import type { Stats } from 'node:fs'
import { isIP } from 'node:net'
import { join } from 'node:path'
import { CodedError, RPC_CHANNELS } from '@rox/shared/protocol'
import {
  buildAutomationRunItems, buildSessionFeedItems, mergeFeedItems,
  type FeedAutomationRunLike, type FeedItem, type FeedListResult, type FeedSessionLike,
  type XConnectionStatus, type FeedSource,
} from '@rox/shared/feed'
import type { NativeAuthority, NativePrincipal } from '../../authority/native-authority'
import { FeedService } from '../../feed/feed-service'
import type { FetchLike } from '../../feed/fetcher'
import { createXApiAdapter, notConnectedXAdapter } from '../../feed/x-adapter'
import type { HandlerDeps } from '../handler-deps'
import type { RequestContext, RpcServer } from '../../transport/types'
import { readNativeWorkspaceRegistry } from './native-workspace-registry'

interface Scope { issuer: string; subject: string; workspaceId: string; root: string }
export interface NativeFeedEnvironment {
  fetch?: FetchLike
  lookup?: (hostname: string) => Promise<readonly { address: string }[]>
  now?: () => number
}
const MAX_STATE_BYTES = 12 * 1024 * 1024

function privateInfo(path: string, directory: boolean): Stats | null {
  try {
    const info = lstatSync(path)
    if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1)
      || typeof process.getuid === 'function' && info.uid !== process.getuid()
      || (info.mode & 0o077) !== 0) throw new CodedError('FORBIDDEN', 'Native feed custody is unavailable')
    return info
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
}

/** Reads never create files, chmod existing data, migrate state or touch a host token. */
class PrivateFeedFiles {
  readonly directory: string
  private readonly parentIdentity: string
  constructor(private readonly parent: string, private readonly key: string, private readonly assertCurrent: () => void) {
    const info = privateInfo(parent, true)
    if (!info) throw new CodedError('FORBIDDEN', 'Native feed custody is unavailable')
    this.parentIdentity = `${info.dev}:${info.ino}`
    this.directory = join(parent, 'native-feed')
  }
  private validate(): void {
    this.assertCurrent()
    const parent = privateInfo(this.parent, true)
    if (!parent || `${parent.dev}:${parent.ino}` !== this.parentIdentity) throw new CodedError('FORBIDDEN', 'Native feed custody changed')
    privateInfo(this.directory, true)
  }
  read(suffix: string): unknown {
    this.validate()
    const path = join(this.directory, `${this.key}.${suffix}.json`)
    const expected = privateInfo(path, false)
    if (!expected) return null
    if (expected.size > MAX_STATE_BYTES) throw new CodedError('FORBIDDEN', 'Native feed state is too large')
    let descriptor: number | undefined
    try {
      descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
      const info = fstatSync(descriptor)
      if (info.dev !== expected.dev || info.ino !== expected.ino || info.size > MAX_STATE_BYTES) throw new CodedError('FORBIDDEN', 'Native feed custody changed')
      const result: unknown = JSON.parse(readFileSync(descriptor, 'utf8'))
      this.validate()
      return result
    } finally { if (descriptor !== undefined) closeSync(descriptor) }
  }
  write(suffix: string, value: unknown): void {
    this.validate()
    if (!privateInfo(this.directory, true)) mkdirSync(this.directory, { mode: 0o700 })
    this.validate()
    const path = join(this.directory, `${this.key}.${suffix}.json`)
    privateInfo(path, false)
    const data = JSON.stringify(value)
    if (Buffer.byteLength(data) > MAX_STATE_BYTES) throw new CodedError('FORBIDDEN', 'Native feed state is too large')
    const temporary = `${path}.${randomUUID()}.tmp`
    try {
      const descriptor = openSync(temporary, 'wx', 0o600)
      try { writeFileSync(descriptor, data, 'utf8') } finally { closeSync(descriptor) }
      this.validate()
      privateInfo(path, false)
      renameSync(temporary, path)
    } finally { rmSync(temporary, { force: true }) }
  }
}

function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number)
    return a !== 0 && a !== 10 && a !== 127 && a! < 224
      && !(a === 169 && b === 254) && !(a === 172 && b! >= 16 && b! <= 31)
      && !(a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2)))
      && !(a === 198 && (b === 18 || b === 19 || b === 51 && c === 100))
      && !(a === 203 && b === 0 && c === 113) && !(a === 100 && b! >= 64 && b! <= 127)
  }
  if (isIP(address) === 6) return /^(?:2|3)[0-9a-f]{0,3}:/i.test(address) && !/^2001:(?:db8|0):/i.test(address)
  return false
}

/** Anonymous public HTTP only; each redirect and asynchronous step stays in the request fence. */
function scopedFetch(assertCurrent: () => void, environment: NativeFeedEnvironment): FetchLike {
  const fetchImpl = environment.fetch ?? fetch
  const resolveHost = environment.lookup ?? (hostname => lookup(hostname, { all: true, verbatim: true }))
  return async (input, init) => {
    let url = new URL(input)
    try {
      for (let redirects = 0; redirects <= 5; redirects++) {
        assertCurrent()
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password
          || url.port && !['80', '443'].includes(url.port)) throw new Error('invalid-url')
        const host = url.hostname.replace(/^\[|\]$/g, '')
        const addresses = isIP(host) ? [{ address: host }] : await resolveHost(host)
        assertCurrent()
        if (!addresses.length || addresses.some(address => !publicAddress(address.address))) throw new Error('invalid-url')
        const headers = new Headers(init?.headers)
        if (url.origin !== new URL(input).origin) { headers.delete('authorization'); headers.delete('cookie') }
        // Connect to the address that passed validation rather than resolving the
        // user hostname again. Bun retains the configured proxy; Host and SNI
        // preserve virtual hosting and normal certificate verification.
        const pinned = new URL(url)
        pinned.hostname = isIP(addresses[0]!.address) === 6 ? `[${addresses[0]!.address}]` : addresses[0]!.address
        headers.set('host', url.host)
        const request: BunFetchRequestInit = { ...init, headers, redirect: 'manual', credentials: 'omit',
          ...(url.protocol === 'https:' && !isIP(host) ? { tls: { serverName: host, rejectUnauthorized: true } } : {}) }
        const response = await fetchImpl(pinned.href, request)
        assertCurrent()
        if (![301, 302, 303, 307, 308].includes(response.status)) {
          Object.defineProperty(response, 'url', { value: url.href, configurable: true })
          return response
        }
        const location = response.headers.get('location')
        await response.body?.cancel().catch(() => {})
        assertCurrent()
        if (!location) throw new Error('network-error')
        url = new URL(location, url)
      }
      throw new Error('network-error')
    } catch (error) {
      assertCurrent()
      throw new Error(error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'network-error')
    }
  }
}

function safeItem(item: FeedItem): FeedItem {
  return { id: item.id, tab: item.tab, kind: item.kind, title: item.title, summary: item.summary, at: item.at,
    status: item.status, url: item.url, sourceId: item.sourceId, sourceTitle: item.sourceTitle, author: item.author,
    error: item.error, sessionId: item.sessionId, automationId: item.automationId,
    ref: item.ref ? { type: item.ref.type, id: item.ref.id, workspaceId: item.ref.workspaceId } : undefined }
}

function safeSource(source: FeedSource): FeedSource {
  return { id: source.id, url: source.url, kind: source.kind, title: source.title, feedUrl: source.feedUrl,
    handle: source.handle, intervalMin: source.intervalMin, addedAt: source.addedAt,
    lastFetchAt: source.lastFetchAt, lastStatus: source.lastStatus, lastError: source.lastError,
    itemCount: source.itemCount, lastOkAt: source.lastOkAt, color: source.color, tags: source.tags,
    paused: source.paused, checking: source.checking }
}

function readRuns(root: string, sessionIds: ReadonlySet<string>): FeedAutomationRunLike[] {
  const path = join(root, 'automations-history.jsonl')
  let descriptor: number | undefined
  try {
    const expected = lstatSync(path)
    if (!expected.isFile() || expected.isSymbolicLink() || expected.size > 4 * 1024 * 1024) return []
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const actual = fstatSync(descriptor)
    if (actual.dev !== expected.dev || actual.ino !== expected.ino || actual.size > 4 * 1024 * 1024) return []
    return readFileSync(descriptor, 'utf8').trim().split('\n').slice(-200).flatMap(line => {
      try {
        const run = JSON.parse(line) as FeedAutomationRunLike
        if (typeof run.id !== 'string' || run.id.length > 200 || !Number.isFinite(run.ts) || typeof run.ok !== 'boolean') return []
        return [{ id: run.id, ts: run.ts, ok: run.ok,
          ...(typeof run.prompt === 'string' ? { prompt: run.prompt.slice(0, 200) } : {}),
          ...(run.sessionId && sessionIds.has(run.sessionId) ? { sessionId: run.sessionId } : {}),
          ...(!run.ok ? { error: 'automation-run-failed' } : {}) }]
      } catch { return [] }
    })
  } catch { return [] }
  finally { if (descriptor !== undefined) closeSync(descriptor) }
}

export function projectNativeFeedChanged(
  authority: NativeAuthority, args: readonly unknown[], workspaceId: string, principal: NativePrincipal,
): readonly unknown[] | null {
  const event = args[0] as { scope?: Scope; at?: unknown } | undefined
  const workspace = readNativeWorkspaceRegistry(workspaceId)
  if (!event?.scope || !workspace || event.scope.issuer !== principal.issuer || event.scope.subject !== principal.subject
    || event.scope.workspaceId !== workspaceId || event.scope.root !== workspace.rootPath
    || !authority.authorize(principal, workspaceId, 'read', workspace.rootPath)
    || typeof event.at !== 'number' || !Number.isFinite(event.at)) return null
  return [{ at: event.at }]
}

export function createNativeFeedOperation(
  server: RpcServer, deps: HandlerDeps, context: RequestContext, action: 'read' | 'write', environment: NativeFeedEnvironment = {},
) {
  const authority = deps.nativeData?.authority
  const principal = context.principal
  const workspace = readNativeWorkspaceRegistry(context.workspaceId ?? '')
  if (!authority || !principal || !workspace) throw new CodedError('FORBIDDEN', 'Native feed workspace is unavailable')
  const scope: Scope = { issuer: principal.issuer, subject: principal.subject, workspaceId: workspace.id, root: workspace.rootPath }
  const assertCurrent = () => {
    const current = readNativeWorkspaceRegistry(scope.workspaceId)
    if (!server.isRequestContextCurrent?.(context, action) || !current || current.rootPath !== scope.root
      || !authority.authorize(principal, scope.workspaceId, 'read', scope.root)
      || !authority.authorize(principal, scope.workspaceId, action, scope.root)) throw new CodedError('AUTH_FAILED', 'Native feed workspace permission changed')
  }
  assertCurrent()
  const key = createHash('sha256').update(JSON.stringify([scope.issuer, scope.subject, scope.workspaceId, scope.root])).digest('hex')
  const files = new PrivateFeedFiles(authority.stateDirectory, key, assertCurrent)
  const guardedFetch = scopedFetch(assertCurrent, environment)
  const credentials = () => files.read('x') as { token?: unknown; status?: XConnectionStatus } | null
  const svc = new FeedService({ configDir: files.directory, autoPollOnAdd: false, now: environment.now,
    persistence: { read: () => files.read('state'), write: state => { assertCurrent(); files.write('state', state) } },
    fetch: guardedFetch, getXAdapter: async () => {
      assertCurrent()
      const token = credentials()?.token
      return typeof token === 'string' ? createXApiAdapter(token, guardedFetch) : notConnectedXAdapter
    },
    onChange: () => { assertCurrent(); server.push(RPC_CHANNELS.feed.CHANGED, { to: 'workspace', workspaceId: scope.workspaceId }, { scope, at: Date.now() }) },
  })
  return { key, service: svc, assertCurrent,
    list(): FeedListResult {
      assertCurrent()
      const sessions = (deps.sessionManager.getSessions(scope.workspaceId) as unknown as FeedSessionLike[])
        .filter(session => session.workspaceId === scope.workspaceId)
        .map(session => ({ id: session.id, workspaceId: scope.workspaceId, name: session.name, preview: session.preview,
          lastMessageAt: session.lastMessageAt, isProcessing: session.isProcessing, hidden: session.hidden,
          isArchived: session.isArchived, lastMessageRole: session.lastMessageRole }))
      const items = mergeFeedItems([buildSessionFeedItems(sessions), buildAutomationRunItems(readRuns(scope.root, new Set(sessions.map(session => session.id))), {}, scope.workspaceId), svc.listItems()], 2000).map(safeItem)
      const saved = credentials()
      const x: XConnectionStatus = saved?.token && saved.status?.state === 'connected'
        ? { state: 'connected', username: saved.status.username } : { state: 'not-connected' }
      const result: FeedListResult = { items, sources: svc.listSources().map(safeSource), annotations: svc.listAnnotations(), x, generatedAt: Date.now(),
        refreshAllowed: authority.authorize(principal, scope.workspaceId, 'write', scope.root) }
      assertCurrent()
      return result
    },
    async setX(token: string): Promise<XConnectionStatus> {
      assertCurrent()
      if (!token.trim() || token.length > 8192 || /[\r\n]/.test(token)) return { state: 'error', message: 'empty-token' }
      const status = await createXApiAdapter(token.trim(), guardedFetch).status()
      assertCurrent()
      if (status.state !== 'connected') return { state: 'error', message: 'network-error' }
      const safe: XConnectionStatus = { state: 'connected', username: status.username }
      files.write('x', { token: token.trim(), status: safe })
      svc.resetX()
      return safe
    },
    clearX(): XConnectionStatus { assertCurrent(); files.write('x', {}); svc.resetX(); return { state: 'not-connected' } },
  }
}
