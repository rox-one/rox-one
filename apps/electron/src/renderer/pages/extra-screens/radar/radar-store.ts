/**
 * Радар — persistence + sweep lifecycle (start a read-only agent session,
 * later parse its JSON digest into the stored sweep). Shared by the page and
 * the background daily scheduler.
 */
import { extractJsonBlock, readAgentRun, startAgentRun } from '@/lib/extra-screens/agent-run'
import { loadWorkspaceJson, newLocalId, saveWorkspaceJson } from '@/lib/extra-screens/storage'
import { externalFeedItems, loadFeed } from '@/lib/extra-screens/use-rox-sources'
import { known, unknown, type RuntimeLaunch } from '@rox/core/runtime-trace'
import {
  MAX_SWEEPS,
  buildRadarPrompt,
  localDateKey,
  normalizeRadarData,
  parseRadarDigest,
  type RadarData,
  type RadarSweep,
} from './radar-model'

export const RADAR_NS = 'radar'

export function loadRadar(workspaceId: string | null): RadarData {
  return loadWorkspaceJson(RADAR_NS, workspaceId, normalizeRadarData)
}

export function saveRadar(workspaceId: string | null, data: RadarData): boolean {
  try { return saveWorkspaceJson(RADAR_NS, workspaceId, data) } catch { return false }
}

export interface RadarRunOptions { isCurrent?: () => boolean }
const starts = new Map<string, Promise<RadarSweep>>()
const MAX_SWEEP_MS = 15 * 60_000
async function assertWorkspace(workspaceId: string, options: RadarRunOptions): Promise<void> {
  if (options.isCurrent?.() === false) throw new Error('workspace-changed')
  const api = window.electronAPI
  if (typeof api.getWindowWorkspace === 'function' && await api.getWindowWorkspace() !== workspaceId) throw new Error('workspace-changed')
  if (options.isCurrent?.() === false) throw new Error('workspace-changed')
}
function patchSweep(workspaceId: string, id: string, patch: Partial<RadarSweep>): void {
  const latest = loadRadar(workspaceId)
  if (!latest.sweeps.some(sweep => sweep.id === id)) return
  if (!saveRadar(workspaceId, { ...latest, sweeps: latest.sweeps.map(sweep => sweep.id === id ? { ...sweep, ...patch } : sweep) })) throw new Error('storage-unavailable')
}

async function expireSweep(workspaceId: string, sweep: RadarSweep, options: RadarRunOptions): Promise<void> {
  if (sweep.sessionId) {
    // Cancel the prior run before a retry can start another provider request.
    try { await window.electronAPI.cancelProcessing(sweep.sessionId, true) } catch { throw new Error('timeout') }
    await assertWorkspace(workspaceId, options)
  }
  patchSweep(workspaceId, sweep.id, { status: 'failed', parsedAt: Date.now(), parseFailed: true, error: 'timeout' })
}

async function startSweep(
  workspaceId: string,
  trigger: RadarSweep['trigger'],
  language: 'ru' | 'en',
  sessionName: string,
  options: RadarRunOptions,
): Promise<RadarSweep> {
  await assertWorkspace(workspaceId, options)
  const now = Date.now()
  const data = loadRadar(workspaceId)
  const active = data.sweeps.find(sweep => !sweep.parsedAt && sweep.status !== 'failed' && sweep.status !== 'missing' && now - sweep.startedAt < MAX_SWEEP_MS)
  if (active) return active
  if (data.topics.length === 0) throw new Error('no-topics')
  for (const expired of data.sweeps.filter(sweep => !sweep.parsedAt && now - sweep.startedAt >= MAX_SWEEP_MS)) {
    await expireSweep(workspaceId, expired, options)
  }
  const claim: RadarSweep = { id: newLocalId('sw'), sessionId: '', date: localDateKey(now), startedAt: now, trigger, status: 'starting' }
  const reserved = loadRadar(workspaceId)
  if (!saveRadar(workspaceId, { ...reserved, sweeps: [claim, ...reserved.sweeps].slice(0, MAX_SWEEPS) })) throw new Error('storage-unavailable')
  try {
    const api = window.electronAPI
    const sources = typeof api.getSources === 'function' ? await api.getSources(workspaceId) : []
    await assertWorkspace(workspaceId, options)
    const available = sources.filter(source => source.config.enabled && !['needs_auth', 'failed', 'local_disabled'].includes(source.config.connectionStatus ?? '')).map(source => source.config.slug)
    const selected = [...new Set(data.topics.flatMap(topic => topic.sourceSlugs ?? available))].filter(slug => available.includes(slug))
    let feedContext: { title: string; url?: string; source?: string; at?: number }[] = []
    try {
      const feed = data.topics.some(topic => topic.includeWorkspace !== false) ? await loadFeed(workspaceId) : { items: [] }
      feedContext = externalFeedItems(feed.items)
        .filter((item) => item.at >= now - 24 * 3600 * 1000)
        .map((item) => ({ title: item.title, url: item.url, source: item.sourceTitle, at: item.at }))
    } catch {
      feedContext = []
    }
    await assertWorkspace(workspaceId, options)
    const feedItems = feedContext.flatMap(item => item.url && /^https?:\/\//i.test(item.url) && item.source && item.at !== undefined
      ? [{ url: item.url, source: item.source, at: item.at }] : []).slice(0, 100)
    patchSweep(workspaceId, claim.id, { sourceSlugs: selected, feedItems })
    let runtimeLaunch: RuntimeLaunch | undefined
    if (trigger === 'daily') {
      let timezone: string | undefined
      try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined } catch { /* The local timezone was not exposed. */ }
      runtimeLaunch = {
        kind: 'scheduled',
        // The existing once-per-local-day policy owns this saved sweep claim.
        scheduleId: `rox.radar.claim.v1:${workspaceId}`,
        triggerId: claim.date,
        occurrenceId: claim.id,
        ...(timezone ? { timezone } : {}),
        scheduledAt: unknown('not-recorded'),
      }
    }
    const sessionId = await startAgentRun({
      workspaceId,
      name: sessionName,
      prompt: buildRadarPrompt(data.topics, now, language, feedContext) + '\n' + (language === 'ru' ? 'Доступные sourceSlugs: ' : 'Available sourceSlugs: ') + (selected.join(', ') || '(none)'),
      enabledSourceSlugs: selected,
      ...(runtimeLaunch ? { runtimeLaunch } : {}),
      async onCreated(id) {
        await assertWorkspace(workspaceId, options)
        patchSweep(workspaceId, claim.id, { sessionId: id, status: 'running' })
        if (runtimeLaunch) runtimeLaunch.dispatchedAt = known(Date.now(), 'radar-dispatch')
      },
    })
    return loadRadar(workspaceId).sweeps.find(sweep => sweep.id === claim.id) ?? { ...claim, sessionId, status: 'running' }
  } catch (error) {
    const code = error instanceof Error && ['workspace-changed', 'storage-unavailable'].includes(error.message) ? error.message : 'start-failed'
    patchSweep(workspaceId, claim.id, { status: 'failed', parsedAt: Date.now(), parseFailed: true, error: code })
    throw new Error(code)
  }
}

export function runRadarSweep(workspaceId: string, trigger: RadarSweep['trigger'], language: 'ru' | 'en', sessionName: string, options: RadarRunOptions = {}): Promise<RadarSweep> {
  const existing = starts.get(workspaceId)
  if (existing) return existing
  const operation = async () => startSweep(workspaceId, trigger, language, sessionName, options)
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  const pending: Promise<RadarSweep> = Promise.resolve(locks ? locks.request(`rox-radar-start:${workspaceId}`, operation) : operation())
    .finally(() => { if (starts.get(workspaceId) === pending) starts.delete(workspaceId) })
  starts.set(workspaceId, pending)
  return pending
}

export type SweepSyncState = 'running' | 'done' | 'failed' | 'missing'

/** Read the sweep session; once the agent finished, store parsed items (or parseFailed). */
export async function syncRadarSweep(workspaceId: string, sweepId: string, options: RadarRunOptions = {}): Promise<SweepSyncState> {
  await assertWorkspace(workspaceId, options)
  const sweep = loadRadar(workspaceId).sweeps.find((s) => s.id === sweepId)
  if (!sweep) return 'missing'
  if (sweep.parsedAt) return sweep.status === 'missing' ? 'missing' : sweep.parseFailed ? 'failed' : 'done'
  const now = Date.now()
  const fail = (error: string, state: 'failed' | 'missing' = 'failed'): SweepSyncState => {
    patchSweep(workspaceId, sweep.id, { status: state, parsedAt: now, parseFailed: true, error }); return state
  }
  if (now - sweep.startedAt >= MAX_SWEEP_MS) {
    await expireSweep(workspaceId, sweep, options)
    return 'failed'
  }
  if (!sweep.sessionId) return sweep.status === 'starting' ? 'running' : fail('session-missing', 'missing')
  const run = await readAgentRun(sweep.sessionId)
  await assertWorkspace(workspaceId, options)
  if (!run.exists) return fail('session-missing', 'missing')
  if (run.processing) return 'running'
  if (!run.text) return now - sweep.startedAt < 10_000 ? 'running' : fail('empty-output')
  const digest = parseRadarDigest(extractJsonBlock(run.text))
  if (!digest) return fail('invalid-output')
  const items = digest.items.flatMap(item => {
    if (!item.url) return []
    const feed = sweep.feedItems?.find(entry => entry.url === item.url)
    const cited = feed ? { ...item, source: feed.source, at: feed.at } : item
    if (!feed && (!item.sourceSlug || !sweep.sourceSlugs?.includes(item.sourceSlug))) return []
    if (cited.source === '—' || cited.at == null || cited.at < sweep.startedAt - 24 * 3600_000 || cited.at > now + 60_000) return []
    return [cited]
  })
  const patch: Partial<RadarSweep> = { items, notes: digest.notes, parsedAt: now, parseFailed: undefined, status: 'done',
    error: items.length < digest.items.length ? 'unsupported-items' : undefined }
  patchSweep(workspaceId, sweepId, patch)
  return 'done'
}
