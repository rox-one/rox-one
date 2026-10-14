/**
 * Tray state bridge — reports this window's slice of the macOS menu-bar item
 * to main: the unified inbox count (the same number as the in-app bell), the
 * five most recent sessions, working agents, the real rox.one balance and any
 * live meeting / voice capture. Main folds the per-window reports into the red
 * badge, the menu and the record/stop item. Renders nothing.
 */
import * as React from 'react'
import { useAtomValue } from 'jotai'
import type { TrayStateReport } from '@rox/shared/protocol'
import { sessionMetaMapAtom, type SessionMeta } from '@/atoms/sessions'
import { useOptionalAppShellContext } from '@/context/AppShellContext'
import { useInboxItems } from '@/hooks/useInboxItems'
import { useRecorder, type RecorderState } from '@/lib/meetings/recorder'
import { useDictationSession, type DictationSession } from '@/components/app-shell/input/voice-dictation-state'
import { getSessionTitle } from '@/utils/session'

const RECENT_LIMIT = 5
const BALANCE_POLL_MS = 5 * 60_000

/** Newest-first sessions of the workspace, without hidden/archived ones. */
export function recentTraySessions(sessions: Iterable<SessionMeta>, workspaceId: string | null, limit = RECENT_LIMIT): TrayStateReport['recentSessions'] {
  const list: SessionMeta[] = []
  for (const s of sessions) {
    if (s.hidden || s.isArchived) continue
    if (workspaceId && s.workspaceId !== workspaceId) continue
    list.push(s)
  }
  list.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))
  return list.slice(0, limit).map(s => ({ id: s.id, title: getSessionTitle(s) }))
}

/** Meeting capture wins over dictation (they cannot run together). */
export function trayRecording(rec: Pick<RecorderState, 'status' | 'accumulatedMs' | 'runningSince'>, dictation: DictationSession, now: number): TrayStateReport['recording'] {
  if (rec.status === 'recording' || rec.status === 'paused') {
    const startedAt = rec.runningSince != null ? rec.runningSince - rec.accumulatedMs : now - rec.accumulatedMs
    return { kind: 'meeting', startedAt, paused: rec.status === 'paused' }
  }
  if (dictation.active) return { kind: 'voice', startedAt: dictation.startedAt ?? now, paused: false }
  return null
}

export function TrayStateBridge() {
  const report = window.electronAPI?.reportTrayState
  const shell = useOptionalAppShellContext()
  const workspaceId = shell?.activeWorkspaceId ?? null
  const { counts } = useInboxItems({ withRemote: false })
  const sessionMap = useAtomValue(sessionMetaMapAtom)
  const rec = useRecorder()
  const dictation = useDictationSession()
  const [balance, setBalance] = React.useState<number | null>(null)

  React.useEffect(() => {
    const api = window.electronAPI
    if (!api?.getRoxBalance) return
    let cancelled = false
    const load = () => {
      void api.getRoxBalance()
        .then(result => {
          if (cancelled) return
          setBalance(result.status === 'ok' && 'balance' in result && Number.isFinite(result.balance) ? result.balance : null)
        })
        .catch(() => { if (!cancelled) setBalance(null) })
    }
    load()
    const timer = window.setInterval(load, BALANCE_POLL_MS)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [workspaceId])

  const recentSessions = React.useMemo(() => recentTraySessions(sessionMap.values(), workspaceId), [sessionMap, workspaceId])
  const activeAgents = React.useMemo(() => {
    let n = 0
    for (const s of sessionMap.values()) if (s.isProcessing && (!workspaceId || s.workspaceId === workspaceId)) n++
    return n
  }, [sessionMap, workspaceId])
  // Keyed on the fields that change the start time, not on the level meter.
  const recording = React.useMemo(
    () => trayRecording(rec, dictation, Date.now()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rec.status, rec.accumulatedMs, rec.runningSince, dictation.active, dictation.startedAt],
  )

  const last = React.useRef('')
  React.useEffect(() => {
    if (!report) return
    const next: TrayStateReport = { unreadCount: counts.all, activeAgents, recentSessions, balance, recording }
    const key = JSON.stringify(next)
    if (key === last.current) return
    last.current = key
    void report(next).catch(() => { last.current = '' })
  }, [report, counts.all, activeAgents, recentSessions, balance, recording])

  return null
}
