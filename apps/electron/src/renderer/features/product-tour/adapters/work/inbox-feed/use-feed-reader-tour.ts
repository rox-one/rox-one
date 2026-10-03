import { useCallback, useContext, useEffect, useReducer, useRef } from 'react'
import type { FeedItem } from '@rox/shared/feed'
import { TourScopeContext, useTourSignals, useTourTarget } from '../../../runtime/hooks'
import { createFeedReaderObserver } from './index'

/** Instrument the native selection/reader lifecycle; the tour never chooses or mutates an item. */
export function useFeedReaderTour(input: {
  readonly selected: FeedItem | null
  readonly workspaceId: string | null
  readonly readerVisible: boolean
  readonly loaded: boolean
  readonly failed: boolean
  readonly select: (id: string | null) => void
}) {
  const { selected, workspaceId, readerVisible, loaded, failed, select } = input
  const scope = useContext(TourScopeContext)
  const signals = useTourSignals()
  const target = useTourTarget('feed.reader')
  const node = useRef<HTMLElement | null>(null)
  const observer = useRef(createFeedReaderObserver())
  const [selectionRevision, selectedAgain] = useReducer((revision: number) => revision + 1, 0)
  const readerRef = useCallback((element: HTMLElement | null) => {
    node.current = element
    target(element)
  }, [target])
  const selectItem = useCallback((item: FeedItem) => {
    // Capture BEFORE the native route/state change, including keyboard selection.
    observer.current.select(signals.capture(), item, scope)
    select(item.id)
    selectedAgain()
  }, [signals, scope, select])

  useEffect(() => {
    if (!selected || !readerVisible) return
    const element = node.current
    if (!element?.isConnected || element.dataset.testid !== 'feed-detail' || !element.getClientRects().length
      || workspaceId !== scope?.workspaceId) return
    for (const signal of observer.current.rendered(selected, scope, true, loaded, failed)) {
      signals.emit({ binding: signal.binding, operationToken: signal.operationToken!, at: signal.operationStartedAt! },
        signal.name, signal.level, signal.origin, signal.eventToken)
    }
  }, [selected, workspaceId, readerVisible, loaded, failed, scope, signals, selectionRevision])
  useEffect(() => {
    const current = observer.current
    current.clear()
    return () => current.clear()
  }, [workspaceId, scope?.workspaceId, scope?.panelId, scope?.sessionId])

  return { selectItem, readerRef }
}
