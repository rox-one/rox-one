/**
 * Background work for the extra screens while the app is open. Today: the
 * Радар daily sweep (once per local day after `dailyHour`, only when topics
 * exist and the flag is on). Idempotent across re-renders/windows via a
 * module lock + a per-day claim in localStorage.
 */
import { useEffect } from 'react'
import { useAtomValue } from 'jotai'
import i18n from 'i18next'
import { extraScreenFlagAtoms } from '@/atoms/extra-screens'
import { localDateKey, shouldRunDailySweep } from './radar/radar-model'
import { loadRadar, runRadarSweep } from './radar/radar-store'
import { loadFocusState, localDay as focusDay, type FocusState } from '@/lib/focus-session'
import { collectDaySummary, writeDaySummary } from './focus/focus-summary'

const CHECK_EVERY_MS = 10 * 60 * 1000
const FIRST_CHECK_MS = 30 * 1000
let radarInflight = false

function claimKey(workspaceId: string): string {
  return `rox.radar.claim.v1:${workspaceId}`
}

/** Returns true when this caller won the claim for today's daily sweep. */
export function claimDailySweep(workspaceId: string, now: number, storage: Pick<Storage, 'getItem' | 'setItem'> = window.localStorage): boolean {
  const today = localDateKey(now)
  try {
    if (storage.getItem(claimKey(workspaceId)) === today) return false
    storage.setItem(claimKey(workspaceId), today)
    return true
  } catch {
    return false
  }
}

export async function maybeRunDailyRadar(workspaceId: string, now = Date.now()): Promise<boolean> {
  if (radarInflight) return false
  const data = loadRadar(workspaceId)
  if (!shouldRunDailySweep(data, now)) return false
  if (!claimDailySweep(workspaceId, now)) return false
  radarInflight = true
  try {
    const ru = (i18n.language ?? 'ru').startsWith('ru')
    await runRadarSweep(workspaceId, 'daily', ru ? 'ru' : 'en', `${ru ? 'Радар' : 'Radar'} · ${localDateKey(now)}`)
    return true
  } catch (error) {
    console.warn('[radar] daily sweep failed', error)
    return false
  } finally {
    radarInflight = false
  }
}

let focusSummaryInflight = false

/** End-of-day summary: once per local day after `summaryHour` (null = manual only). */
export function shouldAutoWriteSummary(state: Pick<FocusState, 'summaryHour' | 'summaryWrittenFor'>, now: number): boolean {
  if (state.summaryHour == null) return false
  if (new Date(now).getHours() < state.summaryHour) return false
  return state.summaryWrittenFor !== focusDay(now)
}

export async function maybeWriteDaySummary(workspaceId: string, now = Date.now()): Promise<boolean> {
  if (focusSummaryInflight || !shouldAutoWriteSummary(loadFocusState(), now)) return false
  focusSummaryInflight = true
  try {
    const ru = (i18n.language ?? 'ru').startsWith('ru')
    const { text, hasActivity } = await collectDaySummary(workspaceId, now, ru ? 'ru' : 'en', null)
    // Nothing happened today — don't write an empty section.
    if (!hasActivity) return false
    await writeDaySummary(workspaceId, text, now)
    return true
  } catch (error) {
    console.warn('[focus] day summary failed', error)
    return false
  } finally {
    focusSummaryInflight = false
  }
}

export function useExtraScreensBackground(workspaceId: string | null): void {
  const radarOn = useAtomValue(extraScreenFlagAtoms.radar)
  const focusOn = useAtomValue(extraScreenFlagAtoms.focus)
  useEffect(() => {
    if (!workspaceId || !focusOn) return
    const tick = () => { void maybeWriteDaySummary(workspaceId) }
    const first = window.setTimeout(tick, FIRST_CHECK_MS * 2)
    const timer = window.setInterval(tick, CHECK_EVERY_MS)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(timer)
    }
  }, [workspaceId, focusOn])
  useEffect(() => {
    if (!workspaceId || !radarOn) return
    const tick = () => { void maybeRunDailyRadar(workspaceId) }
    const first = window.setTimeout(tick, FIRST_CHECK_MS)
    const timer = window.setInterval(tick, CHECK_EVERY_MS)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(timer)
    }
  }, [workspaceId, radarOn])
}
