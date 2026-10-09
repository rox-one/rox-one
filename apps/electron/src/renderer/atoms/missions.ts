/**
 * G3 «Миссии» — derived mission view (pilot, read-only).
 *
 * A mission is a *grouping*, not a container: with no `Mission` entity yet,
 * this pilot derives missions from the session metadata we already have —
 * `SessionMeta.projectId` — plus a single «Без миссии» bucket for sessions
 * with no project. Nothing is written or persisted here; the full entity +
 * `MissionLink` model lands in a later stage of the proposal.
 *
 * `deriveMissionsAtom` is a pure, memoized (jotai-derived) selector over
 * `sessionMetaMapAtom`. It never mutates its inputs and creates fresh view
 * objects, so consumers can render safely.
 */
import { atom } from 'jotai'
import { sessionMetaMapAtom, type SessionMeta } from './sessions'

/** Live state of one session lane, derived from its metadata. */
export type MissionLaneState = 'running' | 'waiting' | 'error' | 'idle'

/**
 * Derived mission status. The proposal's full entity status set
 * (`active | waiting | paused | draft | done`) needs persistence; while
 * missions are derived we only report what the current sessions can show.
 */
export type MissionStatus = 'active' | 'waiting' | 'idle'

/** One member session of a mission (a lane on the board). */
export interface MissionLane {
  sessionId: string
  name: string
  state: MissionLaneState
  /** Epoch ms of the session's last activity — the lane sort key. */
  lastActivityAt: number
}

/** A derived mission row. */
export interface MissionView {
  /** Stable id: the owning `projectId`, or `NO_MISSION_ID` for the bucket. */
  id: string
  /** Owning project id, or null for the «Без миссии» bucket. */
  projectId: string | null
  /** Display-name source: the projectId. Project names resolve via the catalog. */
  name: string
  status: MissionStatus
  lanes: MissionLane[]
  laneCount: number
  running: number
  waiting: number
  lastActivityAt: number
}

/** Bucket id for sessions that are not bound to any project. */
export const NO_MISSION_ID = '__no_mission__'

/**
 * Group the live session metadata into missions by `projectId`, ordered by
 * most recent activity, with the «Без миссии» bucket last. Hidden and
 * archived sessions are excluded so the board reflects active work.
 */
export const deriveMissionsAtom = atom<MissionView[]>((get) => {
  const metaMap = get(sessionMetaMapAtom)
  const groups = new Map<string | null, SessionMeta[]>()
  for (const meta of metaMap.values()) {
    if (meta.hidden || meta.isArchived) continue
    const key = meta.projectId ?? null
    const bucket = groups.get(key)
    if (bucket) bucket.push(meta)
    else groups.set(key, [meta])
  }

  const views: MissionView[] = []
  for (const [projectId, metas] of groups) {
    const lanes: MissionLane[] = metas.map((meta) => ({
      sessionId: meta.id,
      name: meta.name ?? meta.preview ?? meta.id,
      state: meta.lastMessageRole === 'error' ? 'error'
        : meta.isProcessing ? 'running'
          : meta.hasUnread ? 'waiting'
            : 'idle',
      lastActivityAt: meta.lastMessageAt ?? meta.createdAt ?? 0,
    }))
    lanes.sort((a, b) => b.lastActivityAt - a.lastActivityAt)
    const running = lanes.filter((lane) => lane.state === 'running').length
    const waiting = lanes.filter((lane) => lane.state === 'waiting').length
    views.push({
      id: projectId ?? NO_MISSION_ID,
      projectId,
      name: projectId ?? NO_MISSION_ID,
      status: running > 0 ? 'active' : waiting > 0 ? 'waiting' : 'idle',
      lanes,
      laneCount: lanes.length,
      running,
      waiting,
      lastActivityAt: lanes[0]?.lastActivityAt ?? 0,
    })
  }

  // Real missions by recency, then the unassigned bucket.
  views.sort((a, b) => {
    if ((a.projectId === null) !== (b.projectId === null)) return a.projectId === null ? 1 : -1
    return b.lastActivityAt - a.lastActivityAt
  })
  return views
})