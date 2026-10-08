/**
 * W1-08 (#1505 fix1) — preview cache: invalidate refetches mounted chips,
 * `entities:linksChanged` invalidates, transient failures are retried.
 */
import { flush, mount, resetDom, setupEntityTestEnv, wait } from './test-env'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import type { EntityPreview, EntityRef } from '@rox/core/entities'
import { setEntityDataSource, type EntityDataSource } from '../entity-data-source'
import {
  entityPreviewStore,
  invalidateEntityPreviews,
  resetEntityPreviewStores,
  useEntityPreview,
} from '../use-entity-preview'

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

function source(resolve: EntityDataSource['resolve'], onLinksChanged: EntityDataSource['onLinksChanged'] = () => () => {}): EntityDataSource {
  return { resolve, async backlinks() { return { links: [] } }, async search() { return [] }, onLinksChanged }
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
})
