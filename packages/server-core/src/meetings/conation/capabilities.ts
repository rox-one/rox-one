/**
 * RMA-I020 / #376 — Conation capability manifest.
 *
 * Source/API GET Conation returned 404. Unconfirmed mutations stay BLOCKED.
 * Fixture schema hashes never open the live write gate. Remote iframe/link
 * does not satisfy a native function.
 */

import type { SoupEntityConcreteType } from '@craft-agent/core/conation/soup'

export const CONATION_SOURCE_AUDIT_ISSUE = 333 as const

/** Live write confirmation. Stays false until AUD #333 supplies SHA + license. */
export const CONATION_LIVE_SCHEMA_CONFIRMED = false as const

/** Fixture / local type-hash. Explicitly not a live gate. */
export const CONATION_FIXTURE_SCHEMA_HASH = 'fixture-not-live' as const

export type ConationDeploymentKind = 'builtin-library' | 'managed-rox' | 'optional-remote'

export type ConationWriterAuthority = 'none' | 'proposal-cas' | 'unsupported'

export type ConationReadbackMethod = 'none' | 'native-repository' | 'provider-get' | 'blocked-until-333'

export type ConationCapabilityStatus =
  | 'native-fallback'
  | 'read-client'
  | 'blocked'
  | 'unsupported'
  | 'flag-off'

export type ConationOperationName =
  | 'list'
  | 'read'
  | 'edit'
  | 'create'
  | 'delete'
  | 'send'
  | 'upload'
  | 'move'
  | 'project-link'
  | 'subscribe'

export type ConationOperationCapability = {
  readonly name: ConationOperationName
  readonly confirmed: boolean
  readonly authScope: string
  readonly pagination: boolean
  readonly subscription: boolean
  readonly writerAuthority: ConationWriterAuthority
  readonly readbackMethod: ConationReadbackMethod
}

export type ConationModuleId =
  | SoupEntityConcreteType
  | 'dss-drive'
  | 'board'
  | 'fund'

export type ConationModuleCapability = {
  readonly id: ConationModuleId
  readonly sourceRef: string
  readonly schemaHash: string | null
  readonly deployment: ConationDeploymentKind
  readonly dataOwner: 'rox-native' | 'conation-remote' | 'unconfirmed'
  readonly status: ConationCapabilityStatus
  readonly nativeFallback: string | null
  readonly iframeSatisfiesNative: false
  readonly prerequisites: readonly string[]
  readonly licenseNotice: 'preserve-upstream' | 'none-until-333'
  readonly secretsInRenderer: false
  readonly operations: readonly ConationOperationCapability[]
  readonly notes: string
}

const blockedWrite = (
  name: ConationOperationName,
  authScope: string,
): ConationOperationCapability => ({
  name,
  confirmed: false,
  authScope,
  pagination: false,
  subscription: false,
  writerAuthority: 'unsupported',
  readbackMethod: 'blocked-until-333',
})

const nativeListRead = (
  authScope: string,
  pagination: boolean,
): readonly ConationOperationCapability[] => [
  {
    name: 'list',
    confirmed: false,
    authScope,
    pagination,
    subscription: false,
    writerAuthority: 'none',
    readbackMethod: 'native-repository',
  },
  {
    name: 'read',
    confirmed: false,
    authScope,
    pagination: false,
    subscription: false,
    writerAuthority: 'none',
    readbackMethod: 'native-repository',
  },
  blockedWrite('edit', authScope),
  blockedWrite('create', authScope),
]

function soupModule(
  id: SoupEntityConcreteType,
  status: ConationCapabilityStatus,
  nativeFallback: string | null,
  notes: string,
  extraOps: readonly ConationOperationCapability[] = [],
): ConationModuleCapability {
  return {
    id,
    sourceRef: `AUD#${CONATION_SOURCE_AUDIT_ISSUE}`,
    schemaHash: null,
    deployment: 'optional-remote',
    dataOwner: 'unconfirmed',
    status,
    nativeFallback,
    iframeSatisfiesNative: false,
    prerequisites: ['AUD#333 source SHA/schema/license'],
    licenseNotice: 'none-until-333',
    secretsInRenderer: false,
    operations: [...nativeListRead(`conation:${id}`, true), ...extraOps],
    notes,
  }
}

export const CONATION_MODULES: readonly ConationModuleCapability[] = [
  soupModule(
    'GraphqlSoupDocument',
    'native-fallback',
    'packages/core/src/conation/notes/bridge.ts + native Notes repository',
    'List/read via existing Notes bridge when flag on. Edits stay proposal/CAS until #333.',
    [blockedWrite('project-link', 'conation:GraphqlSoupDocument')],
  ),
  soupModule(
    'GraphqlSoupChat',
    'blocked',
    'native Session transcript — do not dual-write',
    'Soup chat ids may be relations onto native sessions. No second inbox.',
  ),
  soupModule(
    'GraphqlSoupProject',
    'native-fallback',
    'native ProjectInfo / workgraph',
    'Project list/read is an adapter behind native projects RPC. Writes blocked.',
  ),
  soupModule(
    'GraphqlSoupEmailThread',
    'blocked',
    null,
    'No live Mail Conation. Draft/send stay unsupported until #333/#380.',
    [blockedWrite('send', 'conation:GraphqlSoupEmailThread')],
  ),
  soupModule(
    'GraphqlSoupChannel',
    'blocked',
    'native messaging settings — not Conation channels',
    'Channel post is a live write. Unconfirmed schema → unsupported.',
    [blockedWrite('send', 'conation:GraphqlSoupChannel')],
  ),
  soupModule(
    'GraphqlSoupChannelMessage',
    'blocked',
    null,
    'Messages are events on a channel entity, not a second inbox UI.',
    [blockedWrite('send', 'conation:GraphqlSoupChannelMessage')],
  ),
  soupModule(
    'GraphqlSoupCall',
    'blocked',
    null,
    'No fake in-app dialer. Optional call entity only after confirmed schema.',
  ),
  soupModule(
    'GraphqlSoupCalendarEvent',
    'blocked',
    'packages/core/src/calendar native store',
    'Do not merge Soup events into native calendar as live Conation. Writes blocked.',
  ),
  soupModule(
    'GraphqlSoupCrmCompany',
    'blocked',
    null,
    'No live CRM Conation. DisplayName is not a unique key. Mutations blocked.',
    [blockedWrite('edit', 'conation:GraphqlSoupCrmCompany')],
  ),
  soupModule(
    'GraphqlSoupForeignEntity',
    'blocked',
    'native source/connection refs',
    'Map onto source/connection refs; do not invent a third catalog.',
  ),
  soupModule(
    'GraphqlSoupReminder',
    'blocked',
    'native reminder ledger when present',
    'Creating a reminder is a live write with permission. Unconfirmed → blocked.',
    [blockedWrite('create', 'conation:GraphqlSoupReminder')],
  ),
  {
    id: 'dss-drive',
    sourceRef: `AUD#${CONATION_SOURCE_AUDIT_ISSUE}`,
    schemaHash: null,
    deployment: 'optional-remote',
    dataOwner: 'unconfirmed',
    status: 'read-client',
    nativeFallback: 'packages/core/src/conation/dss/client.ts (GET only)',
    iframeSatisfiesNative: false,
    prerequisites: ['AUD#333 signing scheme', 'existing credential broker'],
    licenseNotice: 'none-until-333',
    secretsInRenderer: false,
    operations: [
      {
        name: 'list',
        confirmed: false,
        authScope: 'conation:dss',
        pagination: true,
        subscription: false,
        writerAuthority: 'none',
        readbackMethod: 'provider-get',
      },
      {
        name: 'read',
        confirmed: false,
        authScope: 'conation:dss',
        pagination: false,
        subscription: false,
        writerAuthority: 'none',
        readbackMethod: 'provider-get',
      },
      blockedWrite('upload', 'conation:dss'),
      blockedWrite('move', 'conation:dss'),
    ],
    notes: 'Existing read-only DSS client does not prove upload/move. Invalid signature blocks writes.',
  },
  {
    id: 'board',
    sourceRef: `AUD#${CONATION_SOURCE_AUDIT_ISSUE}`,
    schemaHash: null,
    deployment: 'builtin-library',
    dataOwner: 'rox-native',
    status: 'native-fallback',
    nativeFallback: 'apps/electron KanbanBoard.tsx',
    iframeSatisfiesNative: false,
    prerequisites: [],
    licenseNotice: 'preserve-upstream',
    secretsInRenderer: false,
    operations: [
      {
        name: 'list',
        confirmed: false,
        authScope: 'rox:kanban',
        pagination: false,
        subscription: false,
        writerAuthority: 'proposal-cas',
        readbackMethod: 'native-repository',
      },
      blockedWrite('edit', 'conation:board'),
    ],
    notes: 'One native board. Conation Board panel deep-link is not native integration.',
  },
  {
    id: 'fund',
    sourceRef: `AUD#${CONATION_SOURCE_AUDIT_ISSUE}`,
    schemaHash: null,
    deployment: 'builtin-library',
    dataOwner: 'rox-native',
    status: 'native-fallback',
    nativeFallback: 'native mindmap/pages canvas',
    iframeSatisfiesNative: false,
    prerequisites: [],
    licenseNotice: 'preserve-upstream',
    secretsInRenderer: false,
    operations: [
      {
        name: 'read',
        confirmed: false,
        authScope: 'rox:mindmap',
        pagination: false,
        subscription: false,
        writerAuthority: 'none',
        readbackMethod: 'native-repository',
      },
      blockedWrite('edit', 'conation:fund'),
    ],
    notes: 'Fund pane deep-link is not native. Interactive canvas stays native pages/mindmap.',
  },
]

export const SOUP_TYPE_COUNT = 11 as const

export function listConationModules(): readonly ConationModuleCapability[] {
  return CONATION_MODULES
}

export function capabilityFor(id: ConationModuleId): ConationModuleCapability {
  const found = CONATION_MODULES.find((module) => module.id === id)
  if (!found) {
    throw new Error(`Unknown Conation module: ${id}`)
  }
  return found
}

export function operationCapability(
  id: ConationModuleId,
  name: ConationOperationName,
): ConationOperationCapability | undefined {
  return capabilityFor(id).operations.find((op) => op.name === name)
}

export type ConfirmWriteInput = {
  readonly moduleId: ConationModuleId
  readonly operation: ConationOperationName
  readonly schemaHash?: string | null
  readonly authPresent: boolean
  readonly liveSchemaConfirmed?: boolean
}

export type ConfirmWriteResult =
  | { readonly allowed: true; readonly operation: ConationOperationCapability }
  | {
      readonly allowed: false
      readonly reason:
        | 'missing-schema'
        | 'incompatible-schema'
        | 'fixture-schema-not-live'
        | 'no-auth'
        | 'unsupported-write'
        | 'live-unconfirmed'
      readonly capability: ConationModuleCapability
    }

export function confirmWrite(input: ConfirmWriteInput): ConfirmWriteResult {
  const capability = capabilityFor(input.moduleId)
  const liveConfirmed = input.liveSchemaConfirmed ?? CONATION_LIVE_SCHEMA_CONFIRMED
  const op = operationCapability(input.moduleId, input.operation)

  if (!input.authPresent) {
    return { allowed: false, reason: 'no-auth', capability }
  }
  if (!op || op.writerAuthority === 'unsupported' || op.writerAuthority === 'none') {
    return { allowed: false, reason: 'unsupported-write', capability }
  }
  if (!liveConfirmed) {
    return { allowed: false, reason: 'live-unconfirmed', capability }
  }
  if (!input.schemaHash) {
    return { allowed: false, reason: 'missing-schema', capability }
  }
  if (input.schemaHash === CONATION_FIXTURE_SCHEMA_HASH) {
    return { allowed: false, reason: 'fixture-schema-not-live', capability }
  }
  if (capability.schemaHash && input.schemaHash !== capability.schemaHash) {
    return { allowed: false, reason: 'incompatible-schema', capability }
  }
  if (!op.confirmed) {
    return { allowed: false, reason: 'unsupported-write', capability }
  }
  return { allowed: true, operation: op }
}

export function nativeFallbackFor(id: ConationModuleId): string | null {
  return capabilityFor(id).nativeFallback
}

export function iframeCountsAsNative(id: ConationModuleId): false {
  return capabilityFor(id).iframeSatisfiesNative
}
