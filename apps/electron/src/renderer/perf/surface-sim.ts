import { IpcCallCounter } from './ipc-counter'
import { nowMs } from './stats'
import type { PerfMarkName, SessionIndexEntry, VaultNoteEntry } from './types'

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
    const days = new Map<string, number>()
    for (const session of sessions) {
      const day = new Date(session.lastMessageAt).toISOString().slice(0, 10)
      days.set(day, (days.get(day) ?? 0) + 1)
    }
    void days.size
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
