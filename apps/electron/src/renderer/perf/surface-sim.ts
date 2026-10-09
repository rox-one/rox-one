import { buildYearHeatmap } from '@rox/shared/sessions/collection'
import {
  EMPTY_RETENTION,
  advanceRetention,
  detectKeepAliveCapacity,
  type RetentionState,
} from '../lib/surface-keepalive'
import {
  WARMUP_SLICE_MS,
  WarmupScheduler,
  buildWarmupSteps,
  type IdleDeadlineLike,
  type WarmupStatus,
  type WarmupStep,
} from '../lib/warmup'
import { IpcCallCounter } from './ipc-counter'
import { nowMs } from './stats'
import type { BenchmarkSample, IpcCounts, PerfMarkName, SessionIndexEntry, VaultNoteEntry } from './types'

export interface SurfaceTiming {
  name: PerfMarkName
  durationMs: number
  reloadedCollection: boolean
}

function scanTitles(items: Array<{ name?: string; title?: string }>, needle: string): number {
  const lower = needle.toLowerCase()
  let hits = 0
  for (const item of items) {
    const text = (item.name ?? item.title ?? '').toLowerCase()
    if (text.includes(lower)) hits += 1
  }
  return hits
}

export function simulateColdReady(
  sessions: SessionIndexEntry[],
  ipc: IpcCallCounter,
): SurfaceTiming {
  const t0 = nowMs()
  ipc.record('sessions.list')
  const index = new Map<string, SessionIndexEntry>()
  for (const session of sessions) index.set(session.id, session)
  void index.size
  return { name: 'cold_ready', durationMs: nowMs() - t0, reloadedCollection: true }
}

export function simulateViewSwitch(
  sessions: SessionIndexEntry[],
  view: 'list' | 'table' | 'kanban' | 'heatmap',
): SurfaceTiming {
  const t0 = nowMs()
  if (view === 'kanban') {
    const columns = new Map<string, number>()
    for (const session of sessions) {
      columns.set(session.sessionStatus, (columns.get(session.sessionStatus) ?? 0) + 1)
    }
    void columns.size
  } else if (view === 'heatmap') {
    const now = sessions[0]?.lastMessageAt ?? Date.now()
    const year = new Date(now).getFullYear()
    const grid = buildYearHeatmap(
      sessions.map((session) => ({
        id: session.id,
        lastMessageAt: session.lastMessageAt,
        createdAt: session.createdAt,
      })),
      year,
      now,
    )
    void grid.weeks.length
  } else {
    void sessions.length
  }
  return { name: 'view_switch', durationMs: nowMs() - t0, reloadedCollection: false }
}

export function simulateNotesOpen(notes: VaultNoteEntry[]): SurfaceTiming {
  const t0 = nowMs()
  const byPath = new Map<string, VaultNoteEntry>()
  for (const note of notes) byPath.set(note.path, note)
  void byPath.get(notes[0]?.path ?? '')
  return { name: 'notes_open', durationMs: nowMs() - t0, reloadedCollection: false }
}

export function simulateBrowserChrome(tabCount = 8): SurfaceTiming {
  const t0 = nowMs()
  const tabs = Array.from({ length: tabCount }, (_, i) => ({ id: `tab-${i}`, title: `Tab ${i}` }))
  void scanTitles(tabs, 'tab')
  return { name: 'browser_chrome', durationMs: nowMs() - t0, reloadedCollection: false }
}

export function simulateDropdownOpen(
  items: Array<{ id: string; name: string }>,
  query: string,
): SurfaceTiming {
  const t0 = nowMs()
  void scanTitles(items, query)
  return { name: 'dropdown_open', durationMs: nowMs() - t0, reloadedCollection: false }
}

export function simulateCanvasLayout(nodeCount = 80): SurfaceTiming {
  const t0 = nowMs()
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    id: i,
    x: (i % 10) * 48,
    y: Math.floor(i / 10) * 48,
  }))
  let extent = 0
  for (const node of nodes) extent = Math.max(extent, node.x + node.y)
  void extent
  return { name: 'canvas_layout', durationMs: nowMs() - t0, reloadedCollection: false }
}

/**
 * PERF-10 (#1577) — keep-alive + warm-up model.
 *
 * Drives the real retention policy (`advanceRetention`) and the real idle
 * warm-up queue (`WarmupScheduler`) over a virtual clock, then pays the
 * documented cost model for each visit. The numbers are a model, not a
 * measurement: what the gate protects is the *structure* — a revisit among the
 * retained surfaces must not pay a chunk or a read again, and a first visit
 * after warm-up must not either. Breaking any of those jumps a sample over its
 * budget or adds an RPC.
 */
export const SURFACE_CHUNK_MODEL_MS = 140
export const SURFACE_DATA_MODEL_MS = 130
export const SURFACE_WARM_FIRST_VISIT_MS = 26
export const SURFACE_RETAINED_PAINT_MS = 2
export const WARMUP_STEP_CPU_MS = 2

/** Surfaces whose chunk and data the warm-up plan covers (rail surfaces). */
export const KEEPALIVE_WARM_SURFACES = ['notes', 'tasks', 'skillsCatalog', 'inbox', 'planWorkspace'] as const

export interface SurfaceKeepAliveSimulationInput {
  /** Surface keys visited, in order (route ids of the rail surfaces). */
  surfaces?: readonly string[]
  /** Chunks the warm-up preloads. */
  routes?: readonly string[]
  capacity?: number
  /** `false` models a shell that never started the warm-up. */
  warmup?: boolean
}

export interface SurfaceKeepAliveSimulation {
  samples: BenchmarkSample[]
  retainedKeys: readonly string[]
  warmup: WarmupStatus
}

export async function simulateSurfaceKeepAlive(
  input: SurfaceKeepAliveSimulationInput = {},
): Promise<SurfaceKeepAliveSimulation> {
  const surfaces = input.surfaces ?? KEEPALIVE_WARM_SURFACES
  const routes = input.routes ?? surfaces
  const capacity = input.capacity ?? detectKeepAliveCapacity()
  let clock = 0
  const warmedChunks = new Set<string>()
  const warmedData = new Set<string>()
  const idle = idleHost()
  // A step costs one slice unit of synchronous CPU; the reads it starts are
  // I/O and do not add to the slice (the real steps are equally thin).
  const stepCost = () => { clock += WARMUP_STEP_CPU_MS }
  const steps: WarmupStep[] = buildWarmupSteps({
    warmSessionMeta: stepCost,
    recentSessionIds: () => ['s-1', 's-2', 's-3'],
    warmTranscriptTail: () => {},
    warmNotesAndTasks: () => {
      stepCost()
      warmedData.add('notes')
      warmedData.add('tasks')
    },
    warmSkillsAndSources: () => {
      stepCost()
      warmedData.add('skillsCatalog')
      warmedData.add('integrationsCatalog')
      warmedData.add('agentProfiles')
    },
    warmAgentProfiles: stepCost,
    warmInboxAndFeed: () => {
      stepCost()
      warmedData.add('inbox')
      warmedData.add('feed')
    },
    warmCalendar: () => {
      stepCost()
      warmedData.add('planWorkspace')
    },
    warmRouteChunks: names => {
      stepCost()
      for (const name of names) warmedChunks.add(name)
    },
    routeChunkNames: routes,
  })
  const scheduler = new WarmupScheduler(input.warmup === false ? [] : steps, {
    requestIdle: idle.requestIdle,
    cancelIdle: idle.cancelIdle,
    inputTarget: null,
    now: () => clock,
  })
  if (input.warmup !== false) {
    scheduler.start()
    await idle.drain()
  }

  const samples: BenchmarkSample[] = []
  let state: RetentionState = EMPTY_RETENTION
  let outgoing: { key: string; node: null } | null = null
  for (const surface of surfaces) {
    const warm = warmedChunks.has(surface) && warmedData.has(surface)
    const ipc: IpcCounts = warm ? {} : { 'sessions.messages': 1 }
    samples.push({
      name: 'surface_first_warm',
      durationMs: warm ? SURFACE_WARM_FIRST_VISIT_MS : SURFACE_CHUNK_MODEL_MS + SURFACE_DATA_MODEL_MS,
      ipc,
      reloadedCollection: false,
    })
    state = advanceRetention(state, outgoing, surface, capacity)
    outgoing = { key: surface, node: null }
  }
  // Revisits of every surface the user visited (the acceptance scenario), in
  // the order they were opened — the ones that fell out of the capacity pay a
  // cold data read again.
  for (const key of surfaces) {
    const retained = state.keys.includes(key)
    const ipc: IpcCounts = retained ? {} : { 'sessions.messages': 1 }
    samples.push({
      name: 'surface_revisit',
      durationMs: retained ? SURFACE_RETAINED_PAINT_MS : SURFACE_DATA_MODEL_MS,
      ipc,
      reloadedCollection: false,
    })
    state = advanceRetention(state, outgoing, key, capacity)
    outgoing = { key, node: null }
  }
  return { samples, retainedKeys: state.keys, warmup: scheduler.status() }
}

/** In-memory idle host: `runAll()` drains the queue (no timers in the bench). */
function idleHost() {
  const pending = new Map<number, (deadline: IdleDeadlineLike) => void>()
  let nextHandle = 1
  return {
    requestIdle: (callback: (deadline: IdleDeadlineLike) => void) => {
      const handle = nextHandle++
      pending.set(handle, callback)
      return handle
    },
    cancelIdle: (handle: number) => { pending.delete(handle) },
    /** Drain the queue; promise continuations run between callbacks. */
    drain: async () => {
      let guard = 0
      while (pending.size > 0 && guard < 1000) {
        guard += 1
        const entry = pending.entries().next().value as [number, (deadline: IdleDeadlineLike) => void]
        pending.delete(entry[0])
        entry[1]({ didTimeout: false, timeRemaining: () => WARMUP_SLICE_MS })
        await new Promise(resolve => setTimeout(resolve, 0))
      }
    },
  }
}
