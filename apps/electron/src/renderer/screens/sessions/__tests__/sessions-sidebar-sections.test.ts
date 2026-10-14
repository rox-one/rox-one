import { describe, expect, it } from 'bun:test'
import { buildSessionsSidebarSections } from '../sessions-sidebar-sections'

const ids = (secs: ReturnType<typeof buildSessionsSidebarSections>, id: string) =>
  secs.find((s) => s.id === id)?.items.map((i) => i.id)

describe('buildSessionsSidebarSections', () => {
  it('returns no groups for an empty workspace', () => {
    expect(buildSessionsSidebarSections([])).toEqual([])
  })

  it('places each session in exactly one top group and dedupes Recent', () => {
    const secs = buildSessionsSidebarSections(
      [
        { id: 'p', isFlagged: true, isProcessing: true, lastMessageAt: 5 },
        { id: 'a', sessionStatus: 'needs-review', lastMessageAt: 4 },
        { id: 'perm', lastMessageAt: 1 },
        { id: 'r', isProcessing: true, lastMessageAt: 3 },
        { id: 'old', lastMessageAt: 2 },
      ],
      { pendingPermissionIds: new Set(['perm']) },
    )
    expect(ids(secs, 'pinned')).toEqual(['p'])
    expect(ids(secs, 'attention')).toEqual(['a', 'perm'])
    expect(ids(secs, 'running')).toEqual(['r'])
    expect(ids(secs, 'recent')).toEqual(['old'])
    expect(secs.find((s) => s.id === 'pinned')?.items[0]?.badge).toBe('running')
  })

  it('puts status-only in-progress sessions under Running with a muted status badge', () => {
    const secs = buildSessionsSidebarSections([{ id: 's', sessionStatus: 'in-progress' }])
    expect(secs.find((s) => s.id === 'running')?.items[0]).toMatchObject({ id: 's', badge: 'status' })
  })

  it('counts labels by id (values stripped) and shows the configured name', () => {
    const secs = buildSessionsSidebarSections([{ id: '1', labels: ['prio::high', 'prio::low'] }], {
      labelIdOf: (e) => e.split('::')[0]!,
      labelNameOf: (id) => (id === 'prio' ? 'Priority' : id),
    })
    expect(secs.find((s) => s.id === 'labels')?.items).toMatchObject([{ label: 'Priority', count: 1, target: { kind: 'label', label: 'prio' } }])
  })

  it('excludes hidden, archived and subtask sessions everywhere', () => {
    const secs = buildSessionsSidebarSections([
      { id: 'h', hidden: true, labels: ['x'] },
      { id: 'ar', isArchived: true, isFlagged: true },
      { id: 'sub', parentSessionId: 'z' },
    ])
    expect(secs).toEqual([])
  })

  it('aggregates labels by frequency and counts folder members that are visible', () => {
    const secs = buildSessionsSidebarSections(
      [
        { id: '1', labels: ['b', 'a', 'a'] },
        { id: '2', labels: ['b'] },
        { id: '3', labels: ['a'], isArchived: true },
      ],
      { folders: [{ id: 'f', name: 'Rox' }], folderAssignments: { '1': 'f', '3': 'f', gone: 'f' } },
    )
    expect(secs.find((s) => s.id === 'labels')?.items.map((i) => [i.label, i.count])).toEqual([
      ['b', 2],
      ['a', 1],
    ])
    expect(secs.find((s) => s.id === 'folders')?.items[0]).toMatchObject({ label: 'Rox', count: 1 })
  })

  it('falls back to preview then an i18n key for untitled sessions', () => {
    const secs = buildSessionsSidebarSections([{ id: 'u', lastMessageAt: 2 }, { id: 'v', preview: ' hi ', lastMessageAt: 1 }])
    const items = secs.find((s) => s.id === 'recent')!.items
    expect(items[0]).toMatchObject({ labelKey: 'screens.sessions.untitled' })
    expect(items[1]).toMatchObject({ label: 'hi' })
  })
})

describe('targetKey', () => {
  it('is stable per target', async () => {
    const { targetKey } = await import('../../sidebar-section')
    expect(targetKey({ kind: 'session', sessionId: 'a' })).toBe('session:a')
    expect(targetKey({ kind: 'label', label: 'x' })).toBe('label:x')
  })
})

describe('sessions sidebar projection', () => {
  it('ignores fields the sidebar does not read', async () => {
    const { projectSessionsSidebarInput, sameSessionsProjection } = await import('../sessions-projection')
    const a = projectSessionsSidebarInput([{ id: 's', name: 'A', labels: ['x'], tokenUsage: 1 } as never])
    const b = projectSessionsSidebarInput([{ id: 's', name: 'A', labels: ['x'], tokenUsage: 2 } as never])
    expect(sameSessionsProjection(a, b)).toBe(true)
    const c = projectSessionsSidebarInput([{ id: 's', name: 'B', labels: ['x'] }])
    expect(sameSessionsProjection(a, c)).toBe(false)
  })
})
