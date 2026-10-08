/**
 * W1-08 (#1505 fix1) — preview cache: invalidate refetches mounted chips,
 * `entities:linksChanged` invalidates, transient failures are retried.
 */
import { flush, mount, resetDom, setupEntityTestEnv, testWindow, wait } from './test-env'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'
import type { EntityPreview, EntityRef } from '@rox/core/entities'
import { EntityChip } from '../EntityChip'
import { EntityWorkspaceContext } from '../entity-context'
import { setEntityDataSource, type EntityDataSource } from '../entity-data-source'
import {
  ENTITY_PREVIEW_RETRY_MAX_MS,
  ENTITY_PREVIEW_RETRY_MS,
  ENTITY_PREVIEW_TTL_MS,
  entityPreviewRetryDelay,
  entityPreviewStore,
  invalidateEntityPreviews,
  resetEntityPreviewStores,
  revalidateEntityPreview,
  useEntityPreview,
} from '../use-entity-preview'
import { noteChangeToEntityEvent } from '../entity-data-source'

setupEntityTestEnv()

afterEach(() => {
  setEntityDataSource(null)
  resetEntityPreviewStores()
  resetDom()
})

const TASK: EntityRef = { kind: 'task', id: '1' }

function preview(ref: EntityRef, title: string): EntityPreview {
  return { ref, status: 'ok', title, kindLabel: 'Task', icon: 'circle-check', authority: 'local', etag: title }
}

function source(
  resolve: EntityDataSource['resolve'],
  onLinksChanged: EntityDataSource['onLinksChanged'] = () => () => {},
  onEntitiesChanged?: EntityDataSource['onEntitiesChanged'],
): EntityDataSource {
  return { resolve, async backlinks() { return { links: [] } }, async search() { return [] }, onLinksChanged, ...(onEntitiesChanged ? { onEntitiesChanged } : {}) }
}

function tombstone(ref: EntityRef): EntityPreview {
  return { ref, status: 'tombstone', title: 'Secret old title', kindLabel: 'Task', icon: 'circle-check', authority: 'local', etag: 'gone' }
}

function Title({ entityRef }: { entityRef: EntityRef }) {
  const state = useEntityPreview(entityRef, 'ws', true)
  return <span data-testid="title">{state.status === 'ready' ? state.preview.title || '∅' : state.status}</span>
}

describe('preview cache', () => {
  it('invalidate() refetches mounted chips and keeps the old title meanwhile', async () => {
    let version = 1
    const resolve = mock(async (_ws: string, refs: EntityRef[]) => refs.map((ref) => preview(ref, `v${version}`)))
    setEntityDataSource(source(resolve))
    const mounted = await mount(<Title entityRef={TASK} />)
    await flush()
    expect(mounted.container.textContent).toBe('v1')
    version = 2
    invalidateEntityPreviews('ws')
    expect(mounted.container.textContent).toBe('v1')
    await flush()
    expect(mounted.container.textContent).toBe('v2')
    expect(resolve).toHaveBeenCalledTimes(2)
    await mounted.unmount()
  })

  it('unmounted keys are dropped on invalidate, not refetched (negative)', async () => {
    const resolve = mock(async (_ws: string, refs: EntityRef[]) => refs.map((ref) => preview(ref, 'x')))
    setEntityDataSource(source(resolve))
    const mounted = await mount(<Title entityRef={TASK} />)
    await flush()
    await mounted.unmount()
    invalidateEntityPreviews('ws')
    await flush()
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(entityPreviewStore('ws').get(TASK)).toEqual({ status: 'idle' })
  })

  it('entities:linksChanged for the workspace invalidates; other workspaces do not', async () => {
    let emit: (workspaceId: string) => void = () => {}
    const unsubscribe = mock(() => {})
    let version = 1
    const resolve = mock(async (_ws: string, refs: EntityRef[]) => refs.map((ref) => preview(ref, `v${version}`)))
    setEntityDataSource(source(resolve, (callback) => { emit = callback; return unsubscribe }))
    const mounted = await mount(<Title entityRef={TASK} />)
    await flush()
    version = 2
    emit('other-ws')
    await flush()
    expect(mounted.container.textContent).toBe('v1')
    emit('ws')
    await flush()
    expect(mounted.container.textContent).toBe('v2')
    await mounted.unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('a transient resolve failure shows the placeholder, then retries', async () => {
    resetEntityPreviewStores({ retryMs: 20 })
    let fail = true
    const resolve = mock(async (_ws: string, refs: EntityRef[]) => {
      if (fail) throw new Error('bridge down')
      return refs.map((ref) => preview(ref, 'Recovered'))
    })
    setEntityDataSource(source(resolve))
    const mounted = await mount(<Title entityRef={TASK} />)
    await flush()
    expect(mounted.container.textContent).toBe('∅')
    fail = false
    await wait(60)
    await flush()
    expect(mounted.container.textContent).toBe('Recovered')
    expect(resolve).toHaveBeenCalledTimes(2)
    await mounted.unmount()
  })

  it('a failed refetch keeps the last good preview', async () => {
    resetEntityPreviewStores({ retryMs: 10_000 })
    let fail = false
    const resolve = mock(async (_ws: string, refs: EntityRef[]) => {
      if (fail) throw new Error('bridge down')
      return refs.map((ref) => preview(ref, 'Good'))
    })
    setEntityDataSource(source(resolve))
    const mounted = await mount(<Title entityRef={TASK} />)
    await flush()
    fail = true
    invalidateEntityPreviews()
    await flush()
    expect(mounted.container.textContent).toBe('Good')
    await mounted.unmount()
  })

  it('stale-while-revalidate: a preview older than the TTL refetches on retain(), keeping the old value', async () => {
    let clock = 1_000
    resetEntityPreviewStores({ ttlMs: 60_000, now: () => clock })
    let version = 1
    let release: (() => void) | null = null
    const resolve = mock(async (_ws: string, refs: EntityRef[]) => {
      if (version === 2) await new Promise<void>((done) => { release = done })
      return refs.map((ref) => preview(ref, `v${version}`))
    })
    setEntityDataSource(source(resolve))
    const first = await mount(<Title entityRef={TASK} />)
    await flush()
    expect(first.container.textContent).toBe('v1')
    // Within the TTL another chip for the same ref does not refetch.
    clock += 59_000
    const fresh = await mount(<Title entityRef={TASK} />)
    await flush()
    expect(resolve).toHaveBeenCalledTimes(1)
    await fresh.unmount()
    // Past the TTL: background refetch, old title stays until the new one arrives.
    clock += 2_000
    version = 2
    const second = await mount(<Title entityRef={TASK} />)
    await flush()
    expect(resolve).toHaveBeenCalledTimes(2)
    expect(first.container.textContent).toBe('v1')
    expect(second.container.textContent).toBe('v1')
    // A second retain while the refetch is in flight does not double it.
    const third = await mount(<Title entityRef={TASK} />)
    await flush()
    expect(resolve).toHaveBeenCalledTimes(2)
    release!()
    await flush()
    expect(first.container.textContent).toBe('v2')
    expect(second.container.textContent).toBe('v2')
    await third.unmount()
    await second.unmount()
    await first.unmount()
  })

  it('hover-open revalidation shows a tombstone once the entity was deleted (no title leak)', async () => {
    let clock = 0
    resetEntityPreviewStores({ now: () => clock })
    let deleted = false
    const resolve = mock(async (_ws: string, refs: EntityRef[]) => refs.map((ref) => (deleted ? tombstone(ref) : preview(ref, 'Live task'))))
    setEntityDataSource(source(resolve))
    const mounted = await mount(<Title entityRef={TASK} />)
    await flush()
    expect(mounted.container.textContent).toBe('Live task')
    deleted = true
    revalidateEntityPreview('ws', TASK) // fresh: no request
    await flush()
    expect(resolve).toHaveBeenCalledTimes(1)
    clock += ENTITY_PREVIEW_TTL_MS
    revalidateEntityPreview('ws', TASK)
    await flush()
    expect(resolve).toHaveBeenCalledTimes(2)
    const state = entityPreviewStore('ws').get(TASK)
    expect(state.status).toBe('ready')
    if (state.status === 'ready') {
      expect(state.preview.status).toBe('tombstone')
      expect(JSON.stringify(state.preview)).not.toContain('Secret old title')
    }
    await mounted.unmount()
  })

  it('entity change events refetch matching mounted previews only', async () => {
    let emit: (event: { kind: 'task' | 'note'; workspaceId?: string; ids?: string[] }) => void = () => {}
    const off = mock(() => {})
    let version = 1
    const resolve = mock(async (_ws: string, refs: EntityRef[]) => refs.map((ref) => preview(ref, `v${version}`)))
    setEntityDataSource(source(resolve, () => () => {}, (callback) => { emit = callback; return off }))
    const mounted = await mount(<Title entityRef={TASK} />)
    await flush()
    version = 2
    emit({ kind: 'note' })
    emit({ kind: 'task', workspaceId: 'other-ws' })
    emit({ kind: 'task', ids: ['999'] })
    await flush()
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(mounted.container.textContent).toBe('v1')
    emit({ kind: 'task', workspaceId: 'ws', ids: ['1'] })
    await flush()
    expect(resolve).toHaveBeenCalledTimes(2)
    expect(mounted.container.textContent).toBe('v2')
    await mounted.unmount()
    expect(off).toHaveBeenCalledTimes(1)
  })

  it('maps notes:changed payloads to note change events', () => {
    expect(noteChangeToEntityEvent({ workspaceId: 'ws', noteId: 'n1' })).toEqual({ kind: 'note', workspaceId: 'ws', ids: ['n1'] })
    expect(noteChangeToEntityEvent('ws')).toEqual({ kind: 'note', workspaceId: 'ws' })
    expect(noteChangeToEntityEvent({})).toEqual({ kind: 'note' })
  })

  it('retry delay doubles from 15 s and caps at 5 min', () => {
    expect(ENTITY_PREVIEW_RETRY_MS).toBe(15_000)
    expect(ENTITY_PREVIEW_RETRY_MAX_MS).toBe(300_000)
    expect([1, 2, 3, 4, 5, 6, 7, 50].map((n) => entityPreviewRetryDelay(n))).toEqual([15_000, 30_000, 60_000, 120_000, 240_000, 300_000, 300_000, 300_000])
  })

  it('persistent failures back off exponentially; linksChanged resets the backoff', async () => {
    resetEntityPreviewStores({ retryMs: 30, retryMaxMs: 10_000 })
    let emit: (workspaceId: string) => void = () => {}
    const resolve = mock(async () => { throw new Error('FORBIDDEN') })
    setEntityDataSource(source(resolve as unknown as EntityDataSource['resolve'], (callback) => { emit = callback; return () => {} }))
    const mounted = await mount(<Title entityRef={TASK} />)
    await flush()
    // Attempts at ~0, 30, 90 (next at 210). A fixed 30 ms retry would make 5+.
    await wait(160)
    await flush()
    expect(resolve).toHaveBeenCalledTimes(3)
    // linksChanged: immediate refetch, and the backoff restarts at retryMs.
    emit('ws')
    await flush()
    expect(resolve).toHaveBeenCalledTimes(4)
    await wait(55)
    await flush()
    expect(resolve).toHaveBeenCalledTimes(5)
    await mounted.unmount()
  })

  it('success resets the backoff', async () => {
    resetEntityPreviewStores({ retryMs: 20, retryMaxMs: 10_000, ttlMs: 0 })
    let fail = true
    const resolve = mock(async (_ws: string, refs: EntityRef[]) => {
      if (fail) throw new Error('down')
      return refs.map((ref) => preview(ref, 'ok'))
    })
    setEntityDataSource(source(resolve))
    const mounted = await mount(<Title entityRef={TASK} />)
    await flush()
    await wait(35) // attempt 2 at ~20 ms
    await flush()
    expect(resolve).toHaveBeenCalledTimes(2)
    fail = false
    await wait(60) // attempt 3 at ~60 ms succeeds
    await flush()
    expect(mounted.container.textContent).toBe('ok')
    const calls = resolve.mock.calls.length
    // Fail again: first retry is back to 20 ms, not 80 ms.
    fail = true
    revalidateEntityPreview('ws', TASK) // ttl 0: refetch now, fails
    await flush()
    expect(mounted.container.textContent).toBe('ok')
    await wait(40)
    await flush()
    expect(resolve.mock.calls.length).toBe(calls + 2)
    await mounted.unmount()
  })

  it('opening the hover card revalidates a stale chip preview', async () => {
    let clock = 0
    resetEntityPreviewStores({ now: () => clock })
    let title = 'Old'
    const resolve = mock(async (_ws: string, refs: EntityRef[]) => refs.map((ref) => preview(ref, title)))
    setEntityDataSource(source(resolve))
    const mounted = await mount(
      <EntityWorkspaceContext.Provider value="ws"><EntityChip entityRef={TASK} previewsEnabled /></EntityWorkspaceContext.Provider>,
    )
    await flush()
    expect(mounted.container.textContent).toContain('Old')
    clock += ENTITY_PREVIEW_TTL_MS + 1
    title = 'Renamed'
    const button = mounted.container.querySelector('button[data-entity-chip]')!
    await act(async () => { button.dispatchEvent(new testWindow.PointerEvent('pointerover', { bubbles: true }) as unknown as Event) })
    await wait(350)
    await flush()
    expect(resolve).toHaveBeenCalledTimes(2)
    expect(mounted.container.textContent).toContain('Renamed')
    await mounted.unmount()
  })
})
