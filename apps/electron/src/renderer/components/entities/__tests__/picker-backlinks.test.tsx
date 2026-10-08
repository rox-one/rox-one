/**
 * W1-08 (#1505) — EntityPicker rows, backlinks grouping, preview batching.
 */
import { flush, mount, renderMarkup, resetDom, testWindow, setupEntityTestEnv } from './test-env'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'
import type { EntityRef } from '@rox/core/entities'
import { buildEntityPickerItems, EntityPickerPanel } from '../EntityPicker'
import { isNoteLinkableRef } from '../NoteEntityMentions'
import { backlinkGroupOf, groupBacklinks } from '../backlink-groups'
import { BacklinksList } from '../BacklinksPanel'
import { TaskEntityBacklinks } from '../TaskEntityBacklinks'
import {
  clearRecentEntities,
  rememberRecentEntity,
  setEntityDataSource,
  type EntityDataSource,
} from '../entity-data-source'
import { entityPreviewStore, resetEntityPreviewStores } from '../use-entity-preview'
import { FIXTURE_BACKLINKS } from '../fixtures'

setupEntityTestEnv()

afterEach(() => {
  setEntityDataSource(null)
  resetEntityPreviewStores()
  clearRecentEntities()
  resetDom()
})

describe('buildEntityPickerItems', () => {
  const recents = [{ ref: { kind: 'note', id: 'n1' } as EntityRef, title: 'Release notes' }]

  it('offers a typed kind:id as a literal row first', () => {
    const items = buildEntityPickerItems({ query: 'task:42', kind: null, recents, results: [] })
    expect(items[0]).toEqual({ ref: { kind: 'task', id: '42' }, title: 'task:42', section: 'literal' })
  })

  it('does not treat free text or unknown kinds as refs (negative)', () => {
    for (const query of ['hello', 'doc 2', 'nope:1', ':', 'task:']) {
      expect(buildEntityPickerItems({ query, kind: null, recents: [], results: [] }).filter((i) => i.section === 'literal')).toEqual([])
    }
  })

  it('filters recents by query and kind, and de-duplicates results', () => {
    expect(buildEntityPickerItems({ query: 'release', kind: null, recents, results: [] }).map((i) => i.section)).toEqual(['recent'])
    expect(buildEntityPickerItems({ query: '', kind: 'task', recents, results: [] })).toEqual([])
    const dup = buildEntityPickerItems({ query: '', kind: null, recents, results: recents })
    expect(dup).toHaveLength(1)
  })

  it('panel lists results from the data source; Enter links the active row', async () => {
    const search = mock(async () => [{ ref: { kind: 'project', id: 'p1' } as EntityRef, title: 'Rox Desktop' }])
    setEntityDataSource({
      async resolve() { return [] },
      async backlinks() { return { links: [] } },
      search,
      onLinksChanged() { return () => {} },
    } satisfies EntityDataSource)
    const onSelect = mock(() => {})
    const mounted = await mount(<EntityPickerPanel workspaceId="ws" initialQuery="rox" onSelect={onSelect} />)
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)) })
    const options = Array.from(mounted.container.querySelectorAll('[role="option"]')).map((o) => o.textContent)
    const input = mounted.container.querySelector('input')!
    await act(async () => {
      // Type into the focused field, as a user would. (Bun may evaluate the
      // CommonJS react-dom before the DOM is installed, which leaves React on
      // its input-event polyfill; that path needs a focused element.)
      input.focus()
      input.dispatchEvent(new testWindow.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }) as unknown as Event)
    })
    await mounted.unmount()
    expect(search).toHaveBeenCalled()
    expect(options[0]).toContain('Rox Desktop')
    expect(onSelect).toHaveBeenCalledWith({ ref: { kind: 'project', id: 'p1' }, title: 'Rox Desktop' })
  })

  it('Enter during IME composition does not link a row (negative)', async () => {
    setEntityDataSource({
      async resolve() { return [] },
      async backlinks() { return { links: [] } },
      async search() { return [{ ref: { kind: 'project', id: 'p1' } as EntityRef, title: 'Rox Desktop' }] },
      onLinksChanged() { return () => {} },
    } satisfies EntityDataSource)
    const onSelect = mock(() => {})
    const mounted = await mount(<EntityPickerPanel workspaceId="ws" initialQuery="rox" onSelect={onSelect} />)
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)) })
    const input = mounted.container.querySelector('input')!
    await act(async () => {
      input.focus()
      input.dispatchEvent(new testWindow.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true }) as unknown as Event)
      input.dispatchEvent(new testWindow.KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true } as never) as unknown as Event)
    })
    expect(onSelect).not.toHaveBeenCalled()
    await act(async () => {
      input.dispatchEvent(new testWindow.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }) as unknown as Event)
    })
    await mounted.unmount()
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('shows «Ничего не найдено» when there is nothing to offer', async () => {
    const html = await renderMarkup(<EntityPickerPanel workspaceId="ws" onSelect={() => {}} />)
    expect(html).toContain('Ничего не найдено')
    rememberRecentEntity('ws', { ref: { kind: 'task', id: '1' }, title: 'Recent task' })
    expect(await renderMarkup(<EntityPickerPanel workspaceId="ws" onSelect={() => {}} />)).toContain('Недавние')
  })
})

describe('picker refs that cannot be written as [[…]] (#1505 fix2)', () => {
  it('no literal row for ids with |, ], [[ or line breaks', () => {
    for (const query of ['project:a|b', 'file:x]y', 'file:a[[b']) {
      expect(buildEntityPickerItems({ query, kind: null, recents: [], results: [] }).filter((i) => i.section === 'literal')).toEqual([])
    }
    expect(buildEntityPickerItems({ query: 'file:x[y', kind: null, recents: [], results: [] })[0]?.section).toBe('literal')
  })

  it('Notes hides unlinkable search hits and recents via accept', () => {
    const bad = { ref: { kind: 'file', id: 'a]b' } as EntityRef, title: 'Bad' }
    const good = { ref: { kind: 'task', id: '1' } as EntityRef, title: 'Good' }
    const items = buildEntityPickerItems({ query: '', kind: null, recents: [bad], results: [bad, good], accept: isNoteLinkableRef })
    expect(items.map((i) => i.title)).toEqual(['Good'])
    expect(isNoteLinkableRef({ kind: 'project', id: 'a|b' } as EntityRef)).toBe(false)
    expect(isNoteLinkableRef({ kind: 'task', id: '42' } as EntityRef)).toBe(true)
  })
})

describe('backlinks grouping', () => {
  it('maps kinds to UI-SPEC groups', () => {
    expect(backlinkGroupOf('task')).toBe('tasks')
    expect(backlinkGroupOf('note')).toBe('docs')
    expect(backlinkGroupOf('project')).toBe('projects')
    expect(backlinkGroupOf('goal')).toBe('goals')
    expect(backlinkGroupOf('calendar-event')).toBe('meetings')
    expect(backlinkGroupOf('session')).toBe('chats')
    expect(backlinkGroupOf('license-component')).toBe('other')
  })

  it('collapses multiple links from one source and keeps group order', () => {
    const groups = groupBacklinks(FIXTURE_BACKLINKS)
    expect(groups.map((g) => g.group)).toEqual(['tasks', 'docs', 'projects', 'goals', 'meetings', 'chats'])
    const docs = groups.find((g) => g.group === 'docs')!
    expect(docs.sources).toHaveLength(1)
    expect(docs.sources[0]!.relations).toEqual(['mentions', 'embeds'])
    expect(groupBacklinks([])).toEqual([])
  })

  it('renders groups, relation labels and a plural count (RU/EN)', async () => {
    const ru = await renderMarkup(<BacklinksList state={{ status: 'ready', links: FIXTURE_BACKLINKS }} previewsEnabled={false} />, { lang: 'ru' })
    expect(ru).toContain('Упоминается в')
    expect(ru).toContain('6 упоминаний')
    expect(ru).toContain('Упоминает, Встраивает')
    const en = await renderMarkup(<BacklinksList state={{ status: 'ready', links: FIXTURE_BACKLINKS }} previewsEnabled={false} />, { lang: 'en' })
    expect(en).toContain('Referenced in')
  })

  it('error state offers retry; empty state explains (negative paths)', async () => {
    expect(await renderMarkup(<BacklinksList state={{ status: 'error', links: [] }} />)).toContain('Не удалось загрузить. Повторить')
    expect(await renderMarkup(<BacklinksList state={{ status: 'ready', links: [] }} />)).toContain('Пока нигде не упоминается')
  })
})

describe('Tasks backlinks with no indexed links (nothing indexed yet)', () => {
  it('shows the honest empty state from the real data path, never fixture rows', async () => {
    const backlinks = mock(async () => ({ links: [] }))
    setEntityDataSource({ async resolve() { return [] }, backlinks, async search() { return [] }, onLinksChanged() { return () => {} } })
    const mounted = await mount(<TaskEntityBacklinks taskId="42" workspaceId="ws" enabled />)
    await flush()
    const html = mounted.container.innerHTML
    await mounted.unmount()
    expect(backlinks).toHaveBeenCalledTimes(1)
    expect(html).toContain('Пока нигде не упоминается')
    expect(html).not.toContain('data-entity-chip')
    for (const link of FIXTURE_BACKLINKS) expect(html).not.toContain(link.from.id)
  })
})

describe('preview store', () => {
  it('batches refs requested in one tick into a single resolve call', async () => {
    const resolve = mock(async (_ws: string, refs: EntityRef[]) =>
      refs.map((ref) => ({ ref, status: 'ok' as const, title: ref.id, kindLabel: 'Task', icon: 'circle-check', authority: 'local' as const, etag: 'e' })))
    setEntityDataSource({ resolve, async backlinks() { return { links: [] } }, async search() { return [] }, onLinksChanged() { return () => {} } })
    const store = entityPreviewStore('ws')
    store.request({ kind: 'task', id: '1' })
    store.request({ kind: 'task', id: '2' })
    store.request({ kind: 'task', id: '1' })
    await flush()
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(resolve.mock.calls[0]![1]).toHaveLength(2)
    expect(store.get({ kind: 'task', id: '2' })).toMatchObject({ status: 'ready' })
  })

  it('a failing resolver yields an unavailable (redacted) preview (negative)', async () => {
    setEntityDataSource({ async resolve() { throw new Error('boom') }, async backlinks() { return { links: [] } }, async search() { return [] }, onLinksChanged() { return () => {} } })
    const store = entityPreviewStore('ws')
    store.request({ kind: 'task', id: '9' })
    await flush()
    expect(store.get({ kind: 'task', id: '9' })).toMatchObject({ status: 'ready', preview: { status: 'unavailable', restricted: true, title: '' } })
  })

  it('without a bridge the default data source returns unavailable placeholders', async () => {
    const { electronEntityDataSource } = await import('../entity-data-source')
    const previews = await electronEntityDataSource.resolve('ws', [{ kind: 'task', id: '1' }])
    expect(previews[0]!.status).toBe('unavailable')
    expect(await electronEntityDataSource.backlinks('ws', { kind: 'task', id: '1' })).toEqual({ links: [] })
    expect(await electronEntityDataSource.search('ws', 'x')).toEqual([])
  })
})
