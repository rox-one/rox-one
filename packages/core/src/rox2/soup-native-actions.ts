/**
 * ROX2-081..086: GraphqlSoupChat / GraphqlSoupProject list/read/act.
 *
 * Native sessions and projects can be live. Soup-bridge rows and playground
 * fixtures are not. Act never goes through CompleteMutationRoot.
 */
import {
  fixtureResult,
  formatRox2EntityId,
  liveResult,
  queuedResult,
  type Rox2EntityKind,
  type Rox2Result,
} from './platform-contract.ts'

export type SoupNativeActionSource = 'native' | 'fixture' | 'conation'
export type SoupNativeActKind = 'write' | 'destroy' | 'spend'
export type SoupNativeSurface = 'chat' | 'project'

const SURFACE: Record<
  SoupNativeSurface,
  { kind: Rox2EntityKind; soup: string; store: string; prefix: string }
> = {
  chat: {
    kind: 'session',
    soup: 'GraphqlSoupChat',
    store: 'native sessions',
    prefix: 'soup.chat',
  },
  project: {
    kind: 'project',
    soup: 'GraphqlSoupProject',
    store: 'native projects',
    prefix: 'soup.project',
  },
}

function nativeLive(surface: SoupNativeSurface, action: 'list' | 'read' | 'act', entityId: string): Rox2Result {
  return liveResult({
    entityId,
    lifecycle: 'succeeded',
    verification: 'receipt_verified',
    receipt: {
      provider: 'native',
      requestId: `${SURFACE[surface].prefix}.${action}`,
    },
  })
}

export function soupNativeListResult(opts: {
  surface: SoupNativeSurface
  source: SoupNativeActionSource
  nativeIds?: readonly string[]
}): { result: Rox2Result; entities: string[] } {
  const meta = SURFACE[opts.surface]
  if (opts.source === 'fixture') {
    return {
      result: fixtureResult(`${meta.prefix}.list.fixture`, `Mocked ${meta.soup} rows are fixture, not live`),
      entities: [],
    }
  }
  if (opts.source === 'conation') {
    return {
      result: queuedResult(
        `${meta.prefix}.list.queued`,
        `${meta.soup} list is queued; ${meta.store} are a separate store`,
      ),
      entities: [],
    }
  }
  const entities = [...(opts.nativeIds ?? [])]
  return {
    result: nativeLive(opts.surface, 'list', formatRox2EntityId(meta.kind, entities[0] ?? 'list')),
    entities,
  }
}

export function soupNativeReadResult(opts: {
  surface: SoupNativeSurface
  source: SoupNativeActionSource
  nativeId?: string
}): { result: Rox2Result; entityId: string | null } {
  const meta = SURFACE[opts.surface]
  if (opts.source === 'fixture') {
    return {
      result: fixtureResult(`${meta.prefix}.read.fixture`, `Mocked ${meta.soup} read is fixture, not live`),
      entityId: null,
    }
  }
  if (opts.source === 'conation') {
    return {
      result: queuedResult(
        `${meta.prefix}.read.queued`,
        `${meta.soup} read is queued; ${meta.store} are a separate store`,
      ),
      entityId: null,
    }
  }
  if (!opts.nativeId) {
    return {
      result: queuedResult(`${meta.prefix}.not-found`, `Missing ${meta.kind} is an error, not a fake record`),
      entityId: null,
    }
  }
  return {
    result: nativeLive(opts.surface, 'read', formatRox2EntityId(meta.kind, opts.nativeId)),
    entityId: formatRox2EntityId(meta.kind, opts.nativeId),
  }
}

export function soupNativeActResult(opts: {
  surface: SoupNativeSurface
  source: SoupNativeActionSource
  action?: SoupNativeActKind
  granted?: boolean
  nativeId?: string
}): Rox2Result {
  const meta = SURFACE[opts.surface]
  if (opts.source === 'fixture') {
    return fixtureResult(`${meta.prefix}.act.fixture`, `Playground ${meta.kind} writes are fixture, not live`)
  }
  if (opts.source === 'conation') {
    return queuedResult(
      `${meta.prefix}.act.queued`,
      `${meta.soup} act is queued; no CompleteMutationRoot`,
    )
  }
  const action = opts.action ?? 'write'
  if (action === 'spend') {
    return queuedResult(`${meta.prefix}.not-spend`, `${meta.store} writes are local, not spend`)
  }
  if (action === 'destroy' && opts.granted !== true) {
    return queuedResult(`${meta.prefix}.grant-required`, 'destroy requires an explicit grant')
  }
  return nativeLive(opts.surface, 'act', formatRox2EntityId(meta.kind, opts.nativeId ?? 'act'))
}

export function soupChatListResult(opts: {
  source: SoupNativeActionSource
  nativeIds?: readonly string[]
}) {
  return soupNativeListResult({ surface: 'chat', ...opts })
}

export function soupChatReadResult(opts: { source: SoupNativeActionSource; nativeId?: string }) {
  return soupNativeReadResult({ surface: 'chat', ...opts })
}

export function soupChatActResult(opts: {
  source: SoupNativeActionSource
  action?: SoupNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return soupNativeActResult({ surface: 'chat', ...opts })
}

export function soupProjectListResult(opts: {
  source: SoupNativeActionSource
  nativeIds?: readonly string[]
}) {
  return soupNativeListResult({ surface: 'project', ...opts })
}

export function soupProjectReadResult(opts: { source: SoupNativeActionSource; nativeId?: string }) {
  return soupNativeReadResult({ surface: 'project', ...opts })
}

export function soupProjectActResult(opts: {
  source: SoupNativeActionSource
  action?: SoupNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return soupNativeActResult({ surface: 'project', ...opts })
}
