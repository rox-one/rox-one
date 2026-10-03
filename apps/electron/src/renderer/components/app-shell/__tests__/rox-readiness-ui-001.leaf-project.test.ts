import { describe, expect, it } from 'bun:test'
import { deferred, leafCallback, rendererEffect, settle } from './rox-readiness-ui-001.leaf-harness'

const source = new URL('../../../pages/ProjectInfoPage.tsx', import.meta.url)
const projectRow = { config: { id: 'project-A', slug: 'alpha', name: 'Alpha', description: '', workingDirectory: '/workspace-A', color: 'blue' } }

function projectHost(getProject: (workspaceId: string, slug: string) => Promise<unknown>, claimable = true) {
  const state: { project: unknown; error: string | null; loading: boolean } = { project: null, error: null, loading: true }
  const projectReadsMountedRef = { current: true }
  const projectReadRevisionRef = { current: 0 }
  const bindings = {
    workspaceId: 'workspace-A', projectSlug: 'alpha',
    window: { electronAPI: { getProject } },
    soupProjectListResult: () => ({ result: {} }), soupProjectReadResult: () => ({ result: {} }),
    isClaimableLive: () => claimable, t: (key: string) => key,
    projectReadsMountedRef, projectReadRevisionRef, projectMountedRef: projectReadsMountedRef, projectRequestRef: projectReadRevisionRef,
    setProject: (value: unknown) => { state.project = value },
    setError: (value: string | null) => { state.error = value },
    setLoading: (value: boolean) => { state.loading = value },
    setEditName: () => {}, setEditDescription: () => {}, setEditWorkingDir: () => {}, setEditDetails: () => {}, setEditColor: () => {},
    console: { error: () => {} },
  }
  return { state, bindings, load: leafCallback(source, 'loadProject', bindings), projectReadsMountedRef, projectReadRevisionRef }
}

describe('UI-001 selected project canonical read fencing', () => {
  it('a deletion read wins over the older initial project response', async () => {
    const first = deferred<unknown>()
    let request = 0
    const host = projectHost(async (workspaceId, slug) => {
      expect([workspaceId, slug]).toEqual(['workspace-A', 'alpha'])
      return ++request === 1 ? first.promise : null
    })
    const initial = host.load()
    await host.load()
    expect(host.state.error).toBe('projectInfo.notFound')
    expect(host.state.project).toBeNull()
    first.resolve(projectRow)
    await initial
    expect(host.state.error).toBe('projectInfo.notFound')
    expect(host.state.project).toBeNull()
    expect(host.state.loading).toBe(false)
  })

  it('transport failure clears stale selected data and can retry the same address', async () => {
    let unavailable = true
    const host = projectHost(async () => { if (unavailable) throw new Error('transport disconnected'); return projectRow })
    host.state.project = projectRow
    await host.load()
    expect(host.state.project).toBeNull()
    expect(host.state.error).toBe('common.unavailable')
    expect(host.state.loading).toBe(false)
    unavailable = false
    await host.load()
    expect(host.state.project).toEqual(projectRow)
    expect(host.state.error).toBeNull()
  })

  it('a nonclaimable read becomes unavailable without invoking a protected read', async () => {
    let calls = 0
    const host = projectHost(async () => { calls += 1; return projectRow }, false)
    await host.load()
    expect(calls).toBe(0)
    expect(host.state.error).toBe('common.unavailable')
    expect(host.state.project).toBeNull()
    expect(host.state.loading).toBe(false)
  })

  it('actual project-change callbacks refresh this workspace and ignore other workspaces', async () => {
    const initialRead = deferred<unknown>()
    let requests = 0
    const host = projectHost(async () => ++requests === 1 ? initialRead.promise : null)
    let listener!: (workspaceId: string) => void
    let unsubscribed = false
    const cleanup = rendererEffect(source, 'onProjectsChanged', {
      ...host.bindings, loadProject: host.load, loadOkr: () => {},
      window: { electronAPI: { onProjectsChanged: (callback: typeof listener) => { listener = callback; return () => { unsubscribed = true } } } },
    })
    const oldRead = host.load()
    listener('workspace-B')
    expect(requests).toBe(1)
    listener('workspace-A')
    await settle()
    expect(host.state.error).toBe('projectInfo.notFound')
    initialRead.resolve(projectRow)
    await oldRead
    expect(host.state.project).toBeNull()
    expect(host.state.error).toBe('projectInfo.notFound')
    cleanup?.()
    expect(unsubscribed).toBe(true)
  })

  it('the production lease cleanup prevents a pending response from updating an unmounted host', async () => {
    const read = deferred<unknown>()
    const host = projectHost(async () => read.promise)
    const cleanup = rendererEffect(source, 'projectReadsMountedRef.current = true', host.bindings)
    const pending = host.load()
    const before = { ...host.state }
    cleanup?.()
    read.resolve(projectRow)
    await pending
    expect(host.state).toEqual(before)
    expect(host.projectReadsMountedRef.current).toBe(false)
  })
})
