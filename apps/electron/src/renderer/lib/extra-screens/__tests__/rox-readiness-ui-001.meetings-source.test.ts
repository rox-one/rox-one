import { describe, expect, it } from 'bun:test'
import { pathToFileURL } from 'node:url'
import { rendererEffect, deferred, settle } from '../../../components/app-shell/__tests__/rox-readiness-ui-001.effect-harness'
import { normalizeMeetingList } from '../use-rox-sources'

const source = process.env.ROX_UI001_SOURCES_SOURCE
  ? pathToFileURL(process.env.ROX_UI001_SOURCES_SOURCE)
  : new URL('../use-rox-sources.ts', import.meta.url)
const radarSource = process.env.ROX_UI001_RADAR_SOURCE
  ? pathToFileURL(process.env.ROX_UI001_RADAR_SOURCE)
  : new URL('../../../pages/extra-screens/radar/RadarPage.tsx', import.meta.url)

describe('UI-001 actual meeting source effect completion and ownership', () => {
  function owner(workspaceId = 'a') {
    const reads: ReturnType<typeof deferred<unknown>>[] = []
    let changed!: () => void, unsubscribed = 0
    let state: any = { meetings: [], available: false, loaded: false, workspaceId }
    const setState = (update: any) => { state = typeof update === 'function' ? update(state) : update }
    const api = { meetingsLocal: {
      list: (_workspace: string) => { const read = deferred<unknown>(); reads.push(read); return read.promise },
      onChanged: (callback: () => void) => { changed = callback; return () => { unsubscribed++ } },
    } }
    const cleanup = rendererEffect(source, 'const local = api?.meetingsLocal', {
      window: { electronAPI: api }, workspaceId, scope: workspaceId, setState, normalizeMeetingList,
    })!
    return { reads, cleanup, changed: () => changed(), state: () => state, unsubscribed: () => unsubscribed }
  }
  it('pending canonical lookup is not missing and a successful reply settles the actual rows', async () => {
    const test = owner()
    expect(test.state()).toMatchObject({ loaded: false, workspaceId: 'a' })
    test.reads[0]!.resolve([{ id: 'known', title: 'Known meeting' }]); await settle()
    expect(test.state()).toMatchObject({ loaded: true, available: true, workspaceId: 'a', meetings: [{ id: 'known', title: 'Known meeting' }] })
    test.cleanup()
  })
  it('failed backend lookup settles loaded and unavailable without an indefinite pending state', async () => {
    const test = owner(); test.reads[0]!.reject(new Error('offline')); await settle()
    expect(test.state()).toEqual({ meetings: [], available: false, loaded: true, workspaceId: 'a' })
    test.cleanup()
  })
  it('latest broadcast lookup wins over an older pending canonical reply', async () => {
    const test = owner(); test.changed()
    test.reads[1]!.resolve([{ id: 'new', title: 'New' }]); await settle()
    test.reads[0]!.resolve([{ id: 'old', title: 'Old' }]); await settle()
    expect(test.state().meetings.map((row: any) => row.id)).toEqual(['new'])
    expect(test.state().loaded).toBe(true)
    test.cleanup()
  })
  it('disposed reply and queued broadcast cannot publish or start another read', async () => {
    const test = owner(); test.cleanup(); test.changed()
    expect(test.reads).toHaveLength(1)
    test.reads[0]!.resolve([{ id: 'old', title: 'Old' }]); await settle()
    expect(test.state().meetings).toEqual([])
    expect(test.state().loaded).toBe(false)
    expect(test.unsubscribed()).toBe(1)
  })
  it('unavailable backend has an explicit settled state in the same workspace', () => {
    let state: any = { workspaceId: 'old', meetings: [{ id: 'old' }], loaded: true, available: true }
    rendererEffect(source, 'const local = api?.meetingsLocal', {
      window: { electronAPI: {} }, workspaceId: 'b', scope: 'b', normalizeMeetingList,
      setState: (update: any) => { state = typeof update === 'function' ? update(state) : update },
    })
    expect(state).toEqual({ workspaceId: 'b', meetings: [], loaded: true, available: false })
  })
  it('actual note lookup completion and failure both settle the requested owner', async () => {
    for (const failure of [false, true]) {
      const read = deferred<Array<{ id: string; title: string }>>()
      const loaded: unknown[] = [], notes: unknown[] = []
      const cleanup = rendererEffect(radarSource, 'api.listNotes(workspaceId)', {
        workspaceId: 'b', context: { current: { workspaceId: 'b', generation: 0 } },
        window: { electronAPI: { listNotes: (requestedWorkspace: string) => {
          expect(requestedWorkspace).toBe('b')
          return read.promise
        } } }, setSources: () => {},
        setNotes: (value: unknown) => notes.push(value), setNotesLoadedWorkspace: (value: unknown) => loaded.push(value),
      })!
      expect(loaded).toEqual([undefined])
      if (failure) read.reject(new Error('offline'))
      else read.resolve([{ id: 'known', title: 'Known note' }])
      await settle(); await settle()
      expect(loaded.at(-1)).toBe('b')
      expect(notes.at(-1)).toEqual(failure ? [] : [{ id: 'known', title: 'Known note', updatedAt: undefined }])
      cleanup()
    }
  })
  it('actual note lookup cannot publish after disposal, workspace changes or an A-B-A return', async () => {
    for (const staleBy of ['disposal', 'workspace-change', 'a-b-a']) {
      const read = deferred<Array<{ id: string; title: string }>>()
      const context = { current: { workspaceId: 'a', generation: 0 } }
      const loaded: unknown[] = [], notes: unknown[] = []
      const cleanup = rendererEffect(radarSource, 'api.listNotes(workspaceId)', {
        workspaceId: 'a', context, window: { electronAPI: { listNotes: (requestedWorkspace: string) => {
          expect(requestedWorkspace).toBe('a')
          return read.promise
        } } }, setSources: () => {},
        setNotes: (value: unknown) => notes.push(value), setNotesLoadedWorkspace: (value: unknown) => loaded.push(value),
      })!
      if (staleBy === 'disposal') cleanup()
      else {
        context.current = { workspaceId: 'b', generation: 1 }
        if (staleBy === 'a-b-a') context.current = { workspaceId: 'a', generation: 2 }
      }
      read.resolve([{ id: 'old', title: 'Old note' }]); await settle(); await settle()
      expect(notes).toEqual([[]])
      expect(loaded).toEqual([undefined])
      cleanup()
    }
  })
  it('actual sweep read failure becomes unavailable and disposed replies cannot revive its loading owner', async () => {
    const read = deferred<string>(), states: string[] = []
    let cleared = 0
    let currentOwner!: () => boolean
    const cleanup = rendererEffect(radarSource, 'syncRadarSweep(workspaceId, sweep.id,', {
      workspaceId: 'b', context: { current: { workspaceId: 'b', generation: 0 } }, sweep: { id: 'sweep' },
      syncRadarSweep: (requestedWorkspace: string, requestedSweep: string, options: { isCurrent: () => boolean }) => {
        expect(requestedWorkspace).toBe('b'); expect(requestedSweep).toBe('sweep')
        currentOwner = options.isCurrent
        return read.promise
      },
      setSyncState: (value: string) => states.push(value),
      window: { setInterval: () => 1, clearInterval: () => { cleared++ } },
    })!
    expect(currentOwner()).toBe(true)
    read.reject(new Error('offline')); await settle()
    expect(states).toEqual(['failed'])
    cleanup(); expect(cleared).toBe(1)
    expect(currentOwner()).toBe(false)
    const oldRead = deferred<string>(), oldStates: string[] = []
    const oldContext = { current: { workspaceId: 'a', generation: 0 } }
    let oldOwner!: () => boolean
    const oldCleanup = rendererEffect(radarSource, 'syncRadarSweep(workspaceId, sweep.id,', {
      workspaceId: 'a', context: oldContext, sweep: { id: 'old-sweep' },
      syncRadarSweep: (requestedWorkspace: string, requestedSweep: string, options: { isCurrent: () => boolean }) => {
        expect(requestedWorkspace).toBe('a'); expect(requestedSweep).toBe('old-sweep')
        oldOwner = options.isCurrent
        return oldRead.promise
      },
      setSyncState: (value: string) => oldStates.push(value),
      window: { setInterval: () => 2, clearInterval: () => { cleared++ } },
    })!
    expect(oldOwner()).toBe(true)
    oldContext.current = { workspaceId: 'b', generation: 1 }
    oldContext.current = { workspaceId: 'a', generation: 2 }
    expect(oldOwner()).toBe(false)
    oldCleanup(); oldRead.resolve('done'); await settle()
    expect(oldStates).toEqual([])
    expect(cleared).toBe(2)
  })
})
