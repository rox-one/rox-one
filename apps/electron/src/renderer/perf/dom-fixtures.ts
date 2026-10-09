import { createPrng } from './prng'
import type { NoteSummary } from '../../shared/types'

export const DOM_FIXTURE_SEED = 20261009

export interface DomSessionRow {
  id: string
  title: string
  status: 'todo' | 'in-progress' | 'needs-review' | 'done'
  lastMessageAt: number
  isFlagged: boolean
  hasUnread: boolean
  labels: string[]
}

const SESSION_STATUSES: DomSessionRow['status'][] = ['todo', 'in-progress', 'needs-review', 'done']
const LABEL_POOL = ['feature', 'bug', 'priority::high', 'research', 'ops', 'design', 'infra']

/**
 * Deterministic session rows for the DOM harness. Deliberately shaped like the
 * real `SessionList` row payload so the rendered weight matches production.
 */
export function createDomSessionRows(count: number, seed = DOM_FIXTURE_SEED): DomSessionRow[] {
  const rand = createPrng(seed + count)
  const origin = 1_704_067_200_000
  return Array.from({ length: count }, (_, i) => {
    const lastMessageAt = origin + Math.floor(rand() * 86_400_000 * 90)
    return {
      id: `sess-${String(i).padStart(5, '0')}`,
      title: `Session ${i} — ${['fix auth flow', 'refactor store', 'review PR', 'debug IPC', 'write tests'][i % 5]}`,
      status: SESSION_STATUSES[i % SESSION_STATUSES.length] ?? 'todo',
      lastMessageAt,
      isFlagged: i % 11 === 0,
      hasUnread: i % 7 === 0,
      labels: i % 5 === 0 ? [LABEL_POOL[i % LABEL_POOL.length] ?? 'feature'] : [],
    }
  })
}

/**
 * Deterministic `NoteSummary[]` for the production NotesNavigationSidebar.
 * Notes are spread across nested folders so the folder tree is exercised.
 */
export function createDomNotes(count: number, seed = DOM_FIXTURE_SEED): NoteSummary[] {
  const rand = createPrng(seed + count + 31)
  const origin = 1_704_067_200_000
  const folderCount = 24
  const subCount = 6
  return Array.from({ length: count }, (_, i) => {
    const folder = `area-${String(i % folderCount).padStart(2, '0')}`
    const sub = `topic-${i % subCount}`
    const id = `${folder}/${sub}/note-${String(i).padStart(5, '0')}`
    const updatedAt = origin + Math.floor(rand() * 86_400_000 * 30)
    const tagCount = i % 4
    const tags = Array.from({ length: tagCount }, (_, t) => `tag-${(i + t) % 12}`)
    return {
      id,
      title: `Note ${i} — ${['meeting', 'spec', 'journal', 'retro', 'idea'][i % 5]}`,
      path: `/vault/${id}.md`,
      relativePath: `${id}.md`,
      tags,
      properties: {},
      links: [],
      assetRefs: [],
      updatedAt,
      createdAt: updatedAt - Math.floor(rand() * 86_400_000),
      size: 200 + Math.floor(rand() * 8_000),
    }
  })
}