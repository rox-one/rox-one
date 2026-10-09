/**
 * B1 — MemoryRepoSearchOverlay: ⌘K open, client-side file filter, mocked
 * notes/sessions channels, Esc close, Enter opens the highlighted file, and
 * out-of-order notes responses must not clobber newer ones.
 */
import { flush, mount, resetDom, testWindow, setupEntityTestEnv } from '../../../entities/__tests__/test-env'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'
import type { MemoryRepoTreeNode } from '@rox/shared/memory/repo'
import type { NoteSummary, SessionSearchResult } from '../../../../../shared/types'
import { MemoryRepoSearchOverlay } from '../MemoryRepoSearchOverlay'

setupEntityTestEnv()

afterEach(() => { resetDom() })

const fileNode = (path: string): MemoryRepoTreeNode => ({
  path,
  name: path.split('/').pop() ?? path,
  type: 'file',
  depth: 2,
})

const note = (id: string, title: string): NoteSummary => ({
  id, title, path: `${id}.md`, relativePath: `${id}.md`, tags: [], properties: {}, links: [],
  assetRefs: [], updatedAt: 0, createdAt: 0, size: 1,
})

const session = (sessionId: string, snippet: string): SessionSearchResult => ({
  sessionId, matchCount: 1, matches: [{ sessionId, lineNumber: 1, snippet }],
})

function setApi(api: Record<string, unknown>): void {
  Object.assign(window, { electronAPI: api })
}

function byTestId(container: HTMLElement, id: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-testid="${id}"]`)
}

/** Type into a controlled React input the way a focused user would. */
async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    input.focus()
    const setter = Object.getOwnPropertyDescriptor(testWindow.HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new testWindow.Event('input', { bubbles: true }) as unknown as Event)
  })
}

async function press(target: EventTarget, init: Record<string, unknown>): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new testWindow.KeyboardEvent('keydown', { bubbles: true, ...init } as never) as unknown as Event)
  })
}

const wait = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })

describe('MemoryRepoSearchOverlay', () => {
  it('stays closed until ⌘K, filters files by path and opens the highlighted file on Enter', async () => {
    setApi({ searchNotes: mock(async () => []), searchSessionContent: mock(async () => []) })
    const opened: string[] = []
    const { container, unmount } = await mount(
      <MemoryRepoSearchOverlay
        workspaceId="ws-1"
        tree={[fileNode('MEMORY.md'), fileNode('lessons/workflow/release--abc.md'), fileNode('PROFILE.md')]}
        onOpenFile={(path) => opened.push(path)}
      />,
    )
    expect(byTestId(container, 'memory-repo-search')).toBeNull()

    await press(document, { key: 'k', metaKey: true })
    const input = byTestId(container, 'memory-repo-search-input') as HTMLInputElement | null
    expect(input).not.toBeNull()

    await typeInto(input!, 'release')
    const fileGroup = byTestId(container, 'memory-repo-search-group-files')
    expect(fileGroup?.textContent).toContain('lessons/workflow/release--abc.md')
    expect(fileGroup?.textContent).not.toContain('MEMORY.md')

    await press(input!, { key: 'Enter' })
    expect(opened).toEqual(['lessons/workflow/release--abc.md'])
    expect(byTestId(container, 'memory-repo-search')).toBeNull()
    await unmount()
  })

  it('also opens on Ctrl-K', async () => {
    setApi({ searchNotes: mock(async () => []), searchSessionContent: mock(async () => []) })
    const { container, unmount } = await mount(
      <MemoryRepoSearchOverlay workspaceId="ws-1" tree={[]} onOpenFile={() => {}} />,
    )
    await press(document, { key: 'k', ctrlKey: true })
    expect(byTestId(container, 'memory-repo-search')).not.toBeNull()
    await unmount()
  })

  it('renders mocked notes and sessions results after the debounce', async () => {
    const searchNotes = mock(async () => [note('n1', 'Release runbook')])
    const searchSessions = mock(async () => [session('s-42', 'release checklist')])
    setApi({ searchNotes, searchSessionContent: searchSessions })
    const { container, unmount } = await mount(
      <MemoryRepoSearchOverlay workspaceId="ws-1" tree={[]} onOpenFile={() => {}} onOpenNote={() => {}} onOpenSession={() => {}} />,
    )

    await press(document, { key: 'k', metaKey: true })
    const input = byTestId(container, 'memory-repo-search-input') as HTMLInputElement
    await typeInto(input, 'release')
    // Nothing yet: the 200ms debounce has not fired.
    expect(searchNotes).not.toHaveBeenCalled()

    await wait(250)
    expect(searchNotes).toHaveBeenCalledWith('ws-1', 'release')
    expect(searchSessions).toHaveBeenCalledWith('ws-1', 'release')
    expect(byTestId(container, 'memory-repo-search-group-notes')?.textContent).toContain('Release runbook')
    expect(byTestId(container, 'memory-repo-search-group-sessions')?.textContent).toContain('s-42')
    await unmount()
  })

  it('shows the empty state for a query with no matches', async () => {
    setApi({ searchNotes: mock(async () => []), searchSessionContent: mock(async () => []) })
    const { container, unmount } = await mount(
      <MemoryRepoSearchOverlay workspaceId="ws-1" tree={[fileNode('MEMORY.md')]} onOpenFile={() => {}} />,
    )
    await press(document, { key: 'k', metaKey: true })
    await typeInto(byTestId(container, 'memory-repo-search-input') as HTMLInputElement, 'zzz')
    await wait(250)
    expect(byTestId(container, 'memory-repo-search-empty')).not.toBeNull()
    await unmount()
  })

  it('renders the error text instead of “nothing found” when a channel search rejects', async () => {
    setApi({
      searchNotes: mock(async () => { throw new Error('notes down') }),
      searchSessionContent: mock(async () => { throw new Error('sessions down') }),
    })
    const { container, unmount } = await mount(
      <MemoryRepoSearchOverlay workspaceId="ws-1" tree={[]} onOpenFile={() => {}} />,
    )
    await press(document, { key: 'k', metaKey: true })
    await typeInto(byTestId(container, 'memory-repo-search-input') as HTMLInputElement, 'zzz')
    await wait(250)

    // In a multi-file `bun test` process a sibling file may install a
    // process-wide `useTranslation` stub that echoes the key; standalone it
    // resolves through the real RU i18n. Accept either rendering.
    const errorText = /Не удалось выполнить поиск|memory\.repo\.search\.error/
    expect(byTestId(container, 'memory-repo-search-error-notes')?.textContent).toMatch(errorText)
    expect(byTestId(container, 'memory-repo-search-error-sessions')?.textContent).toMatch(errorText)
    expect(byTestId(container, 'memory-repo-search-empty')).toBeNull()
    await unmount()
  })

  it('closes on Esc', async () => {
    setApi({ searchNotes: mock(async () => []), searchSessionContent: mock(async () => []) })
    const { container, unmount } = await mount(
      <MemoryRepoSearchOverlay workspaceId="ws-1" tree={[]} onOpenFile={() => {}} />,
    )
    await press(document, { key: 'k', metaKey: true })
    const input = byTestId(container, 'memory-repo-search-input') as HTMLInputElement
    await press(input, { key: 'Escape' })
    expect(byTestId(container, 'memory-repo-search')).toBeNull()
    await unmount()
  })

  it('ignores an out-of-order notes response that resolves after a newer one', async () => {
    const first = Promise.withResolvers<NoteSummary[]>()
    let call = 0
    const searchNotes = mock(() => {
      call += 1
      return call === 1 ? first.promise : Promise.resolve([note('new', 'Newer note')])
    })
    setApi({ searchNotes, searchSessionContent: mock(async () => []) })
    const { container, unmount } = await mount(
      <MemoryRepoSearchOverlay workspaceId="ws-1" tree={[]} onOpenFile={() => {}} onOpenNote={() => {}} />,
    )

    await press(document, { key: 'k', metaKey: true })
    const input = byTestId(container, 'memory-repo-search-input') as HTMLInputElement
    await typeInto(input, 'a')
    await wait(250) // first request is in flight
    await typeInto(input, 'ab')
    await wait(250) // second request resolves with the newer note
    expect(byTestId(container, 'memory-repo-search-group-notes')?.textContent).toContain('Newer note')

    await act(async () => { first.resolve([note('old', 'Stale note')]); await Promise.resolve() })
    await flush()
    expect(byTestId(container, 'memory-repo-search-group-notes')?.textContent).toContain('Newer note')
    expect(byTestId(container, 'memory-repo-search-group-notes')?.textContent).not.toContain('Stale note')
    await unmount()
  })
})