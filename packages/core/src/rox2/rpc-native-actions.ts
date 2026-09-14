/**
 * ROX2-139..150: native RPC list/read/act.
 *
 * Native RPC mutations can be live. Fixture DTOs and Conation payloads are not.
 * A handler `{ ok: true }` DTO is not a Rox2 live claim.
 */
import {
  fixtureResult,
  formatRox2EntityId,
  liveResult,
  queuedResult,
  type Rox2EntityKind,
  type Rox2Result,
} from './platform-contract.ts'

export type RpcNativeActionSource = 'native' | 'fixture' | 'conation'
export type RpcNativeActKind = 'write' | 'destroy' | 'spend'
export type RpcNativeSurface =
  | 'auth'
  | 'automations'
  | 'browser-pane'
  | 'browser-profile-import'
  | 'bundled-skills'
  | 'cloud-runs'
  | 'collection'
  | 'command-gateway'
  | 'context-docs'
  | 'environment'
  | 'extensions'
  | 'fabric-runtime'

const SURFACE: Record<
  RpcNativeSurface,
  { kind: Rox2EntityKind; label: string; store: string; prefix: string }
> = {
  auth: {
    kind: 'connection',
    label: 'auth RPC',
    store: 'native credentials',
    prefix: 'rpc.auth',
  },
  automations: {
    kind: 'automation',
    label: 'automations RPC',
    store: 'native automations',
    prefix: 'rpc.automations',
  },
  'browser-pane': {
    kind: 'page',
    label: 'browser-pane RPC',
    store: 'native browser pane',
    prefix: 'rpc.browser-pane',
  },
  'browser-profile-import': {
    kind: 'file',
    label: 'browser-profile-import RPC',
    store: 'native browser profiles',
    prefix: 'rpc.browser-profile-import',
  },
  'bundled-skills': {
    kind: 'skill',
    label: 'bundled-skills RPC',
    store: 'native bundled skills',
    prefix: 'rpc.bundled-skills',
  },
  'cloud-runs': {
    kind: 'workflow',
    label: 'cloud-runs RPC',
    store: 'native cloud-runs config',
    prefix: 'rpc.cloud-runs',
  },
  collection: {
    kind: 'session',
    label: 'collection RPC',
    store: 'native collection display',
    prefix: 'rpc.collection',
  },
  'command-gateway': {
    kind: 'task',
    label: 'command-gateway RPC',
    store: 'native pending commands',
    prefix: 'rpc.command-gateway',
  },
  'context-docs': {
    kind: 'file',
    label: 'context-docs RPC',
    store: 'native context docs',
    prefix: 'rpc.context-docs',
  },
  environment: {
    kind: 'memory',
    label: 'environment RPC',
    store: 'native environment prefs',
    prefix: 'rpc.environment',
  },
  extensions: {
    kind: 'skill',
    label: 'extensions RPC',
    store: 'native extension state',
    prefix: 'rpc.extensions',
  },
  'fabric-runtime': {
    kind: 'connection',
    label: 'fabric-runtime',
    store: 'native connection fabric',
    prefix: 'rpc.fabric-runtime',
  },
}

function nativeLive(surface: RpcNativeSurface, action: 'list' | 'read' | 'act', entityId: string): Rox2Result {
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

export function rpcNativeListResult(opts: {
  surface: RpcNativeSurface
  source: RpcNativeActionSource
  nativeIds?: readonly string[]
}): { result: Rox2Result; entities: string[] } {
  const meta = SURFACE[opts.surface]
  if (opts.source === 'fixture') {
    return {
      result: fixtureResult(`${meta.prefix}.list.fixture`, `Mocked ${meta.label} rows are fixture, not live`),
      entities: [],
    }
  }
  if (opts.source === 'conation') {
    return {
      result: queuedResult(
        `${meta.prefix}.list.queued`,
        `${meta.label} list is queued; ${meta.store} are a separate store`,
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

export function rpcNativeReadResult(opts: {
  surface: RpcNativeSurface
  source: RpcNativeActionSource
  nativeId?: string
}): { result: Rox2Result; entityId: string | null } {
  const meta = SURFACE[opts.surface]
  if (opts.source === 'fixture') {
    return {
      result: fixtureResult(`${meta.prefix}.read.fixture`, `Mocked ${meta.label} read is fixture, not live`),
      entityId: null,
    }
  }
  if (opts.source === 'conation') {
    return {
      result: queuedResult(
        `${meta.prefix}.read.queued`,
        `${meta.label} read is queued; ${meta.store} are a separate store`,
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

export function rpcNativeActResult(opts: {
  surface: RpcNativeSurface
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}): Rox2Result {
  const meta = SURFACE[opts.surface]
  if (opts.source === 'fixture') {
    return fixtureResult(`${meta.prefix}.act.fixture`, `Playground ${meta.kind} writes are fixture, not live`)
  }
  if (opts.source === 'conation') {
    return queuedResult(`${meta.prefix}.act.queued`, `${meta.label} act is queued; DTO ok is not live`)
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

export function rpcAuthListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'auth', ...opts })
}

export function rpcAuthReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'auth', ...opts })
}

export function rpcAuthActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'auth', ...opts })
}

export function rpcAutomationsListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'automations', ...opts })
}

export function rpcAutomationsReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'automations', ...opts })
}

export function rpcAutomationsActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'automations', ...opts })
}

export function rpcBrowserPaneListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'browser-pane', ...opts })
}

export function rpcBrowserPaneReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'browser-pane', ...opts })
}

export function rpcBrowserPaneActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'browser-pane', ...opts })
}

export function rpcBrowserProfileImportListResult(opts: {
  source: RpcNativeActionSource
  nativeIds?: readonly string[]
}) {
  return rpcNativeListResult({ surface: 'browser-profile-import', ...opts })
}

export function rpcBrowserProfileImportReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'browser-profile-import', ...opts })
}

export function rpcBrowserProfileImportActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'browser-profile-import', ...opts })
}

export function rpcBundledSkillsListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'bundled-skills', ...opts })
}

export function rpcBundledSkillsReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'bundled-skills', ...opts })
}

export function rpcBundledSkillsActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'bundled-skills', ...opts })
}

export function rpcCloudRunsListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'cloud-runs', ...opts })
}

export function rpcCloudRunsReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'cloud-runs', ...opts })
}

export function rpcCloudRunsActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'cloud-runs', ...opts })
}

export function rpcCollectionListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'collection', ...opts })
}

export function rpcCollectionReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'collection', ...opts })
}

export function rpcCollectionActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'collection', ...opts })
}

export function rpcCommandGatewayListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'command-gateway', ...opts })
}

export function rpcCommandGatewayReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'command-gateway', ...opts })
}

export function rpcCommandGatewayActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'command-gateway', ...opts })
}

export function rpcContextDocsListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'context-docs', ...opts })
}

export function rpcContextDocsReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'context-docs', ...opts })
}

export function rpcContextDocsActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'context-docs', ...opts })
}

export function rpcEnvironmentListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'environment', ...opts })
}

export function rpcEnvironmentReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'environment', ...opts })
}

export function rpcEnvironmentActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'environment', ...opts })
}

export function rpcExtensionsListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'extensions', ...opts })
}

export function rpcExtensionsReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'extensions', ...opts })
}

export function rpcExtensionsActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'extensions', ...opts })
}

export function rpcFabricRuntimeListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'fabric-runtime', ...opts })
}

export function rpcFabricRuntimeReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'fabric-runtime', ...opts })
}

export function rpcFabricRuntimeActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'fabric-runtime', ...opts })
}
