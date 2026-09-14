/**
 * ROX2-139..190: native RPC list/read/act.
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
  | 'fabric'
  | 'files'
  | 'gamification'
  | 'identity'
  | 'kanban'
  | 'knowledge'
  | 'labels'
  | 'llm-connections'
  | 'marketplace'
  | 'memory-insights'
  | 'memory-io'
  | 'memory-proposals'
  | 'memory'
  | 'messaging'
  | 'mindmap'
  | 'notes-import'
  | 'notes'
  | 'oauth'
  | 'onboarding'
  | 'openclaw'
  | 'orgs'
  | 'pages'
  | 'plugin-bridge'
  | 'privacy'
  | 'projects'
  | 'resources'
  | 'server'
  | 'session-foreign-import'
  | 'sessions'
  | 'settings'
  | 'skills-pending'
  | 'skills'
  | 'sources'
  | 'statuses'
  | 'system'
  | 'tasks'
  | 'toolchain'
  | 'transfer'
  | 'voice'
  | 'workspace'

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
  fabric: {
    kind: 'connection',
    label: 'fabric RPC',
    store: 'native fabric connections',
    prefix: 'rpc.fabric',
  },
  files: {
    kind: 'file',
    label: 'files RPC',
    store: 'native workspace files',
    prefix: 'rpc.files',
  },
  gamification: {
    kind: 'task',
    label: 'gamification RPC',
    store: 'native gamification state',
    prefix: 'rpc.gamification',
  },
  identity: {
    kind: 'person',
    label: 'identity RPC',
    store: 'native identity profile',
    prefix: 'rpc.identity',
  },
  kanban: {
    kind: 'task',
    label: 'kanban RPC',
    store: 'native kanban board',
    prefix: 'rpc.kanban',
  },
  knowledge: {
    kind: 'note',
    label: 'knowledge RPC',
    store: 'native knowledge connections',
    prefix: 'rpc.knowledge',
  },
  labels: {
    kind: 'file',
    label: 'labels RPC',
    store: 'native workspace labels',
    prefix: 'rpc.labels',
  },
  'llm-connections': {
    kind: 'connection',
    label: 'llm-connections RPC',
    store: 'native llm connections',
    prefix: 'rpc.llm-connections',
  },
  marketplace: {
    kind: 'skill',
    label: 'marketplace RPC',
    store: 'native marketplace lock',
    prefix: 'rpc.marketplace',
  },
  'memory-insights': {
    kind: 'memory',
    label: 'memory-insights RPC',
    store: 'native memory insights',
    prefix: 'rpc.memory-insights',
  },
  'memory-io': {
    kind: 'memory',
    label: 'memory-io RPC',
    store: 'native memory export',
    prefix: 'rpc.memory-io',
  },
  'memory-proposals': {
    kind: 'memory',
    label: 'memory-proposals RPC',
    store: 'native memory proposals',
    prefix: 'rpc.memory-proposals',
  },
  memory: {
    kind: 'memory',
    label: 'memory RPC',
    store: 'native lessons',
    prefix: 'rpc.memory',
  },
  messaging: {
    kind: 'connection',
    label: 'messaging RPC',
    store: 'native messaging config',
    prefix: 'rpc.messaging',
  },
  mindmap: {
    kind: 'note',
    label: 'mindmap RPC',
    store: 'native mindmap pins',
    prefix: 'rpc.mindmap',
  },
  'notes-import': {
    kind: 'file',
    label: 'notes-import RPC',
    store: 'native notes imports',
    prefix: 'rpc.notes-import',
  },
  notes: {
    kind: 'note',
    label: 'notes RPC',
    store: 'native notes',
    prefix: 'rpc.notes',
  },
  oauth: {
    kind: 'connection',
    label: 'oauth RPC',
    store: 'native oauth credentials',
    prefix: 'rpc.oauth',
  },
  onboarding: {
    kind: 'connection',
    label: 'onboarding RPC',
    store: 'native onboarding credentials',
    prefix: 'rpc.onboarding',
  },
  openclaw: {
    kind: 'connection',
    label: 'openclaw RPC',
    store: 'native openclaw runtime',
    prefix: 'rpc.openclaw',
  },
  orgs: {
    kind: 'project',
    label: 'orgs RPC',
    store: 'native organizations',
    prefix: 'rpc.orgs',
  },
  pages: {
    kind: 'page',
    label: 'pages RPC',
    store: 'native workspace pages',
    prefix: 'rpc.pages',
  },
  'plugin-bridge': {
    kind: 'skill',
    label: 'plugin-bridge RPC',
    store: 'native SiYuan plugins',
    prefix: 'rpc.plugin-bridge',
  },
  privacy: {
    kind: 'person',
    label: 'privacy RPC',
    store: 'native privacy ledger',
    prefix: 'rpc.privacy',
  },
  projects: {
    kind: 'project',
    label: 'projects RPC',
    store: 'native workspace projects',
    prefix: 'rpc.projects',
  },
  resources: {
    kind: 'file',
    label: 'resources RPC',
    store: 'native resource bundles',
    prefix: 'rpc.resources',
  },
  server: {
    kind: 'session',
    label: 'server RPC',
    store: 'native local server',
    prefix: 'rpc.server',
  },
  'session-foreign-import': {
    kind: 'session',
    label: 'session-foreign-import RPC',
    store: 'native foreign transcripts',
    prefix: 'rpc.session-foreign-import',
  },
  sessions: {
    kind: 'session',
    label: 'sessions RPC',
    store: 'native sessions',
    prefix: 'rpc.sessions',
  },
  settings: {
    kind: 'memory',
    label: 'settings RPC',
    store: 'native settings prefs',
    prefix: 'rpc.settings',
  },
  'skills-pending': {
    kind: 'skill',
    label: 'skills-pending RPC',
    store: 'native pending skills',
    prefix: 'rpc.skills-pending',
  },
  skills: {
    kind: 'skill',
    label: 'skills RPC',
    store: 'native workspace skills',
    prefix: 'rpc.skills',
  },
  sources: {
    kind: 'connection',
    label: 'sources RPC',
    store: 'native workspace sources',
    prefix: 'rpc.sources',
  },
  statuses: {
    kind: 'session',
    label: 'statuses RPC',
    store: 'native workspace statuses',
    prefix: 'rpc.statuses',
  },
  system: {
    kind: 'memory',
    label: 'system RPC',
    store: 'native system prefs',
    prefix: 'rpc.system',
  },
  tasks: {
    kind: 'task',
    label: 'tasks RPC',
    store: 'native task conductor',
    prefix: 'rpc.tasks',
  },
  toolchain: {
    kind: 'skill',
    label: 'toolchain RPC',
    store: 'native toolchain runtime',
    prefix: 'rpc.toolchain',
  },
  transfer: {
    kind: 'file',
    label: 'transfer RPC',
    store: 'native chunked transfer',
    prefix: 'rpc.transfer',
  },
  voice: {
    kind: 'memory',
    label: 'voice RPC',
    store: 'native voice prefs',
    prefix: 'rpc.voice',
  },
  workspace: {
    kind: 'session',
    label: 'workspace RPC',
    store: 'native workspaces',
    prefix: 'rpc.workspace',
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
    // ROX2-191: native cloud-run SUBMIT is paid compute. Other RPC stores
    // treat spend as a mis-tagged local write and stay queued.
    if (opts.surface === 'cloud-runs' && opts.granted === true) {
      return nativeLive(opts.surface, 'act', formatRox2EntityId(meta.kind, opts.nativeId ?? 'act'))
    }
    return queuedResult(
      `${meta.prefix}.not-spend`,
      opts.surface === 'cloud-runs'
        ? 'cloud-runs spend requires an explicit grant'
        : `${meta.store} writes are local, not spend`,
    )
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

export function rpcFabricListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'fabric', ...opts })
}

export function rpcFabricReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'fabric', ...opts })
}

export function rpcFabricActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'fabric', ...opts })
}

export function rpcFilesListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'files', ...opts })
}

export function rpcFilesReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'files', ...opts })
}

export function rpcFilesActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'files', ...opts })
}

export function rpcGamificationListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'gamification', ...opts })
}

export function rpcGamificationReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'gamification', ...opts })
}

export function rpcGamificationActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'gamification', ...opts })
}

export function rpcIdentityListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'identity', ...opts })
}

export function rpcIdentityReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'identity', ...opts })
}

export function rpcIdentityActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'identity', ...opts })
}

export function rpcKanbanListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'kanban', ...opts })
}

export function rpcKanbanReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'kanban', ...opts })
}

export function rpcKanbanActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'kanban', ...opts })
}

export function rpcKnowledgeListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'knowledge', ...opts })
}

export function rpcKnowledgeReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'knowledge', ...opts })
}

export function rpcKnowledgeActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'knowledge', ...opts })
}

export function rpcLabelsListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'labels', ...opts })
}

export function rpcLabelsReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'labels', ...opts })
}

export function rpcLabelsActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'labels', ...opts })
}

export function rpcLlmConnectionsListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'llm-connections', ...opts })
}

export function rpcLlmConnectionsReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'llm-connections', ...opts })
}

export function rpcLlmConnectionsActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'llm-connections', ...opts })
}

export function rpcMarketplaceListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'marketplace', ...opts })
}

export function rpcMarketplaceReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'marketplace', ...opts })
}

export function rpcMarketplaceActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'marketplace', ...opts })
}

export function rpcMemoryInsightsListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'memory-insights', ...opts })
}

export function rpcMemoryInsightsReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'memory-insights', ...opts })
}

export function rpcMemoryInsightsActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'memory-insights', ...opts })
}

export function rpcMemoryIoListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'memory-io', ...opts })
}

export function rpcMemoryIoReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'memory-io', ...opts })
}

export function rpcMemoryIoActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'memory-io', ...opts })
}

export function rpcMemoryProposalsListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'memory-proposals', ...opts })
}

export function rpcMemoryProposalsReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'memory-proposals', ...opts })
}

export function rpcMemoryProposalsActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'memory-proposals', ...opts })
}

export function rpcMemoryListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'memory', ...opts })
}

export function rpcMemoryReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'memory', ...opts })
}

export function rpcMemoryActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'memory', ...opts })
}

export function rpcMessagingListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'messaging', ...opts })
}

export function rpcMessagingReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'messaging', ...opts })
}

export function rpcMessagingActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'messaging', ...opts })
}

export function rpcMindmapListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'mindmap', ...opts })
}

export function rpcMindmapReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'mindmap', ...opts })
}

export function rpcMindmapActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'mindmap', ...opts })
}

export function rpcNotesImportListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'notes-import', ...opts })
}

export function rpcNotesImportReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'notes-import', ...opts })
}

export function rpcNotesImportActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'notes-import', ...opts })
}

export function rpcNotesListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'notes', ...opts })
}

export function rpcNotesReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'notes', ...opts })
}

export function rpcNotesActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'notes', ...opts })
}

export function rpcOauthListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'oauth', ...opts })
}

export function rpcOauthReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'oauth', ...opts })
}

export function rpcOauthActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'oauth', ...opts })
}

export function rpcOnboardingListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'onboarding', ...opts })
}

export function rpcOnboardingReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'onboarding', ...opts })
}

export function rpcOnboardingActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'onboarding', ...opts })
}

export function rpcOpenclawListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'openclaw', ...opts })
}

export function rpcOpenclawReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'openclaw', ...opts })
}

export function rpcOpenclawActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'openclaw', ...opts })
}

export function rpcOrgsListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'orgs', ...opts })
}

export function rpcOrgsReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'orgs', ...opts })
}

export function rpcOrgsActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'orgs', ...opts })
}

export function rpcPagesListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'pages', ...opts })
}

export function rpcPagesReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'pages', ...opts })
}

export function rpcPagesActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'pages', ...opts })
}

export function rpcPluginBridgeListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'plugin-bridge', ...opts })
}

export function rpcPluginBridgeReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'plugin-bridge', ...opts })
}

export function rpcPluginBridgeActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'plugin-bridge', ...opts })
}

export function rpcPrivacyListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'privacy', ...opts })
}

export function rpcPrivacyReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'privacy', ...opts })
}

export function rpcPrivacyActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'privacy', ...opts })
}

export function rpcProjectsListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'projects', ...opts })
}

export function rpcProjectsReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'projects', ...opts })
}

export function rpcProjectsActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'projects', ...opts })
}

export function rpcResourcesListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'resources', ...opts })
}

export function rpcResourcesReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'resources', ...opts })
}

export function rpcResourcesActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'resources', ...opts })
}

export function rpcServerListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'server', ...opts })
}

export function rpcServerReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'server', ...opts })
}

export function rpcServerActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'server', ...opts })
}

export function rpcSessionForeignImportListResult(opts: {
  source: RpcNativeActionSource
  nativeIds?: readonly string[]
}) {
  return rpcNativeListResult({ surface: 'session-foreign-import', ...opts })
}

export function rpcSessionForeignImportReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'session-foreign-import', ...opts })
}

export function rpcSessionForeignImportActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'session-foreign-import', ...opts })
}

export function rpcSessionsListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'sessions', ...opts })
}

export function rpcSessionsReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'sessions', ...opts })
}

export function rpcSessionsActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'sessions', ...opts })
}

export function rpcSettingsListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'settings', ...opts })
}

export function rpcSettingsReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'settings', ...opts })
}

export function rpcSettingsActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'settings', ...opts })
}

export function rpcSkillsPendingListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'skills-pending', ...opts })
}

export function rpcSkillsPendingReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'skills-pending', ...opts })
}

export function rpcSkillsPendingActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'skills-pending', ...opts })
}

export function rpcSkillsListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'skills', ...opts })
}

export function rpcSkillsReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'skills', ...opts })
}

export function rpcSkillsActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'skills', ...opts })
}

export function rpcSourcesListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'sources', ...opts })
}

export function rpcSourcesReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'sources', ...opts })
}

export function rpcSourcesActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'sources', ...opts })
}

export function rpcStatusesListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'statuses', ...opts })
}

export function rpcStatusesReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'statuses', ...opts })
}

export function rpcStatusesActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'statuses', ...opts })
}

export function rpcSystemListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'system', ...opts })
}

export function rpcSystemReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'system', ...opts })
}

export function rpcSystemActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'system', ...opts })
}

export function rpcTasksListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'tasks', ...opts })
}

export function rpcTasksReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'tasks', ...opts })
}

export function rpcTasksActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'tasks', ...opts })
}

export function rpcToolchainListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'toolchain', ...opts })
}

export function rpcToolchainReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'toolchain', ...opts })
}

export function rpcToolchainActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'toolchain', ...opts })
}

export function rpcTransferListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'transfer', ...opts })
}

export function rpcTransferReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'transfer', ...opts })
}

export function rpcTransferActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'transfer', ...opts })
}

export function rpcVoiceListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'voice', ...opts })
}

export function rpcVoiceReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'voice', ...opts })
}

export function rpcVoiceActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'voice', ...opts })
}

export function rpcWorkspaceListResult(opts: { source: RpcNativeActionSource; nativeIds?: readonly string[] }) {
  return rpcNativeListResult({ surface: 'workspace', ...opts })
}

export function rpcWorkspaceReadResult(opts: { source: RpcNativeActionSource; nativeId?: string }) {
  return rpcNativeReadResult({ surface: 'workspace', ...opts })
}

export function rpcWorkspaceActResult(opts: {
  source: RpcNativeActionSource
  action?: RpcNativeActKind
  granted?: boolean
  nativeId?: string
}) {
  return rpcNativeActResult({ surface: 'workspace', ...opts })
}
