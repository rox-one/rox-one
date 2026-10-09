/**
 * BrowserIntelSettingsSection — privacy surface for the local Browser
 * Intelligence pipeline: consent, run control, live progress, index stats and
 * learned profile slots.
 *
 * The bridge is declared locally instead of on `ElectronAPI` so this section
 * compiles against a preload that has not shipped the channels yet; every
 * member is optional and the whole section degrades to nothing without
 * `getBrowserIntelState`.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  BrowserIntelState,
  IntelligenceStats,
  PipelineProgress,
  ProfileSlotRecord,
} from '@rox/browser-intel'
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsToggle,
} from '@/components/settings'
import { Button } from '@/components/ui/button'

interface BrowserIntelBridge {
  getBrowserIntelState?: () => Promise<BrowserIntelState>
  setBrowserIntelConsent?: (consent: boolean) => Promise<BrowserIntelState>
  getBrowserIntelStats?: () => Promise<IntelligenceStats>
  getBrowserIntelSlots?: () => Promise<ProfileSlotRecord[]>
  startBrowserIntelRun?: () => Promise<{ started: boolean }>
  cancelBrowserIntelRun?: () => Promise<{ cancelled: boolean }>
  onBrowserIntelProgress?: (callback: (progress: PipelineProgress) => void) => () => void
  onBrowserIntelStateChanged?: (callback: (state: BrowserIntelState) => void) => () => void
}

function channel<K extends keyof BrowserIntelBridge>(
  api: Record<string, unknown>,
  key: K,
): BrowserIntelBridge[K] | undefined {
  const value = api[key]
  return typeof value === 'function' ? (value as BrowserIntelBridge[K]) : undefined
}

function bridge(): BrowserIntelBridge | undefined {
  if (typeof window === 'undefined') return undefined
  const api: unknown = window.electronAPI
  if (typeof api !== 'object' || api === null) return undefined
  const record = api as Record<string, unknown>
  return {
    getBrowserIntelState: channel(record, 'getBrowserIntelState'),
    setBrowserIntelConsent: channel(record, 'setBrowserIntelConsent'),
    getBrowserIntelStats: channel(record, 'getBrowserIntelStats'),
    getBrowserIntelSlots: channel(record, 'getBrowserIntelSlots'),
    startBrowserIntelRun: channel(record, 'startBrowserIntelRun'),
    cancelBrowserIntelRun: channel(record, 'cancelBrowserIntelRun'),
    onBrowserIntelProgress: channel(record, 'onBrowserIntelProgress'),
    onBrowserIntelStateChanged: channel(record, 'onBrowserIntelStateChanged'),
  }
}

const countFormat = new Intl.NumberFormat()

function formatCount(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? countFormat.format(value) : '—'
}

function formatBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${countFormat.format(bytes)} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`
}

function slotPercent(confidence: number): number {
  if (!Number.isFinite(confidence)) return 0
  return Math.min(100, Math.max(0, Math.round(confidence * 100)))
}

export function BrowserIntelSettingsSection() {
  const { t } = useTranslation()
  const [state, setState] = useState<BrowserIntelState | null>(null)
  const [stats, setStats] = useState<IntelligenceStats | null>(null)
  const [slots, setSlots] = useState<ProfileSlotRecord[] | null>(null)
  const [consent, setConsent] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<PipelineProgress | null>(null)
  const generation = useRef(0)
  const savingRef = useRef(false)
  // Retry re-sends the value the user last chose, not the rolled-back one.
  const retryRef = useRef<boolean | null>(null)

  const refreshSidecars = useCallback(async (api: BrowserIntelBridge) => {
    const request = generation.current
    try {
      const [nextStats, nextSlots] = await Promise.all([
        api.getBrowserIntelStats?.(),
        api.getBrowserIntelSlots?.(),
      ])
      if (request !== generation.current) return
      if (nextStats !== undefined) setStats(nextStats)
      if (nextSlots !== undefined) setSlots(nextSlots)
    } catch {
      // Sidecar data is advisory; consent and run control stay usable.
    }
  }, [])

  useEffect(() => {
    const api = bridge()
    if (!api?.getBrowserIntelState) return
    const request = ++generation.current
    void api.getBrowserIntelState()
      .then((next) => {
        if (request !== generation.current) return
        setState(next)
        setConsent(next.consent)
        if (next.lastResult) setRunning(false)
      })
      .catch(() => { if (request === generation.current) setFailed(true) })
    void refreshSidecars(api)

    const offProgress = api.onBrowserIntelProgress?.((next) => {
      // current >= total is the terminal event for a stage: nothing left to index there.
      if (next.total > 0 && next.current >= next.total) {
        setRunning(false)
        setProgress(null)
        return
      }
      setProgress(next)
      setRunning(true)
    })
    const offState = api.onBrowserIntelStateChanged?.((next) => {
      setState(next)
      setConsent(next.consent)
      // A persisted run receipt means the pipeline finished.
      if (next.lastResult) {
        setRunning(false)
        setProgress(null)
      }
      void refreshSidecars(api)
    })
    return () => {
      generation.current = request + 1
      offProgress?.()
      offState?.()
    }
  }, [refreshSidecars])

  const apply = async (next: boolean) => {
    const api = bridge()
    if (!api?.setBrowserIntelConsent || savingRef.current) return
    const previous = consent ?? false
    savingRef.current = true
    retryRef.current = next
    setConsent(next)
    setSaving(true)
    setFailed(false)
    try {
      const written = await api.setBrowserIntelConsent(next)
      retryRef.current = null
      if (written && typeof written === 'object') {
        setState(written)
        setConsent(written.consent)
      }
      await refreshSidecars(api)
    } catch {
      setConsent(previous)
      setFailed(true)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const startRun = async () => {
    const api = bridge()
    if (!api?.startBrowserIntelRun) return
    setRunning(true)
    setProgress(null)
    try {
      const result = await api.startBrowserIntelRun()
      if (result && result.started === false) setRunning(false)
    } catch {
      setRunning(false)
    }
    await refreshSidecars(api)
  }

  const cancelRun = async () => {
    const api = bridge()
    if (!api?.cancelBrowserIntelRun) return
    try {
      await api.cancelBrowserIntelRun()
    } finally {
      setRunning(false)
      setProgress(null)
    }
    await refreshSidecars(api)
  }

  if (!bridge()?.getBrowserIntelState) return null

  const enabled = state?.consent === true
  const lastRunAt = state?.lastRunAt ?? null
  const visibleSlots = (slots ?? []).slice(0, 6)

  return (
    <div data-testid="browser-intel-settings">
      <SettingsSection title={t('settings.browserIntel.title')}>
        <SettingsCard>
          <SettingsToggle
            label={t('settings.browserIntel.enable')}
            description={
              enabled
                ? t('settings.browserIntel.revokeNote')
                : t('settings.browserIntel.description')
            }
            checked={enabled}
            disabled={saving}
            onCheckedChange={(checked) => { void apply(checked) }}
          />
          {failed ? (
            <SettingsRow label={t('onboarding.browserIntel.savingError')}>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={saving}
                onClick={() => { if (retryRef.current !== null) void apply(retryRef.current) }}
              >
                {t('common.retry')}
              </Button>
            </SettingsRow>
          ) : null}
          <SettingsRow label={lastRunAt !== null
            ? t('settings.browserIntel.lastRun', { date: new Date(lastRunAt).toLocaleString() })
            : t('settings.browserIntel.neverRun')}
          >
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={running || !enabled}
                onClick={() => { void startRun() }}
              >
                {t('settings.browserIntel.indexNow')}
              </Button>
              {running ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => { void cancelRun() }}
                >
                  {t('settings.browserIntel.cancelRun')}
                </Button>
              ) : null}
            </div>
          </SettingsRow>
          {running ? (
            <SettingsRow
              label={t('onboarding.browserIntel.indexing')}
              data-testid="browser-intel-progress-live"
            >
              <span className="text-sm tabular-nums text-muted-foreground">
                {progress && progress.total > 0
                  ? t('onboarding.browserIntel.progress', { done: progress.current, total: progress.total })
                  : null}
              </span>
            </SettingsRow>
          ) : null}
          <SettingsRow label={t('settings.browserIntel.statsProfiles')}>
            <span className="text-sm tabular-nums" data-stat="profiles">
              {formatCount(stats?.profiles)}
            </span>
          </SettingsRow>
          <SettingsRow label={t('settings.browserIntel.statsUrls')}>
            <span className="text-sm tabular-nums" data-stat="urls">
              {formatCount(stats?.urls)}
            </span>
          </SettingsRow>
          <SettingsRow label={t('settings.browserIntel.statsVisits')}>
            <span className="text-sm tabular-nums" data-stat="visits">
              {formatCount(stats?.visits)}
            </span>
          </SettingsRow>
          <SettingsRow label={t('settings.browserIntel.statsSlots')}>
            <span className="text-sm tabular-nums" data-stat="slots">
              {formatCount(stats?.slots)}
            </span>
          </SettingsRow>
          <SettingsRow label={t('settings.browserIntel.statsDbSize')}>
            <span className="text-sm tabular-nums" data-stat="dbSize">
              {formatBytes(stats?.dbBytes)}
            </span>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('settings.browserIntel.slotsTitle')}>
        <SettingsCard>
          {visibleSlots.length > 0 ? (
            visibleSlots.map((record) => (
              <SettingsRow key={record.slot} label={record.slot}>
                <span className="text-sm tabular-nums">
                  {`${slotPercent(record.confidence)}%`}
                </span>
              </SettingsRow>
            ))
          ) : (
            <p className="px-4 py-3 text-xs text-muted-foreground">
              {t('settings.browserIntel.slotsEmpty')}
            </p>
          )}
        </SettingsCard>
      </SettingsSection>
    </div>
  )
}