/**
 * Радар — persistence + sweep lifecycle (start a read-only agent session,
 * later parse its JSON digest into the stored sweep). Shared by the page and
 * the background daily scheduler.
 */
import { extractJsonBlock, readAgentRun, startAgentRun } from '@/lib/extra-screens/agent-run'
import { loadWorkspaceJson, newLocalId, saveWorkspaceJson } from '@/lib/extra-screens/storage'
import { externalFeedItems, loadFeed } from '@/lib/extra-screens/use-rox-sources'
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

export function saveRadar(workspaceId: string | null, data: RadarData): void {
  saveWorkspaceJson(RADAR_NS, workspaceId, data)
}

export async function runRadarSweep(
  workspaceId: string,
  trigger: RadarSweep['trigger'],
  language: 'ru' | 'en',
  sessionName: string,
): Promise<RadarSweep> {
  const now = Date.now()
  const data = loadRadar(workspaceId)
  if (data.topics.length === 0) throw new Error('no topics')
  let feedContext: { title: string; url?: string; source?: string }[] = []
  try {
    const feed = await loadFeed(workspaceId)
    feedContext = externalFeedItems(feed.items)
      .filter((item) => item.at >= now - 24 * 3600 * 1000)
      .map((item) => ({ title: item.title, url: item.url, source: item.sourceTitle }))
  } catch {
    feedContext = []
  }
  const sessionId = await startAgentRun({
    workspaceId,
    name: sessionName,
    prompt: buildRadarPrompt(data.topics, now, language, feedContext),
  })
  const sweep: RadarSweep = { id: newLocalId('sw'), sessionId, date: localDateKey(now), startedAt: now, trigger }
  const fresh = loadRadar(workspaceId)
  saveRadar(workspaceId, { ...fresh, sweeps: [sweep, ...fresh.sweeps].slice(0, MAX_SWEEPS) })
  return sweep
}

export type SweepSyncState = 'running' | 'done' | 'failed' | 'missing'

/** Read the sweep session; once the agent finished, store parsed items (or parseFailed). */
export async function syncRadarSweep(workspaceId: string, sweepId: string): Promise<SweepSyncState> {
  const sweep = loadRadar(workspaceId).sweeps.find((s) => s.id === sweepId)
  if (!sweep) return 'missing'
  if (sweep.parsedAt) return sweep.parseFailed ? 'failed' : 'done'
  const run = await readAgentRun(sweep.sessionId)
  if (!run.exists) return 'missing'
  if (run.processing || !run.text) return run.processing ? 'running' : 'running'
  const digest = parseRadarDigest(extractJsonBlock(run.text))
  const latest = loadRadar(workspaceId)
  const patch: Partial<RadarSweep> = digest
    ? { items: digest.items.map((item) => ({ ...item, at: run.updatedAt ?? sweep.startedAt })), notes: digest.notes, parsedAt: Date.now(), parseFailed: undefined }
    : { parsedAt: Date.now(), parseFailed: true, notes: run.text.slice(0, 600) }
  saveRadar(workspaceId, {
    ...latest,
    sweeps: latest.sweeps.map((s) => (s.id === sweepId ? { ...s, ...patch } : s)),
  })
  return digest ? 'done' : 'failed'
}
