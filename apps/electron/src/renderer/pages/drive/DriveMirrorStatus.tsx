/**
 * DriveMirrorStatus — the app-config mirror card of the «Данные приложения»
 * block (R13).
 *
 * It drives the host-side `drive:mirror*` surface: status is polled while a run
 * is in flight, and Старт/Пауза/Отмена are the only ways work starts. The card
 * never promises more than the host reports: without an S3 destination the RPC
 * answers `UNSUPPORTED_OPERATION`, and the card renders that as an honest
 * «зеркалирование недоступно» line instead of live buttons. Progress comes
 * straight from `MirrorQueueStatus` (files/bytes); nothing is invented.
 *
 * The presentational `DriveMirrorStatusCard` is exported on its own so the
 * surface can be rendered (and tested) from an explicit view.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pause, Play, X } from 'lucide-react'
import type { MirrorQueueState, MirrorQueueStatus, MirrorRunResult } from '@rox/shared/drive'
import { Button } from '@/components/ui/button'
import { toErrorMessage } from '../../lib/errors'
import { formatBytes } from './format'

/** Result of `drive:mirrorStatus` (structural mirror of the server-core shape). */
export interface DriveMirrorStatusSnapshot {
  configured: boolean
  status: MirrorQueueStatus
  lastResult?: MirrorRunResult
}

/** Result of `drive:mirrorStart`. */
export interface DriveMirrorStartSnapshot {
  configured: boolean
  started: boolean
  status: MirrorQueueStatus
}

/** The `drive:mirror*` RPC surface the card drives. */
export interface DriveMirrorApi {
  driveMirrorStatus(): Promise<DriveMirrorStatusSnapshot>
  driveMirrorStart(): Promise<DriveMirrorStartSnapshot>
  driveMirrorPause(): Promise<DriveMirrorStatusSnapshot>
  driveMirrorCancel(): Promise<DriveMirrorStatusSnapshot>
}

/** Everything the card can render, resolved from the RPC surface. */
export type DriveMirrorView =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; status: MirrorQueueStatus; lastResult: MirrorRunResult | null }

const POLL_MS = 1500

const STATE_I18N_KEY: Record<MirrorQueueState, string> = {
  idle: 'drive.mirror.state.idle',
  running: 'drive.mirror.state.running',
  paused: 'drive.mirror.state.paused',
  cancelled: 'drive.mirror.state.cancelled',
  error: 'drive.mirror.state.error',
}

/** RPC failures arrive as `{ code, message }` objects; read the code defensively. */
function errorCodeOf(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null
  return typeof error.code === 'string' ? error.code : null
}

function viewForError(error: unknown): DriveMirrorView {
  if (errorCodeOf(error) === 'UNSUPPORTED_OPERATION') return { kind: 'unavailable' }
  return { kind: 'error', message: toErrorMessage(error) }
}

function mirrorClient(api?: DriveMirrorApi): DriveMirrorApi | null {
  if (api) return api
  if (typeof window === 'undefined' || !window.electronAPI) return null
  return window.electronAPI
}

export interface DriveMirrorStatusCardProps {
  view: DriveMirrorView
  /** True while an action RPC is in flight; disables every button. */
  busy: boolean
  onStart: () => void
  onPause: () => void
  onCancel: () => void
}

export function DriveMirrorStatusCard({ view, busy, onStart, onPause, onCancel }: DriveMirrorStatusCardProps) {
  const { t } = useTranslation()
  const state = view.kind === 'ready' ? view.status.state : null
  const interactive = view.kind === 'ready' && !busy
  const canStart = interactive && state !== 'running'
  const canPause = interactive && state === 'running'
  const canCancel = interactive && (state === 'running' || state === 'paused')

  return (
    <div
      data-testid="drive-mirror-status"
      className="mt-2 rounded-md border border-border/60 bg-card/40 px-3 py-2"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium">{t('drive.mirror.title')}</span>
        <span
          data-testid="drive-mirror-state"
          data-state={state ?? view.kind}
          className="shrink-0 rounded-full border border-border/60 px-2 py-0.5 text-caption text-muted-foreground"
        >
          {state ? t(STATE_I18N_KEY[state]) : t('drive.mirror.loading')}
        </span>
      </div>
      <p className="mt-0.5 text-caption text-muted-foreground">{t('drive.mirror.subtitle')}</p>

      {view.kind === 'unavailable' && (
        <p data-testid="drive-mirror-unavailable" className="mt-1 text-xs text-muted-foreground">
          {t('drive.mirror.unavailable')}
        </p>
      )}
      {view.kind === 'error' && (
        <p data-testid="drive-mirror-error" className="mt-1 text-xs text-status-danger">
          {t('drive.mirror.error', { message: view.message })}
        </p>
      )}

      {view.kind === 'ready' && (
        <div className="mt-1 space-y-0.5 text-caption text-muted-foreground">
          <p data-testid="drive-mirror-progress">
            {t('drive.mirror.progress', {
              done: view.status.filesDone,
              total: view.status.filesTotal,
              size: formatBytes(view.status.bytesDone),
              sizeTotal: formatBytes(view.status.bytesTotal),
            })}
          </p>
          {view.status.lastCommittedAtMs !== undefined && (
            <p data-testid="drive-mirror-last-committed">
              {t('drive.mirror.lastCommitted', { time: new Date(view.status.lastCommittedAtMs).toLocaleString() })}
            </p>
          )}
          {view.lastResult && (
            <p data-testid="drive-mirror-last-result">
              {t('drive.mirror.lastResult', {
                added: view.lastResult.added,
                changed: view.lastResult.changed,
                removed: view.lastResult.removed,
                size: formatBytes(view.lastResult.bytesUploaded),
              })}
              {view.lastResult.errors.length > 0
                ? ` · ${t('drive.mirror.lastResultErrors', { count: view.lastResult.errors.length })}`
                : ''}
            </p>
          )}
        </div>
      )}

      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" data-testid="drive-mirror-start" disabled={!canStart} onClick={onStart}>
          <Play className="icon-toolbar" />
          {t('drive.mirror.action.start')}
        </Button>
        <Button size="sm" variant="outline" data-testid="drive-mirror-pause" disabled={!canPause} onClick={onPause}>
          <Pause className="icon-toolbar" />
          {t('drive.mirror.action.pause')}
        </Button>
        <Button size="sm" variant="outline" data-testid="drive-mirror-cancel" disabled={!canCancel} onClick={onCancel}>
          <X className="icon-toolbar" />
          {t('drive.mirror.action.cancel')}
        </Button>
      </div>
      <p className="mt-1 text-caption text-muted-foreground">{t('drive.mirror.note')}</p>
    </div>
  )
}

export interface DriveMirrorStatusProps {
  /** Explicit client (tests, stories); defaults to `window.electronAPI`. */
  api?: DriveMirrorApi
}

export function DriveMirrorStatus({ api }: DriveMirrorStatusProps) {
  const [view, setView] = useState<DriveMirrorView>({ kind: 'loading' })
  const [busy, setBusy] = useState(false)
  /** Bumped after every action so the poll effect re-reads the status at once. */
  const [tick, setTick] = useState(0)
  const clientRef = useRef<DriveMirrorApi | null>(mirrorClient(api))

  useEffect(() => {
    const client = clientRef.current
    if (!client) {
      setView({ kind: 'unavailable' })
      return
    }
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined

    const load = async (): Promise<void> => {
      try {
        const snapshot = await client.driveMirrorStatus()
        if (!alive) return
        setView({ kind: 'ready', status: snapshot.status, lastResult: snapshot.lastResult ?? null })
        if (snapshot.status.state === 'running') timer = setTimeout(() => void load(), POLL_MS)
      } catch (error) {
        if (!alive) return
        setView(viewForError(error))
      }
    }

    void load()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [tick])

  const runAction = useCallback(
    (action: (client: DriveMirrorApi) => Promise<DriveMirrorStatusSnapshot | DriveMirrorStartSnapshot>) => {
      const client = clientRef.current
      if (!client) return
      setBusy(true)
      void action(client)
        .then(snapshot => {
          const lastResult = 'lastResult' in snapshot ? snapshot.lastResult ?? null : null
          setView({ kind: 'ready', status: snapshot.status, lastResult })
          setTick(value => value + 1)
        })
        .catch(error => {
          setView(viewForError(error))
        })
        .finally(() => {
          setBusy(false)
        })
    },
    [],
  )

  return (
    <DriveMirrorStatusCard
      view={view}
      busy={busy}
      onStart={() => runAction(client => client.driveMirrorStart())}
      onPause={() => runAction(client => client.driveMirrorPause())}
      onCancel={() => runAction(client => client.driveMirrorCancel())}
    />
  )
}