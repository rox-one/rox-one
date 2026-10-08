/**
 * W1-08 (#1505) review 8:
 * - INFO 2: the preview cache follows the EFFECTIVE links state. While links
 *   is off the server answers `entities:resolve` with `unavailable`
 *   placeholders; when `enabled` flips the stores are invalidated, answers
 *   in flight across the flip are discarded, and once main acknowledges a
 *   toggle push the stores are invalidated again (ipcMain vs RPC ordering).
 * - INFO 3: unretained ready previews are bounded by an LRU.
 */
import { flush, mount, resetDom, setupEntityTestEnv } from './test-env'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import type { EntityPreview, EntityRef } from '@rox/core/entities'
import type { EntitiesLinksEffectiveState } from '@rox/shared/feature-flags'
import { setEntityDataSource, unavailableEntityPreview, type EntityDataSource } from '../entity-data-source'
import {
  ENTITY_PREVIEW_MAX_UNRETAINED,
  entityPreviewStore,
  resetEntityPreviewStores,
  useEntityPreview,
} from '../use-entity-preview'
import {
  __resetEntitiesLinksSyncForTests,
  applyEntitiesLinksEffectiveState,
  pushEntitiesLinksFlag,
} from '../../../lib/entities-links-sync'

setupEntityTestEnv()

const win = globalThis.window as unknown as { electronAPI?: unknown }
const previousBridge = win.electronAPI

afterEach(() => {
  setEntityDataSource(null)
  resetEntityPreviewStores()
  __resetEntitiesLinksSyncForTests()
  win.electronAPI = previousBridge
  resetDom()
})

const TASK: EntityRef = { kind: 'task', id: '1' }
const state = (enabled: boolean, persisted = enabled): EntitiesLinksEffectiveState => ({ enabled, persisted, envOverride: undefined })

function preview(ref: EntityRef, title: string): EntityPreview {
  return { ref, status: 'ok', title, kindLabel: 'Task', icon: 'circle-check', authority: 'local', etag: title }
}

function source(resolve: EntityDataSource['resolve']): EntityDataSource {
  return { resolve, async backlinks() { return { links: [] } }, async search() { return [] }, onLinksChanged: () => () => {} }
}

/** Server side: `unavailable` placeholders while links is off (handlers/rpc/entities.ts). */
function server() {
  const s = { linksOn: false, title: 'Live' }
  const resolve = mock(async (_ws: string, refs: EntityRef[]) => refs.map((ref) => (s.linksOn ? preview(ref, s.title) : unavailableEntityPreview(ref))))
  return { s, resolve }
}

function Status({ entityRef }: { entityRef: EntityRef }) {
  const st = useEntityPreview(entityRef, 'ws', true)
  return <span>{st.status === 'ready' ? `${st.preview.status}:${st.preview.title}` : st.status}</span>
}

describe('preview cache follows the effective links state (review 8 #2)', () => {
  it('links off → on: a mounted chip drops its cached `unavailable` placeholder', async () => {
    const { s, resolve } = server()
    setEntityDataSource(source(resolve))
    const mounted = await mount(<Status entityRef={TASK} />)
    await flush()
    expect(mounted.container.textContent).toBe('unavailable:')
    s.linksOn = true
    applyEntitiesLinksEffectiveState(state(true))
    await flush()
    expect(resolve).toHaveBeenCalledTimes(2)
    expect(mounted.container.textContent).toBe('ok:Live')
    // A change that keeps `enabled` (persisted toggle under an env override) does not refetch.
    applyEntitiesLinksEffectiveState({ enabled: true, persisted: false, envOverride: true })
    await flush()
    expect(resolve).toHaveBeenCalledTimes(2)
    await mounted.unmount()
  })

  it('links on → off invalidates too, and unmounted previews are dropped', async () => {
    applyEntitiesLinksEffectiveState(state(true))
    const { s, resolve } = server()
    s.linksOn = true
    setEntityDataSource(source(resolve))
    const mounted = await mount(<Status entityRef={TASK} />)
    await flush()
    expect(mounted.container.textContent).toBe('ok:Live')
    await mounted.unmount()
    applyEntitiesLinksEffectiveState(state(false))
    await flush()
    expect(entityPreviewStore('ws').get(TASK)).toEqual({ status: 'idle' })
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  it('an answer in flight across the flip is discarded, never cached', async () => {
    const gates: Array<(previews: EntityPreview[]) => void> = []
    const resolve = mock((_ws: string, _refs: EntityRef[]) => new Promise<EntityPreview[]>((done) => { gates.push(done) }))
    setEntityDataSource(source(resolve))
    const mounted = await mount(<Status entityRef={TASK} />)
    await flush()
    expect(resolve).toHaveBeenCalledTimes(1)
    applyEntitiesLinksEffectiveState(state(true))
    await flush()
    expect(resolve).toHaveBeenCalledTimes(2)
    // The fresh answer lands first, then the stale `unavailable` one.
    gates[1]!([preview(TASK, 'Fresh')])
    await flush()
    expect(mounted.container.textContent).toBe('ok:Fresh')
    gates[0]!([unavailableEntityPreview(TASK)])
    await flush()
    expect(mounted.container.textContent).toBe('ok:Fresh')
    await mounted.unmount()
  })

  it('toggle push: previews refetch again once main acknowledges (ipcMain vs RPC race)', async () => {
    const { s, resolve } = server()
    let ack: (value: EntitiesLinksEffectiveState) => void = () => {}
    win.electronAPI = {
      setEntitiesLinksEnabled: () => new Promise<EntitiesLinksEffectiveState>((done) => { ack = done }),
    }
    setEntityDataSource(source(resolve))
    const mounted = await mount(<Status entityRef={TASK} />)
    await flush()
    expect(mounted.container.textContent).toBe('unavailable:')
    // Optimistic flip: the refetch reaches the server before main applied the toggle.
    const pushed = pushEntitiesLinksFlag(true)
    await flush()
    expect(resolve).toHaveBeenCalledTimes(2)
    expect(mounted.container.textContent).toBe('unavailable:')
    s.linksOn = true
    ack(state(true))
    await pushed
    await flush()
    expect(resolve).toHaveBeenCalledTimes(3)
    expect(mounted.container.textContent).toBe('ok:Live')
    await mounted.unmount()
  })

  it('subscribes once, however many workspace stores exist', async () => {
    const { s, resolve } = server()
    setEntityDataSource(source(resolve))
    const releases = ['a', 'b', 'c'].map((ws) => entityPreviewStore(ws).retain(TASK))
    await flush()
    expect(resolve).toHaveBeenCalledTimes(3)
    s.linksOn = true
    applyEntitiesLinksEffectiveState(state(true))
    await flush()
    // One invalidation per store, not one per store per subscription.
    expect(resolve).toHaveBeenCalledTimes(6)
    for (const ws of ['a', 'b', 'c']) expect(entityPreviewStore(ws).get(TASK)).toMatchObject({ status: 'ready', preview: { status: 'ok' } })
    for (const release of releases) release()
  })
})

describe('unretained previews are bounded (review 8 #3)', () => {
  const ref = (id: number): EntityRef => ({ kind: 'task', id: String(id) })

  it('defaults to 500 unretained entries per workspace', () => {
    expect(ENTITY_PREVIEW_MAX_UNRETAINED).toBe(500)
  })

  it('keeps at most N unretained ready previews, evicting the oldest released', async () => {
    resetEntityPreviewStores({ maxUnretained: 3 })
    const resolve = mock(async (_ws: string, refs: EntityRef[]) => refs.map((r) => preview(r, `t${r.id}`)))
    setEntityDataSource(source(resolve))
    const store = entityPreviewStore('ws')
    for (let id = 1; id <= 5; id++) {
      const release = store.retain(ref(id))
      await flush()
      release()
    }
    expect(store.stats()).toEqual({ cached: 3, unretained: 3, retained: 0 })
    expect(store.get(ref(1))).toEqual({ status: 'idle' })
    expect(store.get(ref(2))).toEqual({ status: 'idle' })
    for (const id of [3, 4, 5]) expect(store.get(ref(id))).toMatchObject({ status: 'ready', preview: { title: `t${id}` } })
    // Re-retaining a cached key reuses it (no request) and takes it out of the LRU.
    const calls = resolve.mock.calls.length
    const again = store.retain(ref(3))
    await flush()
    expect(resolve.mock.calls.length).toBe(calls)
    expect(store.stats()).toEqual({ cached: 3, unretained: 2, retained: 1 })
    // Releasing it makes it the most recent: the next eviction takes 4, not 3.
    again()
    const six = store.retain(ref(6))
    await flush()
    six()
    expect(store.get(ref(4))).toEqual({ status: 'idle' })
    expect(store.get(ref(3)).status).toBe('ready')
    expect(store.stats()).toEqual({ cached: 3, unretained: 3, retained: 0 })
  })

  it('never evicts retained previews, whatever the cap', async () => {
    resetEntityPreviewStores({ maxUnretained: 0 })
    const resolve = mock(async (_ws: string, refs: EntityRef[]) => refs.map((r) => preview(r, `t${r.id}`)))
    setEntityDataSource(source(resolve))
    const store = entityPreviewStore('ws')
    const releases = [1, 2, 3, 4].map((id) => store.retain(ref(id)))
    await flush()
    expect(store.stats()).toEqual({ cached: 4, unretained: 0, retained: 4 })
    for (const id of [1, 2, 3, 4]) expect(store.get(ref(id)).status).toBe('ready')
    releases[0]!()
    expect(store.stats()).toEqual({ cached: 3, unretained: 0, retained: 3 })
    for (const release of releases) release()
    expect(store.stats().cached).toBe(0)
  })

  it('a key released while its resolve is in flight is trimmed once it lands', async () => {
    resetEntityPreviewStores({ maxUnretained: 1 })
    const gates: Array<() => void> = []
    const resolve = mock(async (_ws: string, refs: EntityRef[]) => {
      await new Promise<void>((done) => { gates.push(done) })
      return refs.map((r) => preview(r, `t${r.id}`))
    })
    setEntityDataSource(source(resolve))
    const store = entityPreviewStore('ws')
    const releases = [1, 2, 3].map((id) => store.retain(ref(id)))
    await flush()
    for (const release of releases) release()
    expect(store.stats().cached).toBe(3) // all loading: left to their flush
    for (const gate of gates) gate()
    await flush()
    expect(store.stats()).toEqual({ cached: 1, unretained: 1, retained: 0 })
    expect(store.get(ref(3)).status).toBe('ready')
  })
})
