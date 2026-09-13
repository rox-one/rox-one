/**
 * ROX2-078..080: GraphqlSoupDocument list/read/act.
 *
 * Native Notes vault list/read/write can be live. Soup-bridge rows and
 * playground fixtures are not. Act never goes through CompleteMutationRoot.
 */
import {
  fixtureResult,
  formatRox2EntityId,
  liveResult,
  queuedResult,
  type Rox2Result,
} from './platform-contract.ts'

export type SoupDocumentActionSource = 'native' | 'fixture' | 'conation'
export type SoupDocumentActKind = 'write' | 'destroy' | 'spend'

function nativeDocumentLive(action: 'list' | 'read' | 'act', entityId: string): Rox2Result {
  return liveResult({
    entityId,
    lifecycle: 'succeeded',
    verification: 'receipt_verified',
    receipt: {
      provider: 'native',
      requestId: `soup.document.${action}`,
    },
  })
}

export function soupDocumentListResult(opts: {
  source: SoupDocumentActionSource
  nativeIds?: readonly string[]
}): { result: Rox2Result; entities: string[] } {
  if (opts.source === 'fixture') {
    return {
      result: fixtureResult('soup.document.list.fixture', 'Mocked Soup documents are fixture, not live'),
      entities: [],
    }
  }
  if (opts.source === 'conation') {
    return {
      result: queuedResult(
        'soup.document.list.queued',
        'GraphqlSoupDocument list is queued; native Notes vault is a separate store',
      ),
      entities: [],
    }
  }
  const entities = [...(opts.nativeIds ?? [])]
  return {
    result: nativeDocumentLive('list', formatRox2EntityId('note', entities[0] ?? 'list')),
    entities,
  }
}

export function soupDocumentReadResult(opts: {
  source: SoupDocumentActionSource
  nativeId?: string
}): { result: Rox2Result; entityId: string | null } {
  if (opts.source === 'fixture') {
    return {
      result: fixtureResult('soup.document.read.fixture', 'Mocked Soup document read is fixture, not live'),
      entityId: null,
    }
  }
  if (opts.source === 'conation') {
    return {
      result: queuedResult(
        'soup.document.read.queued',
        'GraphqlSoupDocument read is queued; native Notes vault is a separate store',
      ),
      entityId: null,
    }
  }
  if (!opts.nativeId) {
    return {
      result: queuedResult('soup.document.not-found', 'Missing note is an error, not a fake record'),
      entityId: null,
    }
  }
  return {
    result: nativeDocumentLive('read', formatRox2EntityId('note', opts.nativeId)),
    entityId: formatRox2EntityId('note', opts.nativeId),
  }
}

export function soupDocumentActResult(opts: {
  source: SoupDocumentActionSource
  action?: SoupDocumentActKind
  granted?: boolean
  nativeId?: string
}): Rox2Result {
  if (opts.source === 'fixture') {
    return fixtureResult('soup.document.act.fixture', 'Playground note writes are fixture, not live')
  }
  if (opts.source === 'conation') {
    return queuedResult(
      'soup.document.act.queued',
      'GraphqlSoupDocument act is queued; no CompleteMutationRoot',
    )
  }
  const action = opts.action ?? 'write'
  if (action === 'spend') {
    return queuedResult('soup.document.not-spend', 'Notes writes are local, not spend')
  }
  if (action === 'destroy' && opts.granted !== true) {
    return queuedResult('soup.document.grant-required', 'destroy requires an explicit grant')
  }
  return nativeDocumentLive('act', formatRox2EntityId('note', opts.nativeId ?? 'act'))
}
