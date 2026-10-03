import type { FeedItem } from '@rox/shared/feed'
import type { CapabilitySnapshot, TourScope, TourSignal } from '../../../contracts'
import type { TourObservation } from '../../../runtime/hooks'

/** Only external material participates in the reading lesson. Agent activity has its own workflow. */
export function isFeedPublication(item: FeedItem): boolean {
  return (item.tab === 'news' || item.tab === 'subscriptions')
    && (item.kind === 'news' || item.kind === 'page-change' || item.kind === 'x-post')
}

function sameScope(left: TourScope, right: TourScope): boolean {
  return left.workspaceId === right.workspaceId && left.panelId === right.panelId
    && left.sessionId === right.sessionId && (left.entityId === undefined || left.entityId === right.entityId)
}

/** Feed has no revision field. Compare the native material locally, excluding user annotations. */
function sameMaterial(expected: FeedItem, rendered: FeedItem): boolean {
  return expected.id === rendered.id && expected.at === rendered.at && expected.tab === rendered.tab
    && expected.kind === rendered.kind && expected.title === rendered.title && expected.summary === rendered.summary
    && expected.url === rendered.url && expected.status === rendered.status && expected.error === rendered.error
    && expected.author === rendered.author && expected.sourceId === rendered.sourceId && expected.sourceTitle === rendered.sourceTitle
    && expected.sessionId === rendered.sessionId && expected.automationId === rendered.automationId
    && expected.ref?.id === rendered.ref?.id && expected.ref?.type === rendered.ref?.type
    && expected.ref?.workspaceId === rendered.ref?.workspaceId && expected.ref?.parentId === rendered.ref?.parentId
}

export type InboxFeedEvidence =
  | { readonly kind: 'inbox-triage'; readonly action: 'done' | 'snooze'; readonly scope: TourScope }
  | { readonly kind: 'feed-reader-rendered'; readonly scope: TourScope; readonly expected: FeedItem;
      readonly rendered: FeedItem | null; readonly readerVisible: boolean; readonly loaded: boolean; readonly failed?: boolean }

export function deriveInboxFeedSignals(
  observation: TourObservation | null,
  evidence: InboxFeedEvidence,
  at = Date.now(),
): readonly TourSignal[] {
  // Done/Snooze is queue organization. It is never permission resolution or verified evidence.
  if (!observation || evidence.kind !== 'feed-reader-rendered') return []
  const item = evidence.rendered
  if (!sameScope(observation.binding, evidence.scope) || !evidence.readerVisible || !evidence.loaded || evidence.failed
    || !item || !isFeedPublication(item) || !sameMaterial(evidence.expected, item)
    || item.ref?.workspaceId && item.ref.workspaceId !== observation.binding.workspaceId) return []
  return [{ name: 'feed.item-opened', binding: observation.binding, operationToken: observation.operationToken,
    operationStartedAt: observation.at, eventToken: crypto.randomUUID(), at, level: 'observed', origin: 'ui-observation' }]
}

/** Arms at a user selection and consumes evidence only after the actual matching reader is mounted. */
export function createFeedReaderObserver() {
  let pending: { observation: TourObservation; expected: FeedItem; scope: TourScope } | null = null
  return {
    select(observation: TourObservation | null, item: FeedItem, scope: TourScope | null) {
      pending = observation && scope ? {
        observation, expected: { ...item, ...(item.ref ? { ref: { ...item.ref } } : {}) }, scope: { ...scope, entityId: observation.binding.entityId },
      } : null
    },
    clear() { pending = null },
    rendered(item: FeedItem | null, scope: TourScope | null, readerVisible: boolean, loaded: boolean, failed: boolean, at = Date.now()): readonly TourSignal[] {
      if (!pending || !scope) return []
      if (!sameScope(pending.scope, scope) || failed) { pending = null; return [] }
      const signals = deriveInboxFeedSignals(pending.observation, {
        kind: 'feed-reader-rendered', scope, expected: pending.expected, rendered: item, readerVisible, loaded, failed,
      }, at)
      if (signals.length) pending = null
      return signals
    },
  }
}

export function inboxFeedCapabilities(input: {
  readonly workspacePresent: boolean
  readonly inboxApi: boolean
  readonly inboxLoaded: boolean
  readonly inboxFailed: boolean
  readonly feedApi: boolean
  readonly feedLoaded: boolean
  readonly feedFailed: boolean
  readonly feedItems: readonly FeedItem[]
}): CapabilitySnapshot {
  const available = (api: boolean, loaded: boolean, failed: boolean) => {
    if (!input.workspacePresent) return { state: 'pending', reason: 'missing-entity' } as const
    if (!api) return { state: 'unavailable', reason: 'api-unavailable' } as const
    if (failed) return { state: 'unavailable', reason: 'network-unavailable' } as const
    if (!loaded) return { state: 'pending', reason: 'installing' } as const
    return { state: 'ready' } as const
  }
  const feed = available(input.feedApi, input.feedLoaded, input.feedFailed)
  return {
    'inbox.available': available(input.inboxApi, input.inboxLoaded, input.inboxFailed),
    'feed.available': feed.state === 'ready' && !input.feedItems.some(isFeedPublication)
      ? { state: 'pending', reason: 'missing-entity' } : feed,
  }
}
