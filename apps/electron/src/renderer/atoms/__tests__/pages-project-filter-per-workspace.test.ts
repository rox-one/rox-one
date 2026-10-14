import { describe, expect, it } from 'bun:test'
import { createStore } from 'jotai'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pagesFilterForWorkspace, pagesProjectFilterAtom } from '../pages'

describe('Pages project filter is per workspace', () => {
  it('a project picked in workspace A never filters workspace B', () => {
    const store = createStore()
    store.set(pagesProjectFilterAtom, { workspaceId: 'ws-a', ids: ['project-a'] })
    const filters = store.get(pagesProjectFilterAtom)
    expect(pagesFilterForWorkspace(filters, 'ws-a')).toEqual(['project-a'])
    expect(pagesFilterForWorkspace(filters, 'ws-b')).toEqual([])
    expect(pagesFilterForWorkspace(filters, null)).toEqual([])
  })

  it('switching back restores each workspace’s own filter; clearing one leaves the other', () => {
    const store = createStore()
    store.set(pagesProjectFilterAtom, { workspaceId: 'ws-a', ids: ['project-a'] })
    store.set(pagesProjectFilterAtom, { workspaceId: 'ws-b', ids: ['project-b'] })
    store.set(pagesProjectFilterAtom, { workspaceId: 'ws-a', ids: [] })
    const filters = store.get(pagesProjectFilterAtom)
    expect(pagesFilterForWorkspace(filters, 'ws-a')).toEqual([])
    expect(pagesFilterForWorkspace(filters, 'ws-b')).toEqual(['project-b'])
  })

  it('PagesHome reads and writes the filter keyed by the active workspace', () => {
    const src = readFileSync(join(__dirname, '../../components/pages/PagesHome.tsx'), 'utf8')
    expect(src).toContain('pagesFilterForWorkspace(projectFilters, activeWorkspaceId)')
    expect(src).toContain('setProjectFilters({ workspaceId: activeWorkspaceId, ids })')
  })
})
