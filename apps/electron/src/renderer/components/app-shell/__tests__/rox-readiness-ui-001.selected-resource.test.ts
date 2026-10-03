import { describe, expect, it } from 'bun:test'
import { mainPanelEffect, deferred, settle } from './rox-readiness-ui-001.effect-harness'

describe('UI-001 selected resource canonical callbacks', () => {
  it('source deletion wins over an older initial load and does not navigate away', async () => {
    const initial = deferred<any[]>()
    let changed!: (workspace: string, sources: any[]) => void
    let state: any
    let removed = false
    const off = mainPanelEffect({
      workspaceId: 'ws-a', kind: 'source', slug: 'selected', workingDirectory: undefined, identity: 'source-a',
      setState: (next: any) => { state = next },
      window: { electronAPI: {
        getSources: () => initial.promise,
        onSourcesChanged: (callback: typeof changed) => { changed = callback; return () => { removed = true } },
      } },
    })
    expect(state).toEqual({ identity: 'source-a', status: 'loading' })
    changed('other', [{ config: { slug: 'selected' } }])
    expect(state.status).toBe('loading')
    changed('ws-a', [])
    expect(state).toEqual({ identity: 'source-a', status: 'missing' })
    initial.resolve([{ config: { slug: 'selected' } }]); await settle()
    expect(state.status).toBe('missing')
    changed('ws-a', [{ config: { slug: 'selected' } }])
    expect(state.status).toBe('ready')
    off?.()
    expect(removed).toBe(true)
    changed('ws-a', [])
    expect(state.status).toBe('ready')
  })

  it('a malformed source event reports unavailable without throwing', async () => {
    let state: any
    let changed!: (workspace: string, rows: any) => void
    const off = mainPanelEffect({
      workspaceId: 'ws-a', kind: 'source', slug: 'selected', workingDirectory: undefined, identity: 'source-a',
      setState: (value: any) => { state = value },
      window: { electronAPI: {
        getSources: async () => [{config:{slug:'selected'}}],
        onSourcesChanged: (callback: typeof changed) => { changed = callback; return () => {} },
      } },
    })
    await settle()
    expect(state.status).toBe('ready')
    expect(() => changed('ws-a', null)).not.toThrow()
    expect(state.status).toBe('unavailable')
    off?.()
  })

  it('source read rejection becomes unavailable and recovers from a real subscription callback', async () => {
    let state: any
    let changed!: (workspace: string, sources: any[]) => void
    const off = mainPanelEffect({
      workspaceId: 'ws-a', kind: 'source', slug: 'selected', workingDirectory: undefined, identity: 'source-a',
      setState: (next: any) => { state = next },
      window: { electronAPI: {
        getSources: () => Promise.reject(new Error('offline')),
        onSourcesChanged: (callback: typeof changed) => { changed = callback; return () => {} },
      } },
    })
    await settle()
    expect(state.status).toBe('unavailable')
    changed('ws-a', [{ config: { slug: 'selected' } }])
    expect(state.status).toBe('ready')
    off?.()
  })

  it('unmount suppresses an obsolete source read and missing capability is explicit', async () => {
    const initial = deferred<any[]>()
    let state: any
    const bindings = {
      workspaceId: 'ws-a', kind: 'source', slug: 'selected', workingDirectory: undefined, identity: 'source-a',
      setState: (next: any) => { state = next },
      window: { electronAPI: { getSources: () => initial.promise } },
    }
    const off = mainPanelEffect(bindings)
    off?.(); initial.resolve([{ config: { slug: 'selected' } }]); await settle()
    expect(state.status).toBe('loading')
    mainPanelEffect({ ...bindings, window: { electronAPI: {} } })
    expect(state.status).toBe('unavailable')
  })

  it('skill events re-read project/global resolution context and reject an older response', async () => {
    const initial = deferred<any[]>(), next = deferred<any[]>(), deleted = deferred<any[]>()
    const reads = [initial, next, deleted]
    const requests: unknown[][] = []
    let changed!: (workspace: string, skills: any[]) => void
    let state: any
    let index = 0
    const off = mainPanelEffect({
      workspaceId: 'ws-a', kind: 'skill', slug: 'global-skill', workingDirectory: '/project/a', identity: 'skill-a',
      setState: (value: any) => { state = value },
      window: { electronAPI: {
        getSkills: (...args: unknown[]) => { requests.push(args); return reads[index++]!.promise },
        onSkillsChanged: (callback: typeof changed) => { changed = callback; return () => {} },
      } },
    })
    changed('other', [])
    expect(requests).toHaveLength(1)
    changed('ws-a', []) // Workspace-only payload must not delete a global/project skill.
    next.resolve([{ slug: 'global-skill', source: 'global' }]); await settle()
    expect(state.status).toBe('ready')
    initial.resolve([]); await settle()
    expect(state.status).toBe('ready')
    changed('ws-a', [])
    deleted.resolve([]); await settle()
    expect(state.status).toBe('missing')
    expect(requests).toEqual([['ws-a', '/project/a'], ['ws-a', '/project/a'], ['ws-a', '/project/a']])
    off?.()
  })
})
