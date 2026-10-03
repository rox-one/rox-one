import { useCallback, useContext, useEffect, useRef } from 'react'
import type { LocalMeeting } from '../../../../../../shared/meetings-local'
import { TourRuntimeContext, TourScopeContext, useTourSignals, useTourTarget, type TourObservation } from '../../../runtime/hooks'
import { deriveMeetingsAutomationSignals, hasMeetingArtifact, type MeetingArtifactTab } from './index'

/** Select only native rendered content, never an empty editor or transcription spinner. */
export function renderedMeetingArtifact(root: HTMLElement, meeting: LocalMeeting, tab: MeetingArtifactTab): HTMLElement | null {
  const detail = root.querySelector<HTMLElement>('[data-testid="meeting-detail"]')
  if (detail?.dataset.meetingId !== meeting.id || !hasMeetingArtifact(meeting)) return null
  if (tab === 'overview' && meeting.summary?.text.trim()) {
    const summary = detail.querySelector<HTMLTextAreaElement>('[data-testid="meeting-summary"]')
    if (summary?.value === meeting.summary.text) return summary
  }
  if (tab === 'recording' && meeting.audio && meeting.audio.bytes > 0) {
    const player = detail.querySelector<HTMLElement>('[data-testid="meeting-player"]')
    if (player?.querySelector('audio[src]')) return player
  }
  const listSelector = tab === 'transcript' ? 'meeting-transcript' : tab === 'actions' ? 'meeting-actions'
    : tab === 'decisions' ? 'meeting-decisions' : tab === 'documents' ? 'meeting-documents' : null
  if (!listSelector) return null
  const list = detail.querySelector<HTMLElement>(`[data-testid="${listSelector}"]`)
  return list?.querySelector('li') ? list : null
}

export function useMeetingArtifactTour(meeting: LocalMeeting | null, tab: MeetingArtifactTab) {
  const runtime = useContext(TourRuntimeContext)
  const scope = useContext(TourScopeContext)
  const signals = useTourSignals()
  const target = useTourTarget('meetings.artifacts')
  const rootRef = useRef<HTMLElement | null>(null)
  const current = useRef({ meeting, tab, scope, signals })
  current.current = { meeting, tab, scope, signals }
  const pending = useRef<{ observation: TourObservation; meetingId: string; updatedAt: number; tab: MeetingArtifactTab } | null>(null)
  const registered = useRef<HTMLElement | null>(null)

  const refresh = useCallback(() => {
    const { meeting: selected, tab: currentTab, scope: currentScope, signals: currentSignals } = current.current
    const root = rootRef.current
    const owned = selected && currentScope && selected.workspaceId === currentScope.workspaceId
      && (!currentScope.entityId || currentScope.entityId === selected.id)
    const content = root && owned && selected ? renderedMeetingArtifact(root, selected, currentTab) : null
    // Before opening content, the real tab controls are the place to choose an artifact.
    const tabs = root && owned && selected && hasMeetingArtifact(selected)
      ? root.querySelector<HTMLElement>('[data-testid="meeting-detail"] [role="tablist"]') : null
    const next = content ?? tabs
    if (registered.current !== next) { target(next); registered.current = next }
    const opening = pending.current
    if (!opening || !selected || !currentScope) return
    if (selected.id !== opening.meetingId || selected.updatedAt !== opening.updatedAt) {
      pending.current = null
      return
    }
    if (!content || currentTab !== opening.tab) return
    pending.current = null
    const observations = deriveMeetingsAutomationSignals({
      scope: currentScope, observation: opening.observation, selectedId: selected.id, meeting: selected,
      expectedMeetingId: opening.meetingId, expectedUpdatedAt: opening.updatedAt,
      artifactRendered: true, eventToken: crypto.randomUUID(), at: Date.now(),
    })
    for (const signal of observations) currentSignals.emit(opening.observation, signal.name, signal.level, signal.origin, signal.eventToken)
  }, [target])

  const ref = useCallback((node: HTMLDivElement | null) => {
    rootRef.current = node
    refresh()
  }, [refresh])

  useEffect(() => {
    registered.current = null
    if (!runtime?.enabled) { pending.current = null; target(null); return }
    refresh()
    const observer = new MutationObserver(refresh)
    if (rootRef.current) observer.observe(rootRef.current, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'data-meeting-id'] })
    return () => { observer.disconnect(); target(null); registered.current = null }
  }, [runtime?.enabled, refresh, target, meeting?.id, meeting?.updatedAt, tab])

  const open = useCallback((nextTab: MeetingArtifactTab) => {
    const { meeting: selected, signals: currentSignals } = current.current
    const observation = currentSignals.capture()
    pending.current = selected && observation
      ? { observation, meetingId: selected.id, updatedAt: selected.updatedAt, tab: nextTab } : null
    refresh()
  }, [refresh])
  return { ref, open }
}
