/**
 * RMA-I022 / #378 — Board/Fund native identity.
 * One Task id across meeting/board/canvas. Layout is not a semantic relation.
 * Unknown Conation ops stay unsupported. Iframe is not native.
 * In-memory Maps are not a live Board/Fund receipt: stamps stay pending
 * (live:false, not verified; L4 remains not_run).
 */

import { confirmWrite } from './capabilities.ts'
import { blocked, denied, unsupported, type EvidenceLevel, type MeetingOpResult } from '../types.ts'

/** Local native identity only. Never a live/L4 verified receipt. */
function localApplied<T extends string>(
  reason: T,
  evidenceLevel: EvidenceLevel = 'C2',
): MeetingOpResult<T> {
  return { status: 'pending', reason, live: false, evidenceLevel }
}

export type BoardFundSurfaceKind = 'native' | 'iframe' | 'deeplink' | 'second-shell'

export type BoardFundSurfaceOptions = {
  readonly conationEnabled?: boolean
}

/** Conation iframe is a remote pane, never native ROX UI. */
export function iframeIsNativeProduct(): false {
  return false
}

/** Do not ship a second Kanban/Fund product shell beside native views. */
export function secondProductShellEnabled(): false {
  return false
}

export function presentBoardFundSurface(
  kind: BoardFundSurfaceKind,
  _options: BoardFundSurfaceOptions = {},
): MeetingOpResult {
  if (kind === 'iframe') return unsupported('iframe-is-not-native')
  if (kind === 'deeplink') return unsupported('deeplink-is-not-native')
  if (kind === 'second-shell') return unsupported('second-shell-forbidden')
  return localApplied('native-surface', 'U1')
}

export function applyUnknownConationOp(_op: string): MeetingOpResult {
  return unsupported('unknown-conation-op')
}

export type NativeTask = {
  readonly id: string
  readonly title: string
  readonly revision: string
  readonly status: string
  readonly sourceId?: string
}

export type BoardViews = {
  meeting: Map<string, NativeTask>
  board: Map<string, NativeTask>
  canvas: Map<string, NativeTask>
  layout: Map<string, { x: number; y: number }>
  relations: Array<[string, string, 'depends' | 'related']>
}

export function createBoardViews(task: NativeTask): BoardViews {
  const meeting = new Map([[task.id, task]])
  const board = new Map([[task.id, task]])
  const canvas = new Map([[task.id, task]])
  return { meeting, board, canvas, layout: new Map([[task.id, { x: 0, y: 0 }]]), relations: [] }
}

export function taskInViews(views: BoardViews, id: string): NativeTask[] {
  return [views.meeting.get(id), views.board.get(id), views.canvas.get(id)].filter(
    (task): task is NativeTask => Boolean(task),
  )
}

export function renameTask(views: BoardViews, id: string, title: string, origin: 'native' | 'conation' = 'native'): MeetingOpResult {
  if (origin === 'conation') {
    const write = confirmWrite({ moduleId: 'board', operation: 'edit', authPresent: true })
    if (!write.allowed) return blocked('unconfirmed-conation-edit')
  }
  for (const view of [views.meeting, views.board, views.canvas]) {
    const existing = view.get(id)
    if (!existing) return denied('not_found')
    view.set(id, { ...existing, title, revision: String(Number(existing.revision) + 1) })
  }
  return localApplied('renamed')
}

export function unlinkTask(views: BoardViews, id: string): void {
  views.meeting.delete(id)
  views.board.delete(id)
  views.canvas.delete(id)
  views.layout.delete(id)
}

export function sourceDeleted(views: BoardViews, sourceId: string): void {
  for (const view of [views.meeting, views.board, views.canvas]) {
    for (const [id, task] of view) {
      if (task.sourceId === sourceId) view.delete(id)
    }
  }
}

export function dragTask(
  views: BoardViews,
  id: string,
  pos: { x: number; y: number },
  baseRevision: string,
): MeetingOpResult {
  const current = views.board.get(id)
  if (!current) return denied('not_found')
  if (current.revision !== baseRevision) {
    return { status: 'conflict', reason: 'concurrent-drag', live: false, evidenceLevel: 'C2' }
  }
  views.layout.set(id, pos)
  return localApplied('moved')
}

export function linkRelation(
  views: BoardViews,
  from: string,
  to: string,
  kind: 'depends' | 'related',
): MeetingOpResult {
  if (kind === 'depends' && wouldCycle(views.relations, from, to)) {
    return denied('cycle')
  }
  views.relations.push([from, to, kind])
  return localApplied('linked')
}

function wouldCycle(relations: Array<[string, string, string]>, from: string, to: string): boolean {
  const adj = new Map<string, string[]>()
  for (const [a, b, kind] of relations) {
    if (kind !== 'depends') continue
    adj.set(a, [...(adj.get(a) ?? []), b])
  }
  adj.set(from, [...(adj.get(from) ?? []), to])
  const seen = new Set<string>()
  const stack = [to]
  while (stack.length) {
    const node = stack.pop()!
    if (node === from) return true
    if (seen.has(node)) continue
    seen.add(node)
    stack.push(...(adj.get(node) ?? []))
  }
  return false
}
