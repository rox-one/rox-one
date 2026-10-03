import { describe, expect, it } from 'bun:test'
import * as React from 'react'
import { parseNoteBlockAddress } from '@rox/core/mindmap/derive-note.ts'
import { deferred, elementIn, leafCallback, leafComponent, rendererEffect, settle } from './rox-readiness-ui-001.leaf-harness'

const source = new URL('../../../pages/NotesPage.tsx', import.meta.url)
const document = { id: 'note-A', nativeId: 'note-A', title: 'A', content: 'source bytes', tags: [], revision: 'r1' }

function noteHost(readNote: (workspaceId: string, noteId: string) => Promise<unknown>, claimable = true) {
  const state: { activeNote: unknown; content: string; loading: boolean; failure: any; resolution: any } = { activeNote: null, content: '', loading: false, failure: null, resolution: null }
  const openNoteRequestRef = { current: 0 }
  const activeNoteIdRef = { current: null as string | null }
  const contentRef = { current: '' }
  const dirtyRef = { current: false }
  const refs = {
    openNoteRequestRef, activeNoteIdRef, contentRef, dirtyRef,
    readWorkspaceGenerationRef: { current: 0 }, workspaceIdRef: { current: 'workspace-A' }, readWorkspaceRef: { current: 'workspace-A' }, readsMountedRef: { current: true },
    saveBlockedRef: { current: false },
    revisionsRef: { current: new Map() }, expectedRevisionByNoteRef: { current: new Map() }, nativeRevisionByNoteRef: { current: new Map() },
  }
  const bindings = {
    ...refs, activeWorkspaceId: 'workspace-A',
    window: { electronAPI: { readNote, isChannelAvailable: () => false } },
    soupDocumentReadResult: () => ({ result: {} }), isClaimableLive: () => claimable,
    capabilityErrorCode: (error: any) => error?.code ?? 'CAPABILITY_UNAVAILABLE',
    noteRevisionKey: (workspaceId: string, noteId: string) => workspaceId + ':' + noteId, contentHash: (content: string) => content,
    RPC_CHANNELS: { content: { RESOLVE: 'content:resolve' } },
    t: (key: string) => key, toast: { error: () => {} },
    setNoteOpenError: (value: unknown) => { state.failure = value },
    setActiveNote: (value: unknown) => { state.activeNote = value },
    setContent: (value: string) => { state.content = value },
    setLoading: (value: boolean) => { state.loading = value },
    setContentResolution: (value: unknown) => { state.resolution = value }, setDirty: () => {}, setSaving: () => {}, setSaveError: () => {}, setSaveNeedsReload: () => {}, setExternalChange: () => {}, setTagDraft: () => {},
  }
  return { state, refs, bindings, open: leafCallback(source, 'openNote', bindings) }
}

function subscribeChanges(host: ReturnType<typeof noteHost>) {
  let listener!: (payload: any) => void
  let externalChange: unknown = null
  let stopped = false
  const cleanup = rendererEffect(source, 'onNotesChanged', {
    ...host.bindings, openNote: host.open, selectedNoteId: 'note-A#^block-A', selectedNoteIdRef: { current: 'note-A#^block-A' },
    activeNoteRef: { current: host.state.activeNote }, normalizeChangedPayload: (payload: unknown) => payload, parseNoteBlockAddress,
    refreshNotes: () => {}, refreshAssets: () => {}, refreshIndexHealth: async () => {},
    nativeNotesSync: { start: async () => {}, flush: async () => {}, stop: async () => {} },
    setExternalChange: (payload: unknown) => { externalChange = payload },
    window: { electronAPI: {
      ...host.bindings.window.electronAPI, watchNotes: async () => {}, unwatchNotes: async () => {},
      onNotesChanged: (callback: typeof listener) => { listener = callback; return () => { stopped = true } },
    } },
  })
  return { listener: (payload: unknown) => listener(payload), cleanup, externalChange: () => externalChange, stopped: () => stopped }
}

describe('UI-001 selected note recovery retains its canonical address', () => {
  it('canonical missing is persistent; unavailable is distinct; the same selected note can retry', async () => {
    let code: string | null = 'NOT_FOUND'
    const addresses: unknown[] = []
    const host = noteHost(async (workspaceId, noteId) => {
      addresses.push([workspaceId, noteId])
      if (code) throw Object.assign(new Error(code), { code })
      return { ...document }
    })
    await host.open('note-A')
    expect(host.state.failure).toEqual({ workspaceId: 'workspace-A', noteId: 'note-A', code: 'NOT_FOUND' })
    expect(host.state.activeNote).toBeNull()
    code = 'AUTH_FAILED'
    await host.open('note-A')
    expect(host.state.failure.code).toBe('AUTH_FAILED')
    code = null
    await host.open('note-A')
    expect(host.state.failure).toBeNull()
    expect(host.state.activeNote).toEqual(document)
    expect(addresses).toEqual([['workspace-A', 'note-A'], ['workspace-A', 'note-A'], ['workspace-A', 'note-A']])
  })

  it('a nonclaimable selected note stays unavailable without reading native data', async () => {
    let calls = 0
    const host = noteHost(async () => { calls += 1; return document }, false)
    await host.open('note-A')
    expect(calls).toBe(0)
    expect(host.state.failure?.code).toBe('CAPABILITY_UNAVAILABLE')
    expect(host.state.loading).toBe(false)
  })

  it('a newer deletion read wins over an older pending document response', async () => {
    const old = deferred<unknown>()
    let reads = 0
    const host = noteHost(async () => {
      if (++reads === 1) return old.promise
      throw Object.assign(new Error('deleted'), { code: 'NOT_FOUND' })
    })
    const initial = host.open('note-A')
    await host.open('note-A')
    old.resolve(document)
    await initial
    expect(host.state.activeNote).toBeNull()
    expect(host.state.failure?.code).toBe('NOT_FOUND')
  })

  it('production workspace lease cleanup fences a pending selected-note read', async () => {
    const read = deferred<unknown>()
    const host = noteHost(async () => read.promise)
    const cleanup = rendererEffect(source, 'readWorkspaceRef.current = activeWorkspaceId', {
      ...host.bindings, notesListRequestRef: { current: 0 }, assetsRequestRef: { current: 0 },
    })
    const initial = host.open('note-A')
    const before = { ...host.state }
    cleanup?.()
    read.resolve(document)
    await initial
    expect(host.state).toEqual(before)
  })

  it('a selected-note deletion event supersedes a still-pending initial open', async () => {
    const old = deferred<unknown>()
    let reads = 0
    const host = noteHost(async () => {
      if (++reads === 1) return old.promise
      throw Object.assign(new Error('deleted'), { code: 'NOT_FOUND' })
    })
    const changes = subscribeChanges(host)
    const initial = host.open('note-A')
    changes.listener({ workspaceId: 'workspace-B', noteId: 'note-A', reason: 'external' })
    expect(reads).toBe(1)
    changes.listener({ workspaceId: 'workspace-A', noteId: 'note-A', reason: 'external' })
    await settle()
    expect(reads).toBe(2)
    expect(host.state.failure?.code).toBe('NOT_FOUND')
    old.resolve(document)
    await initial
    expect(host.state.activeNote).toBeNull()
    changes.cleanup?.()
    expect(changes.stopped()).toBe(true)
  })

  it('an external deletion preserves an unsaved draft and requests explicit recovery', async () => {
    let reads = 0
    const host = noteHost(async () => { reads += 1; return document })
    host.refs.activeNoteIdRef.current = 'note-A'
    host.refs.dirtyRef.current = true
    host.state.content = 'unsaved draft'
    const changes = subscribeChanges(host)
    const payload = { workspaceId: 'workspace-A', noteId: 'note-A', reason: 'external' }
    changes.listener(payload)
    await settle()
    expect(reads).toBe(0)
    expect(host.state.content).toBe('unsaved draft')
    expect(changes.externalChange()).toEqual(payload)
    changes.cleanup?.()
  })

  it('a stale descriptor refusal cannot revoke a newer successful selected-note resolution', async () => {
    const old = deferred<unknown>()
    let resolutions = 0
    const available = { status: 'ok', origin: { nativeId: 'note-A', sourceStoreId: 'store-A' }, content: 'source bytes', revision: 'r1', capabilities: { write: true } }
    const host = noteHost(async () => ({ ...document }))
    Object.assign(host.bindings.window.electronAPI, {
      isChannelAvailable: () => true,
      resolveContent: async () => ++resolutions === 2 ? old.promise : available,
    })
    await host.open('note-A')
    const changes = subscribeChanges(host)
    changes.listener({ workspaceId: 'workspace-A', noteId: 'note-A', reason: 'descriptor' })
    await host.open('note-A')
    expect(host.state.resolution).toEqual(available)
    old.reject({ code: 'AUTH_FAILED' })
    await settle()
    expect(host.state.resolution).toEqual(available)
    changes.cleanup?.()
  })

  it('the recovery UI retry invokes the exact selected note callback and retains block address', async () => {
    const addresses: string[] = []
    const render = leafComponent(source, 'SelectedNoteRecovery', { React, Button: 'button', routes: { view: { notes: () => 'notes' } }, useNavigation: () => ({ navigate: () => {} }), useTranslation: () => ({ t: (key: string) => key }) })
    const tree = render({ failure: { workspaceId: 'workspace-A', noteId: 'note-A', kind: 'missing' }, address: 'note-A#^block-A', onRetry: () => addresses.push('note-A') })
    const status = elementIn(tree, element => element.props['data-testid'] === 'note-surface-missing')
    expect(status?.props['data-note-address']).toBe('note-A#^block-A')
    const retry = elementIn(tree, element => element.props['data-testid'] === 'note-surface-retry')
    expect(retry).toBeDefined()
    retry!.props.onClick()
    expect(addresses).toEqual(['note-A'])
  })
})
